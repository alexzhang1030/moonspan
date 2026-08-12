#!/usr/bin/env bun
/**
 * rclweb toolchain pin checker.
 *
 * Verifies that installed bun, rustc, and just match the project pin files.
 * Pins live in `.bun-version`, `rust-toolchain.toml`, and `.just-version`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");

function pin(file: string, extract: (text: string) => string | null): string {
  const text = readFileSync(path.join(root, file), "utf8");
  const value = extract(text);
  if (!value) throw new Error(`could not read pin from ${file}`);
  return value;
}

function installed(command: string, args: string[], pattern: RegExp): string | null {
  const run = spawnSync(command, args, { encoding: "utf8" });
  if (run.status !== 0) return null;
  return pattern.exec(run.stdout)?.[1] ?? null;
}

const checks: { tool: string; expected: string; actual: string | null }[] = [
  {
    tool: "bun",
    expected: pin(".bun-version", (t) => t.trim() || null),
    actual: installed("bun", ["--version"], /^(\S+)/m),
  },
  {
    tool: "rustc",
    expected: pin("rust-toolchain.toml", (t) => /channel\s*=\s*"([^"]+)"/.exec(t)?.[1] ?? null),
    actual: installed("rustc", ["--version"], /^rustc (\S+)/m),
  },
  {
    tool: "just",
    expected: pin(".just-version", (t) => t.trim() || null),
    actual: installed("just", ["--version"], /^just (\S+)/m),
  },
];

let ok = true;
for (const c of checks) {
  const match = c.actual === c.expected;
  if (!match) ok = false;
  console.log(`${c.tool}: expected=${c.expected} actual=${c.actual ?? "missing"} ${match ? "ok" : "MISMATCH"}`);
}

if (!ok) process.exit(1);
console.log("toolchain-check: status=ok");
