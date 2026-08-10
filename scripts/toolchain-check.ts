#!/usr/bin/env bun
/**
 * Moonspan toolchain pin checker.
 *
 * Reads project pin files and verifies exact installed tool identities.
 * `.moon-version` and `.just-version` are Moonspan contracts consumed by this
 * script, the root justfile, and the future CI workflow after it lands.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type PinSet = {
  bun: string;
  rust: string;
  moonc: string;
  just: string;
};

export type ToolVersion = {
  tool: string;
  expected: string;
  actual: string | null;
  ok: boolean;
  detail: string;
};

export type ToolchainCheckResult = {
  ok: boolean;
  pins: PinSet | null;
  tools: ToolVersion[];
  diagnostics: string[];
};

export type CommandRunner = (
  command: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string; error?: string };

export type ToolchainCheckOptions = {
  root: string;
  run?: CommandRunner;
};

/** Fixed read order for pin/manifest files (diagnostics follow this order). */
export const REQUIRED_PIN_FILES = [
  ".bun-version",
  ".moon-version",
  ".just-version",
  "rust-toolchain.toml",
  "package.json",
  "Cargo.toml",
] as const;

export type RequiredPinFile = (typeof REQUIRED_PIN_FILES)[number];

/** Ordered pin/manifest load failure with stable diagnostics. */
export class PinManifestError extends Error {
  readonly diagnostics: string[];

  constructor(diagnostics: string[]) {
    super(diagnostics.join("; "));
    this.name = "PinManifestError";
    this.diagnostics = diagnostics;
  }
}

const DEFAULT_RUN: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    return {
      status: null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error.message,
    };
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

function sortedDiagnostics(items: string[]): string[] {
  return [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the body of a top-level TOML table `[header]`, stopping at the next
 * top-level table header. Returns null when the table is absent.
 */
export function extractTomlTable(content: string, header: string): string | null {
  const lines = content.split(/\r?\n/);
  const headerRe = new RegExp(`^\\[${escapeRegExp(header)}\\]\\s*(?:#.*)?$`);
  const anyHeaderRe = /^\[[^\]]+\]\s*(?:#.*)?$/;
  let index = 0;
  while (index < lines.length && !headerRe.test(lines[index]!)) {
    index += 1;
  }
  if (index >= lines.length) return null;
  index += 1;
  const body: string[] = [];
  while (index < lines.length && !anyHeaderRe.test(lines[index]!)) {
    body.push(lines[index]!);
    index += 1;
  }
  return body.join("\n");
}

/** Read a single-line pin file and return the trimmed non-empty value. */
export function parseSingleLinePin(content: string, label: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 1) {
    throw new Error(
      `${label}: expected exactly one non-empty pin line, found ${lines.length}`,
    );
  }
  return lines[0]!;
}

/** Parse channel only from the [toolchain] table in rust-toolchain.toml. */
export function parseRustToolchainToml(content: string): string {
  const section = extractTomlTable(content, "toolchain");
  if (section === null) {
    throw new Error("rust-toolchain.toml: missing [toolchain] section");
  }
  const match = section.match(/^\s*channel\s*=\s*"([^"]+)"\s*(?:#.*)?$/m);
  if (!match) {
    throw new Error(
      'rust-toolchain.toml: missing channel = "..." in [toolchain]',
    );
  }
  return match[1]!;
}

/** Parse rust-version only from the [workspace.package] table in Cargo.toml. */
export function parseCargoWorkspaceRustVersion(content: string): string {
  const section = extractTomlTable(content, "workspace.package");
  if (section === null) {
    throw new Error("Cargo.toml: missing [workspace.package] section");
  }
  const match = section.match(/^\s*rust-version\s*=\s*"([^"]+)"\s*(?:#.*)?$/m);
  if (!match) {
    throw new Error(
      'Cargo.toml: missing rust-version = "..." in [workspace.package]',
    );
  }
  return match[1]!;
}

