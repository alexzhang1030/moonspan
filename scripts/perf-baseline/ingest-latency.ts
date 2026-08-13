/**
 * Primary perf-baseline probe: latency, CPU, and memory.
 *
 * Each hop is "bytes already in JS → usable ROS message":
 * - rclweb: wasm poll until Sample (string decoded / PointCloud2 metadata)
 * - foxglove: MessageData header skip + JS CDR decode (same types)
 * - rosbridge: JSON.parse; String is a JSON field, PointCloud2 is base64+CDR
 *
 * Not live e2e (`just perf-baseline-live`).
 */

import { connectOfflineForTests } from "../../typescript/src/internal.ts";
import { sensor_msgs, std_msgs } from "../../typescript/src/index.ts";
import {
  replaceFramePayload,
  scriptedPeerFixtures,
} from "../../typescript/test/scripted-peer.ts";
import {
  decodePointCloud2Cdr,
  decodeStdMsgsStringCdr,
  encodeXyzPointCloud2Cdr,
  stdMsgsStringCdrOfSize,
} from "./cdr-payloads.ts";
import {
  decodeFoxgloveMessageData,
  decodeRosbridgeJson,
  encodeFoxglove,
  encodeRosbridgeJson,
} from "./protocol-cost.ts";
import {
  cpuDeltaUs,
  cpuStart,
  resourceDelta,
  snapshotMemory,
  tryGc,
  type ResourceDelta,
} from "./resources.ts";
import { summarize, type LatencySummary } from "./stats.ts";
import { POINT_PAYLOAD_BYTES } from "./workloads.ts";

export type IngestKind = "string" | "pointcloud2";

export type IngestSizeSpec = {
  id: string;
  payloadBytes: number;
  warmup: number;
  sampleCount: number;
  kind: IngestKind;
};

/** Sizes track validation engineering targets (1 KiB, 32 KiB) plus PointCloud2 ~1 MiB. */
export const INGEST_SIZES: readonly IngestSizeSpec[] = [
  { id: "1KiB", payloadBytes: 1024, warmup: 8, sampleCount: 200, kind: "string" },
  {
    id: "32KiB",
    payloadBytes: 32 * 1024,
    warmup: 8,
    sampleCount: 80,
    kind: "string",
  },
  {
    id: "PointCloud2_1MiB",
    payloadBytes: POINT_PAYLOAD_BYTES,
    warmup: 4,
    sampleCount: 24,
    kind: "pointcloud2",
  },
];

export type IngestHopId =
  | "rclweb.ingest"
  | "foxglove.cdrDecode"
  | "rosbridge.jsonDecode";

export type IngestRow = {
  hop: IngestHopId;
  size: string;
  payloadBytes: number;
  latencyMs: LatencySummary;
  resources: ResourceDelta;
  note: string;
};

function cdrFor(spec: IngestSizeSpec): Uint8Array {
  if (spec.kind === "string") {
    return stdMsgsStringCdrOfSize(spec.payloadBytes);
  }
  return encodeXyzPointCloud2Cdr(87_381, false);
}

function setFrameSequence(frame: Uint8Array, sequence: bigint): void {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setBigUint64(8, sequence, false);
}

function buildR2wpFrames(
  template: Uint8Array,
  cdr: Uint8Array,
  count: number,
): Uint8Array[] {
  const frames = new Array<Uint8Array>(count);
  for (let i = 0; i < count; i++) {
    const frame = replaceFramePayload(template, cdr);
    setFrameSequence(frame, BigInt(i));
    frames[i] = frame;
  }
  return frames;
}

