import { describe, expect, test } from "bun:test";
import {
  FOXGLOVE_MESSAGE_DATA_HEADER_BYTES,
  R2WP_FRAME_HEADER_BYTES,
  measureAllProtocolCosts,
} from "./perf-baseline/protocol-cost.ts";
import { summarize, percentile } from "./perf-baseline/stats.ts";
import {
  POINT_PAYLOAD_BYTES,
  WORKLOADS,
  fillPayload,
} from "./perf-baseline/workloads.ts";

describe("R2-04 workloads", () => {
  test("fixed workload identities match the performance plan", () => {
    expect(WORKLOADS["pointcloud2-1mb-10hz"].payloadBytes).toBe(
      POINT_PAYLOAD_BYTES,
    );
    expect(WORKLOADS["pointcloud2-1mb-10hz"].rateHz).toBe(10);
    expect(WORKLOADS["ten-image-topics"].topicCount).toBe(10);
    expect(WORKLOADS["thousand-small-topics"].topicCount).toBe(1000);
  });

  test("fillPayload is deterministic length", () => {
    expect(fillPayload(1024).byteLength).toBe(1024);
  });
});

describe("stats", () => {
  test("percentile and summarize", () => {
    const samples = [1, 2, 3, 4, 5];
    expect(percentile(samples, 50)).toBe(3);
    const s = summarize(samples);
    expect(s.n).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
  });
});

describe("protocol-cost models", () => {
  test("wire sizes track headers and base64 expansion", () => {
    const results = measureAllProtocolCosts();
    const pc2 = results.filter((r) => r.workload === "pointcloud2-1mb-10hz");
    const byProto = Object.fromEntries(pc2.map((r) => [r.protocol, r]));

    expect(byProto["rclweb-r2wp"]!.wireBytesPerSample).toBe(
      R2WP_FRAME_HEADER_BYTES + POINT_PAYLOAD_BYTES,
    );
    expect(byProto["foxglove-message-data"]!.wireBytesPerSample).toBe(
      FOXGLOVE_MESSAGE_DATA_HEADER_BYTES + POINT_PAYLOAD_BYTES,
    );
    // JSON+base64 must expand well above CDR body.
    expect(byProto["rosbridge-json-base64"]!.wireBytesPerSample).toBeGreaterThan(
      Math.floor(POINT_PAYLOAD_BYTES * 1.3),
    );
    expect(byProto["rosbridge-cbor-raw"]!.wireBytesPerSample).toBe(
      5 + POINT_PAYLOAD_BYTES,
    );
    // Foxglove binary stays near CDR; rosbridge JSON is the expansion outlier.
    expect(byProto["foxglove-message-data"]!.expansionRatio).toBeLessThan(1.01);
    expect(byProto["rosbridge-json-base64"]!.expansionRatio).toBeGreaterThan(1.3);
  });
});