/** Parse packageManager and engines.bun from root package.json. */
export function parsePackageJsonBunPins(content: string): {
  packageManager: string;
  enginesBun: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("package.json: invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("package.json: expected a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const packageManager = obj.packageManager;
  if (typeof packageManager !== "string" || packageManager.length === 0) {
    throw new Error("package.json: missing packageManager string");
  }
  const engines = obj.engines;
  if (!engines || typeof engines !== "object") {
    throw new Error("package.json: missing engines object");
  }
  const enginesBun = (engines as Record<string, unknown>).bun;
  if (typeof enginesBun !== "string" || enginesBun.length === 0) {
    throw new Error("package.json: missing engines.bun string");
  }
  return { packageManager, enginesBun };
}

/** Normalize `bun --version` output (`1.3.14` or `1.3.14+0d9b296af`). */
export function parseBunVersionOutput(stdout: string): string {
  const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const match = line.match(/^(\d+\.\d+\.\d+)/);
  if (!match) {
    throw new Error(`bun: unable to parse version from ${JSON.stringify(stdout)}`);
  }
  return match[1]!;
}

/** Normalize `rustc --version` / `cargo --version` first token after the name. */
export function parseRustToolVersionOutput(
  stdout: string,
  tool: "rustc" | "cargo",
): string {
  const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const match = line.match(new RegExp(`^${tool}\\s+(\\d+\\.\\d+\\.\\d+)`));
  if (!match) {
    throw new Error(
      `${tool}: unable to parse version from ${JSON.stringify(stdout)}`,
    );
  }
  return match[1]!;
}

/**
 * Normalize `moonc -v` output.
 * Examples: `v0.10.6+80dc50f24 (2026-08-04)` → `0.10.6+80dc50f24`
 */
export function parseMooncVersionOutput(stdout: string): string {
  const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const match = line.match(/^v?(\d+\.\d+\.\d+(?:\+[0-9A-Za-z]+)?)/);
  if (!match) {
    throw new Error(
      `moonc: unable to parse version from ${JSON.stringify(stdout)}`,
    );
  }
  return match[1]!;
}

/**
 * Extract the moonc build ID embedded in `moon version --all` output.
 * Requires a `moonc ...` line that carries the full compiler build ID.
 */
export function parseMoonBundleMooncId(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("moonc")) continue;
    const match = line.match(
      /moonc\s+v?(\d+\.\d+\.\d+(?:\+[0-9A-Za-z]+)?)/,
    );
    if (match) return match[1]!;
  }
  throw new Error(
    `moon: unable to parse moonc build ID from ${JSON.stringify(stdout)}`,
  );
}

/** Normalize `just --version` output (`just 1.50.0`). */
export function parseJustVersionOutput(stdout: string): string {
  const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const match = line.match(/^just\s+(\d+\.\d+\.\d+)/);
  if (!match) {
    throw new Error(
      `just: unable to parse version from ${JSON.stringify(stdout)}`,
    );
  }
  return match[1]!;
}

export type LoadedManifests = {
  pins: PinSet;
  consistency: string[];
};

/**
 * Read pin/manifest files in `REQUIRED_PIN_FILES` order.
 * Missing or unreadable files produce diagnostics in that same fixed order.
 */
export async function loadPinsAndManifests(
  root: string,
): Promise<LoadedManifests> {
  const contents = new Map<RequiredPinFile, string>();
  const readDiagnostics: string[] = [];

  for (const rel of REQUIRED_PIN_FILES) {
    try {
      contents.set(rel, await readFile(path.join(root, rel), "utf8"));
    } catch {
      readDiagnostics.push(`${rel}: missing or unreadable`);
    }
  }

  if (readDiagnostics.length > 0) {
    throw new PinManifestError(readDiagnostics);
  }

  const bunRaw = contents.get(".bun-version")!;
  const moonRaw = contents.get(".moon-version")!;
  const justRaw = contents.get(".just-version")!;
  const rustToml = contents.get("rust-toolchain.toml")!;
  const packageJson = contents.get("package.json")!;
  const cargoToml = contents.get("Cargo.toml")!;

  const pins: PinSet = {
    bun: parseSingleLinePin(bunRaw, ".bun-version"),
    moonc: parseSingleLinePin(moonRaw, ".moon-version"),
    just: parseSingleLinePin(justRaw, ".just-version"),
    rust: parseRustToolchainToml(rustToml),
  };

  const consistency: string[] = [];
  const pkg = parsePackageJsonBunPins(packageJson);
  const expectedPackageManager = `bun@${pins.bun}`;
  if (pkg.packageManager !== expectedPackageManager) {
    consistency.push(
      `package.json packageManager: expected ${expectedPackageManager}, found ${pkg.packageManager}`,
    );
  }
  if (pkg.enginesBun !== pins.bun) {
    consistency.push(
      `package.json engines.bun: expected ${pins.bun}, found ${pkg.enginesBun}`,
    );
  }

  const cargoRust = parseCargoWorkspaceRustVersion(cargoToml);
  if (cargoRust !== pins.rust) {
    consistency.push(
      `Cargo.toml workspace rust-version: expected ${pins.rust}, found ${cargoRust}`,
    );
  }

  return { pins, consistency: sortedDiagnostics(consistency) };
}