async function openScriptedSub(
  wasmBytes: ArrayBuffer,
  spec: IngestSizeSpec,
): Promise<{
  client: Awaited<ReturnType<typeof connectOfflineForTests>>;
  host: Awaited<ReturnType<typeof connectOfflineForTests>>["host"];
  template: Uint8Array;
  delivered: { n: number };
  getLease: () => { release: () => void } | null;
}> {
  const fixtures = scriptedPeerFixtures();
  const client = await connectOfflineForTests(wasmBytes.slice(0));
  const host = client.host;
  host.startOffline();
  host.flushSync();
  host.ingestBytes(fixtures.serverHello);
  host.flushSync();
  host.flushSync();
  host.ingestBytes(fixtures.sessionReady);
  host.flushSync();

  const topic = spec.kind === "string" ? "/chatter" : "/points";
  const template =
    spec.kind === "string" ? fixtures.sample : fixtures.pointCloud2Sample;

  const subPromise = spec.kind === "string"
    ? client.session.subscribe(topic, std_msgs.msg.String)
    : client.session.subscribe(topic, sensor_msgs.msg.PointCloud2);
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const sub = await subPromise;

  const delivered = { n: 0 };
  let lastLease: { release: () => void } | null = null;
  sub.onMessage((_msg, lease) => {
    delivered.n += 1;
    lastLease = lease;
  });

  return { client, host, template, delivered, getLease: () => lastLease };
}

export async function measureRclwebIngest(
  wasmBytes: ArrayBuffer,
  spec: IngestSizeSpec,
  sampleCount = spec.sampleCount,
  warmup = spec.warmup,
): Promise<IngestRow> {
  const cdr = cdrFor(spec);
  const total = warmup + sampleCount;
  const session = await openScriptedSub(wasmBytes, spec);
  const frames = buildR2wpFrames(session.template, cdr, total);
  const latencies: number[] = [];

  try {
    for (let i = 0; i < warmup; i++) {
      session.host.ingestBytes(frames[i]!);
      session.host.flushSync();
      session.getLease()?.release();
    }
    if (session.delivered.n !== warmup) {
      throw new Error(
        `rclweb ingest warmup delivered ${session.delivered.n}/${warmup} for ${spec.id}`,
      );
    }

    tryGc();
    const memBefore = snapshotMemory();
    const cpu0 = cpuStart();
    const deliveredBefore = session.delivered.n;
    for (let i = warmup; i < total; i++) {
      const t0 = performance.now();
      session.host.ingestBytes(frames[i]!);
      session.host.flushSync();
      latencies.push(performance.now() - t0);
      session.getLease()?.release();
    }
    const cpuUs = cpuDeltaUs(cpu0);
    tryGc();
    const memAfter = snapshotMemory();
    const got = session.delivered.n - deliveredBefore;
    if (got !== sampleCount) {
      throw new Error(
        `rclweb ingest delivered ${got}/${sampleCount} for ${spec.id}`,
      );
    }

    return {
      hop: "rclweb.ingest",
      size: spec.id,
      payloadBytes: spec.payloadBytes,
      latencyMs: summarize(latencies),
      resources: resourceDelta(cpuUs, memBefore, memAfter, sampleCount),
      note: "wasm poll until Sample; lease release is after the timer",
    };
  } finally {
    await session.client.close();
  }
}

function consumeUsable(spec: IngestSizeSpec, cdr: Uint8Array): void {
  if (spec.kind === "string") {
    void decodeStdMsgsStringCdr(cdr);
    return;
  }
  const cloud = decodePointCloud2Cdr(cdr);
  void cloud.width;
  void cloud.data[0];
  void cloud.data[cloud.data.length - 1];
}

