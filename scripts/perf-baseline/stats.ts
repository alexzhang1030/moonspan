export type LatencySummary = {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  n: number;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

export function summarize(samples: number[]): LatencySummary {
  if (samples.length === 0) {
    return { mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, n: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: Number((sum / sorted.length).toFixed(4)),
    p50: Number(percentile(sorted, 50).toFixed(4)),
    p95: Number(percentile(sorted, 95).toFixed(4)),
    p99: Number(percentile(sorted, 99).toFixed(4)),
    min: Number(sorted[0]!.toFixed(4)),
    max: Number(sorted[sorted.length - 1]!.toFixed(4)),
    n: sorted.length,
  };
}