function probeTool(
  run: CommandRunner,
  tool: string,
  args: string[],
  expected: string,
  parse: (stdout: string) => string,
): ToolVersion {
  const result = run(tool, args);
  if (result.error || result.status === null) {
    return {
      tool,
      expected,
      actual: null,
      ok: false,
      detail: result.error
        ? `${tool}: not runnable (${result.error})`
        : `${tool}: failed to spawn`,
    };
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout).trim();
    return {
      tool,
      expected,
      actual: null,
      ok: false,
      detail: `${tool}: exit ${result.status}${err ? ` (${err})` : ""}`,
    };
  }
  try {
    const actual = parse(result.stdout);
    if (actual !== expected) {
      return {
        tool,
        expected,
        actual,
        ok: false,
        detail: `${tool}: expected ${expected}, found ${actual}`,
      };
    }
    return {
      tool,
      expected,
      actual,
      ok: true,
      detail: `${tool}: ${actual}`,
    };
  } catch (error) {
    return {
      tool,
      expected,
      actual: null,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Probe the moon CLI bundle via `moon version --all`.
 * The full output must embed the exact pinned moonc build ID so a stale moon
 * binary cannot pair with a separate moonc and still pass.
 */
export function probeMoonBundle(
  run: CommandRunner,
  expectedMoonc: string,
): ToolVersion {
  const tool = "moon";
  const result = run(tool, ["version", "--all"]);
  if (result.error || result.status === null) {
    return {
      tool,
      expected: expectedMoonc,
      actual: null,
      ok: false,
      detail: result.error
        ? `${tool}: not runnable (${result.error})`
        : `${tool}: failed to spawn`,
    };
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout).trim();
    return {
      tool,
      expected: expectedMoonc,
      actual: null,
      ok: false,
      detail: `${tool}: exit ${result.status}${err ? ` (${err})` : ""}`,
    };
  }
  const stdout = result.stdout;
  const hasExactId =
    stdout.includes(expectedMoonc) || stdout.includes(`v${expectedMoonc}`);
  let parsedId: string | null = null;
  try {
    parsedId = parseMoonBundleMooncId(stdout);
  } catch (error) {
    return {
      tool,
      expected: expectedMoonc,
      actual: null,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!hasExactId || parsedId !== expectedMoonc) {
    return {
      tool,
      expected: expectedMoonc,
      actual: parsedId,
      ok: false,
      detail: `moon: bundle moonc expected ${expectedMoonc}, found ${parsedId}`,
    };
  }
  return {
    tool,
    expected: expectedMoonc,
    actual: parsedId,
    ok: true,
    detail: `moon: bundle moonc ${parsedId}`,
  };
}

export async function checkToolchain(
  options: ToolchainCheckOptions,
): Promise<ToolchainCheckResult> {
  const run = options.run ?? DEFAULT_RUN;

  let loaded: LoadedManifests;
  try {
    loaded = await loadPinsAndManifests(options.root);
  } catch (error) {
    if (error instanceof PinManifestError) {
      return {
        ok: false,
        pins: null,
        tools: [],
        diagnostics: error.diagnostics,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      pins: null,
      tools: [],
      diagnostics: sortedDiagnostics([detail]),
    };
  }

  const { pins, consistency } = loaded;
  const tools: ToolVersion[] = [
    probeTool(run, "bun", ["--version"], pins.bun, parseBunVersionOutput),
    probeTool(run, "rustc", ["--version"], pins.rust, (s) =>
      parseRustToolVersionOutput(s, "rustc"),
    ),
    probeTool(run, "cargo", ["--version"], pins.rust, (s) =>
      parseRustToolVersionOutput(s, "cargo"),
    ),
    probeMoonBundle(run, pins.moonc),
    probeTool(run, "moonc", ["-v"], pins.moonc, parseMooncVersionOutput),
    probeTool(run, "just", ["--version"], pins.just, parseJustVersionOutput),
  ];

  const toolDiagnostics = tools.filter((t) => !t.ok).map((t) => t.detail);
  const diagnostics = sortedDiagnostics([...consistency, ...toolDiagnostics]);
  return {
    ok: diagnostics.length === 0,
    pins,
    tools,
    diagnostics,
  };
}

function formatReport(result: ToolchainCheckResult): string {
  const lines: string[] = ["Moonspan toolchain-check"];
  if (result.pins) {
    lines.push(
      `pins: bun=${result.pins.bun} rust=${result.pins.rust} moonc=${result.pins.moonc} just=${result.pins.just}`,
    );
  } else {
    lines.push("pins: unavailable");
  }
  for (const tool of result.tools) {
    lines.push(tool.ok ? `ok  ${tool.detail}` : `err ${tool.detail}`);
  }
  for (const d of result.diagnostics) {
    if (!result.tools.some((t) => t.detail === d)) {
      lines.push(`err ${d}`);
    }
  }
  if (result.ok) {
    lines.push("toolchain-check: all pins match");
  } else {
    lines.push(`toolchain-check: ${result.diagnostics.length} issue(s)`);
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const root = process.cwd();
  const result = await checkToolchain({ root });
  const report = formatReport(result);
  if (result.ok) {
    console.log(report);
    return 0;
  }
  console.error(report);
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
