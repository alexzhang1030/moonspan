#!/usr/bin/env bun
/**
 * R2-04 performance baseline versus Foxglove Bridge and rosbridge.
 *
 * Always measures:
 * 1) rclweb host path on the three fixed workloads
 * 2) protocol wire-cost models (R2WP / Foxglove MessageData / rosbridge JSON+b64 / CBOR-RAW)
 *
 * Live three-way compose evidence is attached when
 * `docs/evidence/r2-04-perf-live.json` exists (`just perf-baseline-live`).
 *
 * Usage: `bun run scripts/measure-perf-baseline.ts` or `just perf-baseline`
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { captureEnvironment } from "./perf-baseline/env.ts";
import { measureAllProtocolCosts } from "./perf-baseline/protocol-cost.ts";
import { measureRclwebHost } from "./perf-baseline/rclweb-host.ts";
import { probeLiveComparison } from "./perf-baseline/live-gate.ts";
import { WORKLOADS } from "./perf-baseline/workloads.ts";

const root = path.resolve(import.meta.dir, "..");
const evidenceDir = path.join(root, "docs", "evidence");
const outPath = path.join(evidenceDir, "r2-04-perf-baseline.json");
const wasmPath = path.join(root, "sdk/typescript/wasm/rclweb.wasm");

mkdirSync(evidenceDir, { recursive: true });

if (!existsSync(wasmPath)) {
  console.error(`missing wasm artifact: ${wasmPath}; run just build first`);
  process.exit(1);
}

const wasmBytes = readFileSync(wasmPath);
const environment = captureEnvironment(root);
const protocolCosts = measureAllProtocolCosts();
const rclwebHost = await measureRclwebHost(
  wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  ),
);
const live = probeLiveComparison(root);

let liveEvidence: unknown = null;
const livePath = path.join(evidenceDir, "r2-04-perf-live.json");
if (live.evidencePresent && existsSync(livePath)) {
  liveEvidence = JSON.parse(readFileSync(livePath, "utf8"));
}

const record = {
  task: "R2-04",
  kind: "perf-baseline",
  recordedAt: environment.recordedAt,
  environment,
  workloads: WORKLOADS,
  metricsContract: {
    latency: "p50/p99 (and mean/p95/min/max) in milliseconds",
    copies: "controllable host/engine copies where instrumented",
    memory: "process.memoryUsage() steady-state after each host workload",
    wireBytes: "framed bytes per sample for protocol-cost models",
    clockSync: environment.clockSyncMethod,
  },
  paths: {
    rclwebHost: {
      status: "measured",
      scope:
        "Transferable ArrayBuffer strategy + encodeHostBatch fan-in for all three workloads; large-frame engine retain probe on PointCloud2 scale",
      ...rclwebHost,
      wasm: {
        artifact: "sdk/typescript/wasm/rclweb.wasm",
        bytes: wasmBytes.byteLength,
      },
      copyBudget: {
        inboundControllableMax: 2,
        probe: rclwebHost.engineCopyProbe,
      },
    },
    protocolCostModels: {
      status: "measured",
      scope:
        "Same payload bodies framed as R2WP / Foxglove MessageData / rosbridge JSON+base64 / rosbridge CBOR-RAW. Structural comparison; not live bridge e2e.",
      results: protocolCosts,
    },
    liveBridges: {
      ...live,
      evidence: liveEvidence,
      systems: ["rclwebd", "foxglove_bridge", "rosbridge_suite"],
    },
  },
  retentionNote:
    "Committed under docs/evidence/ until D-05 (benchmark artifact retention and publication) closes; do not invent an external publication policy here.",
};

writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

const pc2 = protocolCosts.filter((r) => r.workload === "pointcloud2-1mb-10hz");
const summary = Object.fromEntries(
  pc2.map((r) => [
    r.protocol,
    { wireBytes: r.wireBytesPerSample, encodeP50: r.encodeMs.p50 },
  ]),
);

console.log(`wrote ${outPath}`);
console.log(
  JSON.stringify(
    {
      liveStatus: live.status,
      liveReason: live.reason,
      hostWorkloads: rclwebHost.workloads.map((w) => ({
        id: w.workload,
        encodeP50: w.encodeHostBatchMs.p50,
        writeP50: w.writeDrainMs.p50,
      })),
      pointCloud2Wire: summary,
      engineCopiesDelta: rclwebHost.engineCopyProbe.copiesIntoEngineDelta,
    },
    null,
    2,
  ),
);
