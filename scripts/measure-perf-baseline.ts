#!/usr/bin/env bun
/**
 * R2-04 performance baseline versus Foxglove Bridge and rosbridge.
 *
 * Always measures:
 * 1) rclweb host path on the three fixed workloads
 * 2) protocol wire-cost models (R2WP / Foxglove MessageData / rosbridge JSON+b64 / CBOR-RAW)
 *
 * Live three-way compose is a separate command (`just perf-baseline-live`).
 *
 * Usage: `bun run scripts/measure-perf-baseline.ts` or `just perf-baseline`
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { measureAllProtocolCosts } from "./perf-baseline/protocol-cost.ts";
import { measureRclwebHost } from "./perf-baseline/rclweb-host.ts";
import { probeLiveComparison } from "./perf-baseline/live-gate.ts";

const root = path.resolve(import.meta.dir, "..");
const wasmPath = path.join(root, "sdk/typescript/wasm/rclweb.wasm");

if (!existsSync(wasmPath)) {
  console.error(`missing wasm artifact: ${wasmPath}; run just build first`);
  process.exit(1);
}

const wasmBytes = readFileSync(wasmPath);
const protocolCosts = measureAllProtocolCosts();
const rclwebHost = await measureRclwebHost(
  wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  ),
);
const live = probeLiveComparison();

const pc2 = protocolCosts.filter((r) => r.workload === "pointcloud2-1mb-10hz");
const summary = Object.fromEntries(
  pc2.map((r) => [
    r.protocol,
    { wireBytes: r.wireBytesPerSample, encodeP50: r.encodeMs.p50 },
  ]),
);

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