function measureEnvelopeHop(
  hop: Exclude<IngestHopId, "rclweb.ingest">,
  spec: IngestSizeSpec,
  sampleCount = spec.sampleCount,
  warmup = spec.warmup,
): IngestRow {
  const cdr = cdrFor(spec);
  const framed = hop === "foxglove.cdrDecode" ? encodeFoxglove(cdr) : null;
  const text = hop === "rosbridge.jsonDecode"
    ? spec.kind === "string"
      ? JSON.stringify({
          op: "publish",
          topic: `/bench/${spec.id}`,
          msg: { data: decodeStdMsgsStringCdr(cdr) },
        })
      : encodeRosbridgeJson(`/bench/${spec.id}`, cdr)
    : null;

  const runOnce = (): void => {
    if (framed) {
      consumeUsable(spec, decodeFoxgloveMessageData(framed));
      return;
    }
    if (spec.kind === "string") {
      const obj = JSON.parse(text!) as { msg: { data: string } };
      void obj.msg.data.length;
      return;
    }
    consumeUsable(spec, decodeRosbridgeJson(text!));
  };

  for (let i = 0; i < warmup; i++) runOnce();

  const latencies: number[] = [];
  tryGc();
  const memBefore = snapshotMemory();
  const cpu0 = cpuStart();
  for (let i = 0; i < sampleCount; i++) {
    const t0 = performance.now();
    runOnce();
    latencies.push(performance.now() - t0);
  }
  const cpuUs = cpuDeltaUs(cpu0);
  tryGc();
  const memAfter = snapshotMemory();

  const notes: Record<typeof hop, string> = {
    "foxglove.cdrDecode":
      "MessageData skip + JS CDR to a usable String / PointCloud2 (data is a view)",
    "rosbridge.jsonDecode":
      "JSON.parse; String is a JSON field, PointCloud2 is base64+CDR",
  };

  return {
    hop,
    size: spec.id,
    payloadBytes: spec.payloadBytes,
    latencyMs: summarize(latencies),
    resources: resourceDelta(cpuUs, memBefore, memAfter, sampleCount),
    note: notes[hop],
  };
}

export async function measureIngestSuite(
  wasmBytes: ArrayBuffer,
  sizes: readonly IngestSizeSpec[] = INGEST_SIZES,
  sampleCountOverride?: number,
  warmupOverride?: number,
): Promise<IngestRow[]> {
  const rows: IngestRow[] = [];
  for (const spec of sizes) {
    const n = sampleCountOverride ?? spec.sampleCount;
    const warmup = warmupOverride ?? spec.warmup;
    rows.push(await measureRclwebIngest(wasmBytes, spec, n, warmup));
    rows.push(measureEnvelopeHop("foxglove.cdrDecode", spec, n, warmup));
    rows.push(measureEnvelopeHop("rosbridge.jsonDecode", spec, n, warmup));
  }
  return rows;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function num(n: number, digits: number, width: number): string {
  return n.toFixed(digits).padStart(width);
}

export function formatIngestTable(rows: IngestRow[]): string {
  const header = [
    pad("hop", 26),
    pad("size", 18),
    "n".padStart(4),
    "p50_ms".padStart(10),
    "p99_ms".padStart(10),
    "mean_ms".padStart(10),
    "cpu_us/n".padStart(10),
    "rss_KiB".padStart(10),
    "rss_ΔKiB".padStart(10),
    "heap_ΔKiB".padStart(10),
  ].join(" ");

  const lines = rows.map((r) => {
    const rssKiB = r.resources.rssAfterBytes / 1024;
    const rssDeltaKiB = r.resources.rssDeltaBytes / 1024;
    const heapDeltaKiB = r.resources.heapDeltaBytes / 1024;
    return [
      pad(r.hop, 26),
      pad(r.size, 18),
      String(r.latencyMs.n).padStart(4),
      num(r.latencyMs.p50, 4, 10),
      num(r.latencyMs.p99, 4, 10),
      num(r.latencyMs.mean, 4, 10),
      num(r.resources.cpuUsPerSample, 1, 10),
      num(rssKiB, 0, 10),
      num(rssDeltaKiB, 1, 10),
      num(heapDeltaKiB, 1, 10),
    ].join(" ");
  });

  return [
    "Latency / CPU / RSS — usable message (rclweb = wasm poll; foxglove/rosbridge = JS-only decode)",
    header,
    ...lines,
  ].join("\n");
}
