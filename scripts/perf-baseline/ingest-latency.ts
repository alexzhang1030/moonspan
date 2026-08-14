/**
 * Primary perf-baseline probe: latency, CPU, and memory.
 *
 * Two hop classes — do not mix them:
 * - decode: framed bytes → usable message (header skip + CDR / JSON.parse)
 * - deliver: framed bytes → user callback (subscription lookup + decode)
 *
 * `rclweb.ingest` pairs with `foxglove.deliver`, not with a 13-byte skip.
 * Idle-queue ROS_SAMPLE skips the poll batch; keep flushSync in the timed
 * loop so the product call shape stays honest.
 * Not live e2e (`just perf-baseline-live`).
 */

import { Buffer } from "node:buffer";
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
  FOXGLOVE_MESSAGE_DATA_HEADER_BYTES,
  R2WP_FRAME_HEADER_BYTES,
  decodeFoxgloveMessageData,
  decodeRosbridgeJson,
  encodeFoxglove,
  encodeR2wp,
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
  | "rclweb.cdrDecode"
  | "foxglove.cdrDecode"
  | "rosbridge.jsonDecode"
  | "rclweb.ingest"
  | "foxglove.deliver"
  | "rosbridge.deliver";

export type IngestRow = {
  hop: IngestHopId;
  size: string;
  payloadBytes: number;
  latencyMs: LatencySummary;
  resources: ResourceDelta;
  note: string;
};

const DECODE_HOPS: readonly IngestHopId[] = [
  "rclweb.cdrDecode",
  "foxglove.cdrDecode",
  "rosbridge.jsonDecode",
];

const DELIVER_HOPS: readonly IngestHopId[] = [
  "rclweb.ingest",
  "foxglove.deliver",
  "rosbridge.deliver",
];

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

/** Inner reps so a timed sample sits above first-alloc / JIT noise. */
function decodeInner(spec: IngestSizeSpec): number {
  if (spec.kind === "pointcloud2") return 32;
  if (spec.payloadBytes >= 32 * 1024) return 16;
  return 64;
}

function measureTimed(
  hop: IngestHopId,
  spec: IngestSizeSpec,
  sampleCount: number,
  warmup: number,
  runOnce: () => void,
  note: string,
  inner = 1,
): IngestRow {
  const reps = Math.max(1, inner);
  for (let i = 0; i < warmup; i++) {
    for (let k = 0; k < reps; k++) runOnce();
  }
  const latencies: number[] = [];
  tryGc();
  const memBefore = snapshotMemory();
  const cpu0 = cpuStart();
  for (let i = 0; i < sampleCount; i++) {
    const t0 = performance.now();
    for (let k = 0; k < reps; k++) runOnce();
    latencies.push((performance.now() - t0) / reps);
  }
  const cpuUs = cpuDeltaUs(cpu0);
  tryGc();
  const memAfter = snapshotMemory();
  return {
    hop,
    size: spec.id,
    payloadBytes: spec.payloadBytes,
    latencyMs: summarize(latencies),
    resources: resourceDelta(cpuUs, memBefore, memAfter, sampleCount * reps),
    note,
  };
}

function rosbridgeEnvelope(spec: IngestSizeSpec, cdr: Uint8Array): string {
  if (spec.kind === "string") {
    return JSON.stringify({
      op: "publish",
      topic: `/bench/${spec.id}`,
      msg: { data: decodeStdMsgsStringCdr(cdr) },
    });
  }
  return encodeRosbridgeJson(`/bench/${spec.id}`, cdr);
}

function measureDecodeHops(
  spec: IngestSizeSpec,
  sampleCount: number,
  warmup: number,
): IngestRow[] {
  const cdr = cdrFor(spec);
  const r2wp = encodeR2wp(cdr);
  const fox = encodeFoxglove(cdr);
  const json = rosbridgeEnvelope(spec, cdr);
  const runRclweb = (): void =>
    consumeUsable(spec, r2wp.subarray(R2WP_FRAME_HEADER_BYTES));
  const runFox = (): void =>
    consumeUsable(spec, decodeFoxgloveMessageData(fox));
  const runRb = (): void => {
    if (spec.kind === "string") {
      const obj = JSON.parse(json) as { msg: { data: string } };
      void obj.msg.data.length;
      return;
    }
    consumeUsable(spec, decodeRosbridgeJson(json));
  };
  const inner = decodeInner(spec);
  const prewarm = Math.max(8, warmup);
  for (let i = 0; i < prewarm; i++) {
    for (let k = 0; k < inner; k++) {
      runRclweb();
      runFox();
      runRb();
    }
  }
  const tR: number[] = [];
  const tF: number[] = [];
  const tB: number[] = [];
  tryGc();
  const memBefore = snapshotMemory();
  const cpu0 = cpuStart();
  for (let i = 0; i < sampleCount; i++) {
    let t0 = performance.now();
    for (let k = 0; k < inner; k++) runRclweb();
    tR.push((performance.now() - t0) / inner);
    t0 = performance.now();
    for (let k = 0; k < inner; k++) runFox();
    tF.push((performance.now() - t0) / inner);
    t0 = performance.now();
    for (let k = 0; k < inner; k++) runRb();
    tB.push((performance.now() - t0) / inner);
  }
  const cpuUs = cpuDeltaUs(cpu0);
  tryGc();
  const memAfter = snapshotMemory();
  const sumR = tR.reduce((a, b) => a + b, 0);
  const sumF = tF.reduce((a, b) => a + b, 0);
  const sumB = tB.reduce((a, b) => a + b, 0);
  const sum = sumR + sumF + sumB;
  const ops = sampleCount * inner;
  const row = (
    hop: IngestHopId,
    samples: number[],
    share: number,
    note: string,
  ): IngestRow => ({
    hop,
    size: spec.id,
    payloadBytes: spec.payloadBytes,
    latencyMs: summarize(samples),
    resources: resourceDelta(
      cpuUs * (sum === 0 ? 1 / 3 : share / sum),
      memBefore,
      memAfter,
      ops,
    ),
    note,
  });
  return [
    row(
      "rclweb.cdrDecode",
      tR,
      sumR,
      "R2WP 32-byte skip + JS CDR; interleaved with foxglove.cdrDecode",
    ),
    row(
      "foxglove.cdrDecode",
      tF,
      sumF,
      "MessageData 13-byte skip + JS CDR; interleaved with rclweb.cdrDecode",
    ),
    row(
      "rosbridge.jsonDecode",
      tB,
      sumB,
      "JSON.parse; String is a JSON field, PointCloud2 is base64+CDR",
    ),
  ];
}

