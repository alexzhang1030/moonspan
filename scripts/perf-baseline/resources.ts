/**
 * CPU and memory snapshots for perf-baseline probes.
 *
 * These are process-local (the Bun harness). They are not container cgroup
 * figures and not a CI gate.
 */

export type MemorySnapshot = {
  rssBytes: number;
  heapUsedBytes: number;
};

export type CpuUsage = {
  user: number;
  system: number;
};

export function tryGc(): void {
  const bun = (
    globalThis as { Bun?: { gc?: (force?: boolean) => void } }
  ).Bun;
  bun?.gc?.(true);
}

export function snapshotMemory(): MemorySnapshot {
  const m = process.memoryUsage();
  return { rssBytes: m.rss, heapUsedBytes: m.heapUsed };
}

export function cpuStart(): CpuUsage {
  return process.cpuUsage();
}

/** User + system microseconds since `start`. */
export function cpuDeltaUs(start: CpuUsage): number {
  const d = process.cpuUsage(start);
  return d.user + d.system;
}

export type ResourceDelta = {
  cpuUserPlusSystemUs: number;
  cpuUsPerSample: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
  heapBeforeBytes: number;
  heapAfterBytes: number;
  rssDeltaBytes: number;
  heapDeltaBytes: number;
};

export function resourceDelta(
  cpuUs: number,
  before: MemorySnapshot,
  after: MemorySnapshot,
  sampleCount: number,
): ResourceDelta {
  const n = Math.max(1, sampleCount);
  return {
    cpuUserPlusSystemUs: cpuUs,
    cpuUsPerSample: Number((cpuUs / n).toFixed(1)),
    rssBeforeBytes: before.rssBytes,
    rssAfterBytes: after.rssBytes,
    heapBeforeBytes: before.heapUsedBytes,
    heapAfterBytes: after.heapUsedBytes,
    rssDeltaBytes: after.rssBytes - before.rssBytes,
    heapDeltaBytes: after.heapUsedBytes - before.heapUsedBytes,
  };
}
