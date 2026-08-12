#!/usr/bin/env bun
/**
 * Build the rclweb wasm artifact (fat LTO) and stage it into the SDK package.
 * Records size under docs/evidence/r1-04-wasm-size.json for R-D1 reopen inputs.
 */
import { mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");
const profile = "release-wasm";
const target = "wasm32-unknown-unknown";

const build = spawnSync(
  "cargo",
  ["build", "--locked", "-p", "rclweb", "--target", target, "--profile", profile],
  { cwd: root, stdio: "inherit" },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const artifact = path.join(
  root,
  "target",
  target,
  profile,
  "rclweb.wasm",
);
const sdkWasmDir = path.join(root, "sdk", "typescript", "wasm");
await mkdir(sdkWasmDir, { recursive: true });
const staged = path.join(sdkWasmDir, "rclweb.wasm");
await copyFile(artifact, staged);

const info = await stat(staged);
const evidenceDir = path.join(root, "docs", "evidence");
await mkdir(evidenceDir, { recursive: true });
const record = {
  task: "R1-04",
  artifact: "sdk/typescript/wasm/rclweb.wasm",
  profile,
  target,
  bytes: info.size,
  kib: Math.round((info.size / 1024) * 10) / 10,
  recordedAt: new Date().toISOString(),
  note: "Hand-written poll ABI (no wasm-bindgen). Poll latency evidence lands in R1-05.",
};
await writeFile(
  path.join(evidenceDir, "r1-04-wasm-size.json"),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(
  `staged ${staged} (${record.kib} KiB) → docs/evidence/r1-04-wasm-size.json`,
);
