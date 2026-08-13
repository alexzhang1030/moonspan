#!/usr/bin/env bun
/**
 * Build the rclweb wasm artifact (fat LTO) and stage it into the TypeScript package.
 * Prints size to stdout (R-D1 reopen input). Does not write into the repo.
 */
import { mkdir, copyFile, stat } from "node:fs/promises";
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
const wasmDir = path.join(root, "typescript", "wasm");
await mkdir(wasmDir, { recursive: true });
const staged = path.join(wasmDir, "rclweb.wasm");
await copyFile(artifact, staged);

const info = await stat(staged);
const kib = Math.round((info.size / 1024) * 10) / 10;
console.log(`staged ${staged} (${kib} KiB)`);
