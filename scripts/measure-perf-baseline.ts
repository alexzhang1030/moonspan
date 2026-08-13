#!/usr/bin/env bun
/**
 * Performance baseline versus Foxglove Bridge and rosbridge.
 *
 * Always prints (stdout only; do not commit):
 * 1) latency p50/p99/mean, CPU µs/sample, RSS/heap (primary)
 * 2) structural copy-path table
 * 3) protocol wire-cost models
 * 4) rclweb host drain + one engine retain probe
 *
 * Live three-way compose is a separate command (`just perf-baseline-live`).
 *
 * Usage: `bun run scripts/measure-perf-baseline.ts` or `just perf-baseline`
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { COPY_PATHS, formatCopyPathTable } from "./perf-baseline/copy-path.ts";
import {
  formatIngestTable,
  measureIngestSuite,
} from "./perf-baseline/ingest-latency.ts";
import { measureAllProtocolCosts } from "./perf-baseline/protocol-cost.ts";
import { measureRclwebHost } from "./perf-baseline/rclweb-host.ts";
import { POINT_PAYLOAD_BYTES } from "./perf-baseline/workloads.ts";

const root = path.resolve(import.meta.dir, "..");
const wasmPath = path.join(root, "typescript/wasm/rclweb.wasm");

if (!existsSync(wasmPath)) {
  console.error(`missing wasm artifact: ${wasmPath}; run just build first`);
  process.exit(1);
}

const wasmBytes = readFileSync(wasmPath);
const wasmBuffer = wasmBytes.buffer.slice(
  wasmBytes.byteOffset,
  wasmBytes.byteOffset + wasmBytes.byteLength,
);

const ingest = await measureIngestSuite(wasmBuffer);
const protocolCosts = measureAllProtocolCosts();
const rclwebHost = await measureRclwebHost(wasmBuffer.slice(0));

const pc2 = protocolCosts.filter((r) => r.workload === "pointcloud2-1mb-10hz");
const wireByProto = Object.fromEntries(
  pc2.map((r) => [
    r.protocol,
    {
      wireBytes: r.wireBytesPerSample,
      expansion: r.expansionRatio,
      encodeP50Ms: r.encodeMs.p50,
    },
  ]),
);

const report = {
  ingest: ingest.map((r) => ({
    hop: r.hop,
    size: r.size,
    n: r.latencyMs.n,
    p50Ms: r.latencyMs.p50,
    p99Ms: r.latencyMs.p99,
    meanMs: r.latencyMs.mean,
    cpuUsPerSample: r.resources.cpuUsPerSample,
    rssAfterBytes: r.resources.rssAfterBytes,
    rssDeltaBytes: r.resources.rssDeltaBytes,
    heapDeltaBytes: r.resources.heapDeltaBytes,
  })),
  copyPath: Object.fromEntries(
    Object.values(COPY_PATHS).map((p) => [
      p.system,
      { label: p.label, controllable: p.controllable },
    ]),
  ),
  pointCloud2Wire: wireByProto,
  engineCopiesDelta: rclwebHost.engineCopyProbe.copiesIntoEngineDelta,
  hostWorkloads: rclwebHost.workloads.map((w) => ({
    id: w.workload,
    encodeP50: w.encodeHostBatchMs.p50,
    writeP50: w.writeDrainMs.p50,
  })),
};

console.log(formatIngestTable(ingest));
console.log("");
console.log(formatCopyPathTable());
console.log("");
console.log(
  `PointCloud2 body ${POINT_PAYLOAD_BYTES} bytes — wire expansion (this run)`,
);
for (const row of pc2) {
  console.log(
    `  ${row.protocol.padEnd(24)} wire=${row.wireBytesPerSample} expansion=${row.expansionRatio} encodeP50Ms=${row.encodeMs.p50}`,
  );
}
console.log("");
console.log(
  `rclweb engine retain copies (1 MiB ingest probe): ${rclwebHost.engineCopyProbe.copiesIntoEngineDelta} (budget slot 2)`,
);
console.log("");
console.log(JSON.stringify(report, null, 2));
