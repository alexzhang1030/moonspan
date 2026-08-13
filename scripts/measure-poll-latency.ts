#!/usr/bin/env bun
/**
 * Measure ClientEngine / wasm poll latency (R-D1 reopen input).
 * Prints to stdout. Does not write into the repo.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadWasm, pollEngine } from "../sdk/typescript/src/wasm/abi.ts";

const root = path.resolve(import.meta.dir, "..");

const build = spawnSync("bun", ["run", "scripts/build-wasm.ts"], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const wasmPath = path.join(root, "sdk/typescript/wasm/rclweb.wasm");
const wasmBytes = readFileSync(wasmPath);
const wasm = await loadWasm(
  wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  ),
);
const handle = wasm.rclweb_engine_new();

const warmup = 50;
const iters = 500;
const samples: number[] = [];

pollEngine(wasm, handle, [
  {
    type: "command",
    command: { type: "start", transferableArrayBuffer: true },
  },
]);

for (let i = 0; i < warmup + iters; i++) {
  const t0 = performance.now();
  pollEngine(wasm, handle, [{ type: "timer", nowMs: BigInt(i + 1) }]);
  const dtMs = performance.now() - t0;
  if (i >= warmup) samples.push(dtMs);
}

samples.sort((a, b) => a - b);
const percentile = (p: number) => {
  const idx = Math.min(
    samples.length - 1,
    Math.max(0, Math.ceil((p / 100) * samples.length) - 1),
  );
  return samples[idx]!;
};
wasm.rclweb_engine_free(handle);

const kib = Math.round((statSync(wasmPath).size / 1024) * 10) / 10;
const p50 = Number(percentile(50).toFixed(4));
const p99 = Number(percentile(99).toFixed(4));
console.log(`poll latency p50=${p50}ms p99=${p99}ms; wasm=${kib} KiB`);
