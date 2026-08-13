import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  COPY_PATHS,
  ROSBRIDGE_JSON_BASE64_EXPANSION,
} from "./perf-baseline/copy-path.ts";
import {
  decodePointCloud2Cdr,
  decodeStdMsgsStringCdr,
  encodeStdMsgsStringCdr,
  encodeXyzPointCloud2Cdr,
  stdMsgsStringCdrOfSize,
} from "./perf-baseline/cdr-payloads.ts";
import {
  INGEST_SIZES,
  measureIngestSuite,
  measureRclwebIngest,
} from "./perf-baseline/ingest-latency.ts";
import {
  FOXGLOVE_MESSAGE_DATA_HEADER_BYTES,
  R2WP_FRAME_HEADER_BYTES,
  measureAllProtocolCosts,
} from "./perf-baseline/protocol-cost.ts";
import { summarize, percentile } from "./perf-baseline/stats.ts";
import { snapshotMemory } from "./perf-baseline/resources.ts";
import {
  POINT_PAYLOAD_BYTES,
  WORKLOADS,
  fillPayload,
} from "./perf-baseline/workloads.ts";
import { scriptedPeerFixtures } from "../typescript/test/scripted-peer.ts";

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

describe("resources", () => {
  test("snapshotMemory returns RSS", () => {
    const m = snapshotMemory();
    expect(m.rssBytes).toBeGreaterThan(0);
    expect(m.heapUsedBytes).toBeGreaterThan(0);
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
    expect(byProto["rosbridge-json-base64"]!.expansionRatio).toBeGreaterThan(
      ROSBRIDGE_JSON_BASE64_EXPANSION,
    );
    expect(byProto["rclweb-r2wp"]!.expansionRatio).toBeLessThan(1.01);
  });
});

describe("copy-path model", () => {
  test("rclweb stays at two controllable copies with zero gateway framing", () => {
    const rclweb = COPY_PATHS.rclweb;
    expect(rclweb.controllable).toBe(2);
    const framing = rclweb.stages.find((s) => s.stage === "gateway framing");
    expect(framing?.copies).toBe(0);
    const wasm = rclweb.stages.find((s) => s.stage === "Worker → wasm");
    expect(wasm?.copies).toBe(1);
  });

  test("Foxglove binary matches rclweb copy count but spends the extra copy on framing", () => {
    expect(COPY_PATHS["foxglove-bridge"].controllable).toBe(2);
    const framing = COPY_PATHS["foxglove-bridge"].stages.find(
      (s) => s.stage === "gateway framing",
    );
    expect(framing?.copies).toBe(1);
  });

  test("rosbridge JSON takes more controllable copies than CDR-on-the-wire paths", () => {
    expect(COPY_PATHS["rosbridge-json"].controllable).toBeGreaterThan(
      COPY_PATHS.rclweb.controllable,
    );
    expect(COPY_PATHS["rosbridge-cbor-raw"].controllable).toBe(
      COPY_PATHS.rclweb.controllable,
    );
  });
});

describe("ingest latency / CPU / mem harness", () => {
  test("primary sizes match validation targets plus PointCloud2 ~1 MiB", () => {
    expect(INGEST_SIZES.map((s) => s.id)).toEqual([
      "1KiB",
      "32KiB",
      "PointCloud2_1MiB",
    ]);
    expect(INGEST_SIZES[0]!.payloadBytes).toBe(1024);
    expect(INGEST_SIZES[0]!.sampleCount).toBe(200);
    expect(INGEST_SIZES[1]!.payloadBytes).toBe(32 * 1024);
    expect(INGEST_SIZES[2]!.payloadBytes).toBe(POINT_PAYLOAD_BYTES);
  });

  test("std_msgs String CDR matches the scripted-peer fixture", () => {
    const fixtures = scriptedPeerFixtures();
    const payload = fixtures.sample.subarray(32);
    expect(encodeStdMsgsStringCdr("hello-from-fixture")).toEqual(payload);
  });

  test("PointCloud2 4-point CDR matches the scripted-peer fixture", () => {
    const fixtures = scriptedPeerFixtures();
    const payload = fixtures.pointCloud2Sample.subarray(32);
    expect(encodeXyzPointCloud2Cdr(4, true)).toEqual(payload);
  });

  test("JS CDR decode round-trips String and PointCloud2", () => {
    expect(decodeStdMsgsStringCdr(encodeStdMsgsStringCdr("hello-from-fixture"))).toBe(
      "hello-from-fixture",
    );
    const cloud = decodePointCloud2Cdr(encodeXyzPointCloud2Cdr(4, true));
    expect(cloud.width).toBe(4);
    expect(cloud.data.byteLength).toBe(48);
    expect(cloud.fields.map((f) => f.name)).toEqual(["x", "y", "z"]);
  });

  test("string CDR ofSize hits the requested stream length", () => {
    expect(stdMsgsStringCdrOfSize(1024).byteLength).toBe(1024);
    expect(stdMsgsStringCdrOfSize(32 * 1024).byteLength).toBe(32 * 1024);
  });

  const wasmPath = path.join(import.meta.dir, "..", "typescript/wasm/rclweb.wasm");
  const hasWasm = existsSync(wasmPath);

  test.skipIf(!hasWasm)(
    "rclweb ingest reports latency, CPU, and RSS for 1 KiB",
    async () => {
      const bytes = readFileSync(wasmPath);
      const row = await measureRclwebIngest(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        INGEST_SIZES[0]!,
        8,
        2,
      );
      expect(row.hop).toBe("rclweb.ingest");
      expect(row.latencyMs.n).toBe(8);
      expect(row.latencyMs.p50).toBeGreaterThanOrEqual(0);
      expect(row.latencyMs.p99).toBeGreaterThanOrEqual(row.latencyMs.p50);
      // Hang guard, not the 3 ms e2e engineering target.
      expect(row.latencyMs.p50).toBeLessThan(50);
      expect(row.resources.cpuUsPerSample).toBeGreaterThanOrEqual(0);
      expect(row.resources.rssAfterBytes).toBeGreaterThan(0);
    },
  );

  test.skipIf(!hasWasm)(
    "ingest suite includes Foxglove and rosbridge envelope hops",
    async () => {
      const bytes = readFileSync(wasmPath);
      const rows = await measureIngestSuite(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        [INGEST_SIZES[0]!],
        6,
        2,
      );
      expect(rows.map((r) => r.hop)).toEqual([
        "rclweb.ingest",
        "foxglove.cdrDecode",
        "rosbridge.jsonDecode",
      ]);
      for (const row of rows) {
        expect(row.latencyMs.n).toBe(6);
        expect(row.resources.cpuUsPerSample).toBeGreaterThanOrEqual(0);
      }
    },
  );
});
