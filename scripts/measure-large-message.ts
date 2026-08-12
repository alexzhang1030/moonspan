/**
 * R2-02 large-message evidence: PointCloud2-scale frames on both buffer
 * strategies plus host-batch encode cost and a single-frame engine copy probe.
 *
 * Workload direction from the restructure performance plan: PointCloud2 ~1 MB
 * @ 10 Hz. This records host-side encode + buffer-strategy cost for 30
 * synthetic ~1 MiB frames (3 s at 10 Hz) and one controllable engine-retain
 * copy. Live ROS talker and Foxglove/rosbridge comparison remain R2-04.
 * Timing uses host `performance.now()` (never wasm Instant).
 *
 * Usage: `bun run scripts/measure-large-message.ts`
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  LARGE_FRAME_INLINE_THRESHOLD,
  SharedArrayBufferRingStrategy,
  TransferableArrayBufferStrategy,
  encodeHostBatch,
  loadWasm,
  pollEngine,
  readTelemetry,
  sharedArrayBufferConstructible,
  type BufferStrategy,
  type BufferStrategyStats,
} from "../sdk/typescript/src/index.ts";

const root = path.resolve(import.meta.dir, "..");
const wasmPath = path.join(root, "sdk/typescript/wasm/rclweb.wasm");
const outPath = path.join(root, "docs/evidence/r2-02-large-message.json");

const POINT_PAYLOAD_BYTES = 87_381 * 12; // 1_048_572
const FRAME_COUNT = 30; // 3 seconds at 10 Hz
const WARMUP = 2;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: Number((sum / sorted.length).toFixed(4)),
    p50: Number(percentile(sorted, 50).toFixed(4)),
    p95: Number(percentile(sorted, 95).toFixed(4)),
    p99: Number(percentile(sorted, 99).toFixed(4)),
    min: Number(sorted[0]!.toFixed(4)),
    max: Number(sorted[sorted.length - 1]!.toFixed(4)),
  };
}

function measureHostPath(name: string, strategy: BufferStrategy) {
  const payload = new Uint8Array(POINT_PAYLOAD_BYTES);
  for (let i = 0; i < payload.length; i += 1024) payload[i] = i & 0xff;

  const writeDrainMs: number[] = [];
  const encodeMs: number[] = [];

  for (let i = 0; i < FRAME_COUNT + WARMUP; i++) {
    const t0 = performance.now();
    strategy.write(payload);
    const frames = strategy.drain();
    const writeMs = performance.now() - t0;

    const e0 = performance.now();
    const batch = encodeHostBatch(
      frames.map((bytes) => ({ type: "wsBytes" as const, bufferId: 0, bytes })),
    );
    const eMs = performance.now() - e0;
    if (batch.length < POINT_PAYLOAD_BYTES) {
      throw new Error("encodeHostBatch produced undersized batch");
    }

    if (i >= WARMUP) {
      writeDrainMs.push(writeMs);
      encodeMs.push(eMs);
    }
  }

  return {
    strategy: name,
    stats: strategy.stats() as BufferStrategyStats,
    writeDrainMs: summarize(writeDrainMs),
    encodeHostBatchMs: summarize(encodeMs),
    frames: FRAME_COUNT,
    payloadBytes: POINT_PAYLOAD_BYTES,
  };
}

async function measureEngineRetainCopy(wasmBytes: ArrayBuffer) {
  const wasm = await loadWasm(wasmBytes.slice(0));
  const handle = wasm.rclweb_engine_new();
  try {
    pollEngine(wasm, handle, [
      {
        type: "command",
        command: { type: "start", transferableArrayBuffer: true },
      },
    ]);
    const large = new Uint8Array(Math.max(LARGE_FRAME_INLINE_THRESHOLD, POINT_PAYLOAD_BYTES));
    const before = readTelemetry(wasm, handle);
    const t0 = performance.now();
    pollEngine(wasm, handle, [{ type: "wsBytes", bufferId: 0, bytes: large }]);
    const pollMs = performance.now() - t0;
    const after = readTelemetry(wasm, handle);
    return {
      frameBytes: large.length,
      copiesIntoEngineDelta: after.copiesIntoEngine - before.copiesIntoEngine,
      bytesCopiedIntoEngineDelta:
        after.bytesCopiedIntoEngine - before.bytesCopiedIntoEngine,
      pollMs: Number(pollMs.toFixed(4)),
      note: "External-ptr large-frame path: one controllable retain copy (budget slot 2). Frame body is synthetic (not a valid R2WP sample); copy accounting is the gate.",
    };
  } finally {
    wasm.rclweb_engine_free(handle);
  }
}

const wasmFile = Bun.file(wasmPath);
const wasmBytes = await wasmFile.arrayBuffer();

const transferable = measureHostPath(
  "transferable-arraybuffer",
  new TransferableArrayBufferStrategy(),
);

let shared: ReturnType<typeof measureHostPath> | null = null;
let sabGate: Record<string, unknown>;
if (sharedArrayBufferConstructible()) {
  shared = measureHostPath(
    "shared-arraybuffer-ring",
    new SharedArrayBufferRingStrategy(4 * 1024 * 1024),
  );
  sabGate = {
    constructible: true,
    isolationRequired: true,
    isolationPresent:
      typeof globalThis.crossOriginIsolated === "boolean"
        ? globalThis.crossOriginIsolated
        : null,
    measured: true,
    note:
      "SAB constructible in this host for reproducible measurement. Browser production still requires COOP/COEP cross-origin isolation; R2WP capability 2 negotiation stays evidence-gated and is not claimed shipped.",
  };
} else {
  sabGate = {
    constructible: false,
    isolationRequired: true,
    isolationPresent: null,
    measured: false,
    note: "SharedArrayBuffer unavailable — ring path not measured in this environment.",
  };
}

const engineCopy = await measureEngineRetainCopy(wasmBytes);

const record = {
  task: "R2-02",
  kind: "large-message-path",
  recordedAt: new Date().toISOString(),
  workload: {
    description:
      "Synthetic ~1 MiB PointCloud2-scale frames through both host buffer strategies + two-pass encodeHostBatch; plus one engine retain-copy probe",
    pointPayloadBytes: POINT_PAYLOAD_BYTES,
    targetRateHz: 10,
    frameCount: FRAME_COUNT,
    warmup: WARMUP,
    landedScope:
      "Host encode + both buffer strategies + O(1) PointCloud2 borrowed CDR + large-frame poll retain copy. Full Foxglove/rosbridge baseline deferred to R2-04.",
  },
  copyBudget: {
    inboundControllableMax: 2,
    browserSlot: "Worker/host → engine retained (copies_into_engine)",
    largeFramePath:
      "external-ptr poll: one set() into wasm alloc; engine takes ownership via from_raw_parts (no second deep copy)",
    probe: engineCopy,
  },
  sharedArrayBufferGate: sabGate,
  strategies: {
    transferableArrayBuffer: transferable,
    sharedArrayBufferRing: shared,
  },
  wasm: {
    artifact: "sdk/typescript/wasm/rclweb.wasm",
    bytes: wasmBytes.byteLength,
  },
};

writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(
  JSON.stringify(
    {
      transferableEncodeP50: transferable.encodeHostBatchMs.p50,
      transferableWriteDrainP50: transferable.writeDrainMs.p50,
      sabEncodeP50: shared?.encodeHostBatchMs.p50 ?? null,
      engineCopiesDelta: engineCopy.copiesIntoEngineDelta,
      sabMeasured: shared != null,
    },
    null,
    2,
  ),
);