function measureFoxgloveDeliver(
  spec: IngestSizeSpec,
  sampleCount: number,
  warmup: number,
): IngestRow {
  const framed = encodeFoxglove(cdrFor(spec), 1);
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  const handlers = new Map<number, (cdr: Uint8Array) => void>();
  let delivered = 0;
  handlers.set(1, (payload) => {
    consumeUsable(spec, payload);
    delivered += 1;
  });
  const row = measureTimed(
    "foxglove.deliver",
    spec,
    sampleCount,
    warmup,
    () => {
      if (framed[0] !== 0x01) return;
      const handler = handlers.get(view.getUint32(1, true));
      handler?.(framed.subarray(FOXGLOVE_MESSAGE_DATA_HEADER_BYTES));
    },
    "MessageData parse + subscriptionId lookup + JS CDR + callback (pairs with rclweb.ingest)",
  );
  if (delivered !== warmup + sampleCount) {
    throw new Error(
      `foxglove deliver delivered ${delivered}/${warmup + sampleCount} for ${spec.id}`,
    );
  }
  return row;
}

function measureRosbridgeDeliver(
  spec: IngestSizeSpec,
  sampleCount: number,
  warmup: number,
): IngestRow {
  const text = rosbridgeEnvelope(spec, cdrFor(spec));
  const topic = `/bench/${spec.id}`;
  const handlers = new Map<string, (msg: unknown) => void>();
  let delivered = 0;
  handlers.set(topic, (msg) => {
    if (spec.kind === "string") {
      void (msg as string).length;
    } else {
      consumeUsable(spec, msg as Uint8Array);
    }
    delivered += 1;
  });
  const row = measureTimed(
    "rosbridge.deliver",
    spec,
    sampleCount,
    warmup,
    () => {
      const obj = JSON.parse(text) as { topic: string; msg: { data: string } };
      const handler = handlers.get(obj.topic);
      if (!handler) return;
      if (spec.kind === "string") {
        handler(obj.msg.data);
        return;
      }
      handler(new Uint8Array(Buffer.from(obj.msg.data, "base64")));
    },
    "JSON.parse + topic lookup + callback (pairs with rclweb.ingest)",
  );
  if (delivered !== warmup + sampleCount) {
    throw new Error(
      `rosbridge deliver delivered ${delivered}/${warmup + sampleCount} for ${spec.id}`,
    );
  }
  return row;
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
      note: "product deliver: idle-queue ROS_SAMPLE skips poll; pairs with foxglove.deliver",
    };
  } finally {
    await session.client.close();
  }
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
    rows.push(...measureDecodeHops(spec, n, warmup));
    rows.push(await measureRclwebIngest(wasmBytes, spec, n, warmup));
    rows.push(measureFoxgloveDeliver(spec, n, warmup));
    rows.push(measureRosbridgeDeliver(spec, n, warmup));
  }
  return rows;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function num(n: number, digits: number, width: number): string {
  return n.toFixed(digits).padStart(width);
}

function formatRowBlock(rows: IngestRow[]): string[] {
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
  return [header, ...lines];
}

export function formatIngestTable(rows: IngestRow[]): string {
  const decode = rows.filter((r) => (DECODE_HOPS as readonly string[]).includes(r.hop));
  const deliver = rows.filter((r) =>
    (DELIVER_HOPS as readonly string[]).includes(r.hop),
  );
  return [
    "Decode — framed bytes → usable message (header skip + CDR / JSON.parse). Paired by work.",
    ...formatRowBlock(decode),
    "",
    "Deliver — framed bytes → user callback. rclweb.ingest pairs with foxglove.deliver, not with cdrDecode.",
    ...formatRowBlock(deliver),
  ].join("\n");
}
