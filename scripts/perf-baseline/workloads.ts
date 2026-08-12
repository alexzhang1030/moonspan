/**
 * Fixed R2-04 workloads from the restructure performance plan.
 * Identities are stable; runners measure them under each system under test.
 */

export type WorkloadId =
  | "pointcloud2-1mb-10hz"
  | "ten-image-topics"
  | "thousand-small-topics";

export type WorkloadSpec = {
  id: WorkloadId;
  description: string;
  /** Nominal publish rate per topic (Hz). */
  rateHz: number;
  /** Topics exercised in this workload. */
  topicCount: number;
  /** Approximate CDR / payload body bytes per sample. */
  payloadBytes: number;
  /** Steady-state samples measured after warmup (per topic unless noted). */
  sampleCount: number;
  warmup: number;
};

/** PointCloud2 ~1 MiB point payload (matches R2-02 scale). */
export const POINT_PAYLOAD_BYTES = 87_381 * 12; // 1_048_572

export const WORKLOADS: Record<WorkloadId, WorkloadSpec> = {
  "pointcloud2-1mb-10hz": {
    id: "pointcloud2-1mb-10hz",
    description: "PointCloud2 ~1 MB @ 10 Hz (single topic)",
    rateHz: 10,
    topicCount: 1,
    payloadBytes: POINT_PAYLOAD_BYTES,
    sampleCount: 30,
    warmup: 2,
  },
  "ten-image-topics": {
    id: "ten-image-topics",
    description: "Ten concurrent image topics (~100 KiB each @ 10 Hz)",
    rateHz: 10,
    topicCount: 10,
    payloadBytes: 100 * 1024,
    sampleCount: 20,
    warmup: 2,
  },
  "thousand-small-topics": {
    id: "thousand-small-topics",
    description: "One thousand small topics (1 KiB each @ 10 Hz fan-in sample)",
    rateHz: 10,
    topicCount: 1000,
    payloadBytes: 1024,
    // Cap measured publishes: 1000 topics × full 30 samples is too heavy for
    // host CI; measure a representative fan-in of 2 samples/topic after warmup.
    sampleCount: 2,
    warmup: 1,
  },
};

export function fillPayload(bytes: number, seed = 0): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < out.length; i += 64) {
    out[i] = (i + seed) & 0xff;
  }
  return out;
}
