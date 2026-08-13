/**
 * Protocol wire-cost models for the same payload bodies.
 *
 * These are not live bridge e2e measurements. They quantify structural
 * serialization / framing cost for:
 * - rclweb R2WP ROS_SAMPLE (32-byte header + CDR body)
 * - Foxglove WS MessageData (1 + 4 + 8 + CDR body) — foxglove/ws-protocol
 * - rosbridge JSON + base64 body (common binary path)
 * - rosbridge CBOR-RAW style (thin CBOR byte-string wrapper + CDR body)
 *
 * Live bridge e2e remains docker-gated (`paths.live`).
 */

import { Buffer } from "node:buffer";
import { summarize, type LatencySummary } from "./stats.ts";
import {
  WORKLOADS,
  fillPayload,
  type WorkloadId,
  type WorkloadSpec,
} from "./workloads.ts";

/** R2WP selected-version frame header (rclweb::protocol::frame). */
export const R2WP_FRAME_HEADER_BYTES = 32;

/** Foxglove MessageData: opcode(1) + subscriptionId(u32) + timestamp(u64). */
export const FOXGLOVE_MESSAGE_DATA_HEADER_BYTES = 1 + 4 + 8;

export type ProtocolId =
  | "rclweb-r2wp"
  | "foxglove-message-data"
  | "rosbridge-json-base64"
  | "rosbridge-cbor-raw";

export type ProtocolCostResult = {
  protocol: ProtocolId;
  workload: WorkloadId;
  wireBytesPerSample: number;
  expansionRatio: number;
  encodeMs: LatencySummary;
  decodeTouchMs: LatencySummary;
  note: string;
};

export function encodeR2wp(cdr: Uint8Array): Uint8Array {
  const out = new Uint8Array(R2WP_FRAME_HEADER_BYTES + cdr.length);
  out[0] = 0; // version
  out[1] = 2; // OPCODE_ROS_SAMPLE
  // remaining header zeros are fine for size/cost probing
  out.set(cdr, R2WP_FRAME_HEADER_BYTES);
  return out;
}

export function encodeFoxglove(cdr: Uint8Array, subId = 1): Uint8Array {
  const out = new Uint8Array(FOXGLOVE_MESSAGE_DATA_HEADER_BYTES + cdr.length);
  out[0] = 0x01; // Message Data
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, subId, true);
  view.setBigUint64(5, BigInt(Date.now()) * 1_000_000n, true);
  out.set(cdr, FOXGLOVE_MESSAGE_DATA_HEADER_BYTES);
  return out;
}

export function encodeRosbridgeJson(topic: string, cdr: Uint8Array): string {
  // rosbridge_suite binary fields commonly travel as base64 inside JSON.
  const b64 = Buffer.from(cdr).toString("base64");
  return JSON.stringify({
    op: "publish",
    topic,
    msg: { data: b64 },
  });
}

export function decodeRosbridgeJson(text: string): Uint8Array {
  const obj = JSON.parse(text) as { msg: { data: string } };
  return new Uint8Array(Buffer.from(obj.msg.data, "base64"));
}

/** Minimal CBOR bstr wrapper: 0x5a + u32 length + bytes (CBOR major type 2). */
export function encodeCborRaw(cdr: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 4 + cdr.length);
  out[0] = 0x5a;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, cdr.length, false); // CBOR uses network byte order
  out.set(cdr, 5);
  return out;
}

export function decodeFoxgloveMessageData(frame: Uint8Array): Uint8Array {
  if (frame.byteLength < FOXGLOVE_MESSAGE_DATA_HEADER_BYTES) {
    throw new Error("foxglove MessageData truncated");
  }
  return frame.subarray(FOXGLOVE_MESSAGE_DATA_HEADER_BYTES);
}

export function decodeCborRaw(frame: Uint8Array): Uint8Array {
  if (frame[0] !== 0x5a) throw new Error("expected CBOR bstr u32");
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const len = view.getUint32(1, false);
  return frame.subarray(5, 5 + len);
}

function measureProtocol(
  protocol: ProtocolId,
  workload: WorkloadSpec,
): ProtocolCostResult {
  const cdr = fillPayload(workload.payloadBytes, 7);
  const topic = `/bench/${workload.id}`;
  const encodeMs: number[] = [];
  const decodeMs: number[] = [];
  let wireBytes = 0;

  const iters = workload.sampleCount + workload.warmup;
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    let framed: Uint8Array | string;
    switch (protocol) {
      case "rclweb-r2wp":
        framed = encodeR2wp(cdr);
        break;
      case "foxglove-message-data":
        framed = encodeFoxglove(cdr);
        break;
      case "rosbridge-json-base64":
        framed = encodeRosbridgeJson(topic, cdr);
        break;
      case "rosbridge-cbor-raw":
        framed = encodeCborRaw(cdr);
        break;
    }
    const eMs = performance.now() - t0;

    const t1 = performance.now();
    switch (protocol) {
      case "rclweb-r2wp": {
        const f = framed as Uint8Array;
        wireBytes = f.byteLength;
        // Touch payload view (borrowed) — no materialize.
        void f.subarray(R2WP_FRAME_HEADER_BYTES).byteLength;
        break;
      }
      case "foxglove-message-data": {
        const f = framed as Uint8Array;
        wireBytes = f.byteLength;
        void f.subarray(FOXGLOVE_MESSAGE_DATA_HEADER_BYTES).byteLength;
        break;
      }
      case "rosbridge-json-base64": {
        const text = framed as string;
        wireBytes = Buffer.byteLength(text, "utf8");
        void decodeRosbridgeJson(text).byteLength;
        break;
      }
      case "rosbridge-cbor-raw": {
        const f = framed as Uint8Array;
        wireBytes = f.byteLength;
        void decodeCborRaw(f).byteLength;
        break;
      }
    }
    const dMs = performance.now() - t1;

    if (i >= workload.warmup) {
      encodeMs.push(eMs);
      decodeMs.push(dMs);
    }
  }

  const notes: Record<ProtocolId, string> = {
    "rclweb-r2wp":
      "R2WP ROS_SAMPLE: 32-byte header + CDR body; decode touch is a subarray view.",
    "foxglove-message-data":
      "Foxglove WS MessageData (opcode 0x01): 13-byte header + CDR body per foxglove/ws-protocol.",
    "rosbridge-json-base64":
      "rosbridge publish op with base64-wrapped binary field inside JSON (common path for opaque blobs).",
    "rosbridge-cbor-raw":
      "CBOR-RAW style: CBOR bstr (0x5a+u32) wrapping the CDR body; no JSON/base64 expansion.",
  };

  return {
    protocol,
    workload: workload.id,
    wireBytesPerSample: wireBytes,
    expansionRatio: Number((wireBytes / workload.payloadBytes).toFixed(4)),
    encodeMs: summarize(encodeMs),
    decodeTouchMs: summarize(decodeMs),
    note: notes[protocol],
  };
}

const PROTOCOLS: ProtocolId[] = [
  "rclweb-r2wp",
  "foxglove-message-data",
  "rosbridge-json-base64",
  "rosbridge-cbor-raw",
];

export function measureAllProtocolCosts(): ProtocolCostResult[] {
  const out: ProtocolCostResult[] = [];
  for (const workload of Object.values(WORKLOADS)) {
    for (const protocol of PROTOCOLS) {
      out.push(measureProtocol(protocol, workload));
    }
  }
  return out;
}
