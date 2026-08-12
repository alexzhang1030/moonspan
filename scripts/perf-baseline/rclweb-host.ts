/**
 * rclweb host-path baseline: buffer strategy + encodeHostBatch (+ optional
 * large-frame engine retain probe on the PointCloud2 workload).
 */

import {
  LARGE_FRAME_INLINE_THRESHOLD,
  TransferableArrayBufferStrategy,
  encodeHostBatch,
  loadWasm,
  pollEngine,
  readTelemetry,
  type BufferStrategy,
} from "../../sdk/typescript/src/index.ts";
import { summarize, type LatencySummary } from "./stats.ts";
import {
  WORKLOADS,
  fillPayload,
  type WorkloadId,
  type WorkloadSpec,
} from "./workloads.ts";

export type RclwebHostWorkloadResult = {
  workload: WorkloadId;
  strategy: string;
  payloadBytes: number;
  topicCount: number;
  frames: number;
  writeDrainMs: LatencySummary;
  encodeHostBatchMs: LatencySummary;
  hostCopies: number;
  dropCount: number;
  steadyStateMemory?: {
    rssBytes: number;
    heapUsedBytes: number;
  };
};

export type EngineCopyProbe = {
  frameBytes: number;
  copiesIntoEngineDelta: number;
  bytesCopiedIntoEngineDelta: number;
  pollMs: number;
  note: string;
};

function measureWorkload(
  workload: WorkloadSpec,
  strategy: BufferStrategy,
): RclwebHostWorkloadResult {
  const payload = fillPayload(workload.payloadBytes);
  const writeDrainMs: number[] = [];
  const encodeMs: number[] = [];
  // Fan-in: one drain/encode turn processes topicCount frames (simulates
  // concurrent topics arriving in one poll window).
  const turns = workload.sampleCount + workload.warmup;

  for (let turn = 0; turn < turns; turn++) {
    const t0 = performance.now();
    for (let t = 0; t < workload.topicCount; t++) {
      strategy.write(payload);
    }
    const frames = strategy.drain();
    const writeMs = performance.now() - t0;

    const e0 = performance.now();
    const batch = encodeHostBatch(
      frames.map((bytes) => ({ type: "wsBytes" as const, bufferId: 0, bytes })),
    );
    const eMs = performance.now() - e0;
    const minBytes = workload.payloadBytes; // at least one payload worth
    if (batch.length < minBytes) {
      throw new Error(
        `encodeHostBatch undersized for ${workload.id}: ${batch.length}`,
      );
    }

    if (turn >= workload.warmup) {
      writeDrainMs.push(writeMs);
      encodeMs.push(eMs);
    }
  }

  const stats = strategy.stats();
  const mem = process.memoryUsage();
  return {
    workload: workload.id,
    strategy: strategy.name,
    payloadBytes: workload.payloadBytes,
    topicCount: workload.topicCount,
    frames: workload.sampleCount * workload.topicCount,
    writeDrainMs: summarize(writeDrainMs),
    encodeHostBatchMs: summarize(encodeMs),
    hostCopies: stats.hostCopies,
    dropCount: stats.dropCount,
    steadyStateMemory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    },
  };
}

export async function measureEngineRetainCopy(
  wasmBytes: ArrayBuffer,
  frameBytes: number,
): Promise<EngineCopyProbe> {
  const wasm = await loadWasm(wasmBytes.slice(0));
  const handle = wasm.rclweb_engine_new();
  try {
    pollEngine(wasm, handle, [
      {
        type: "command",
        command: { type: "start", transferableArrayBuffer: true },
      },
    ]);
    const large = new Uint8Array(
      Math.max(LARGE_FRAME_INLINE_THRESHOLD, frameBytes),
    );
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
      note: "External-ptr large-frame path: one controllable retain copy (budget slot 2).",
    };
  } finally {
    wasm.rclweb_engine_free(handle);
  }
}

export async function measureRclwebHost(
  wasmBytes: ArrayBuffer,
): Promise<{
  workloads: RclwebHostWorkloadResult[];
  engineCopyProbe: EngineCopyProbe;
}> {
  const workloads: RclwebHostWorkloadResult[] = [];
  for (const spec of Object.values(WORKLOADS)) {
    workloads.push(
      measureWorkload(spec, new TransferableArrayBufferStrategy()),
    );
  }
  const engineCopyProbe = await measureEngineRetainCopy(
    wasmBytes,
    WORKLOADS["pointcloud2-1mb-10hz"].payloadBytes,
  );
  return { workloads, engineCopyProbe };
}
