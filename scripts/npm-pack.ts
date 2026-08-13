#!/usr/bin/env bun
/**
 * Stage LICENSE/NOTICE into typescript/ and verify the npm tarball.
 *
 * --stage  copy root LICENSE and NOTICE into typescript/
 * --check  tsdown, stage LICENSE/NOTICE, pack, and require the ship set in the tarball
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PACKAGE_DIR_REL = "typescript";
export const EXPECTED_PACKAGE_NAME = "rcl-web";
export const EXPECTED_PACKAGE_VERSION = "0.0.2";

export const REQUIRED_TARBALL_MEMBERS = [
  "package/LICENSE",
  "package/NOTICE",
  "package/README.md",
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/internal.js",
  "package/dist/internal.d.ts",
  "package/dist/worker/io-worker.js",
  "package/wasm/rclweb.wasm",
] as const;

export type NpmPackMode = "stage" | "check";

export function parseNpmPackMode(argv: string[]): NpmPackMode | { error: string } {
  const flags = argv.filter((a) => a === "--stage" || a === "--check");
  if (flags.length !== 1) {
    return { error: "usage: bun run scripts/npm-pack.ts --stage|--check" };
  }
  return flags[0] === "--check" ? "check" : "stage";
}

export function stageLicenseFiles(root: string): { license: string; notice: string } {
  const pkgDir = path.join(root, PACKAGE_DIR_REL);
  const licenseSrc = path.join(root, "LICENSE");
  const noticeSrc = path.join(root, "NOTICE");
  const licenseDst = path.join(pkgDir, "LICENSE");
  const noticeDst = path.join(pkgDir, "NOTICE");
  if (!existsSync(licenseSrc) || !existsSync(noticeSrc)) {
    throw new Error("repository LICENSE and NOTICE must exist at the root");
  }
  copyFileSync(licenseSrc, licenseDst);
  copyFileSync(noticeSrc, noticeDst);
  return { license: licenseDst, notice: noticeDst };
}

export function tarballMemberMissing(
  listing: string,
  required: readonly string[] = REQUIRED_TARBALL_MEMBERS,
): string[] {
  const lines = new Set(
    listing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return required.filter((m) => !lines.has(m));
}

/** npm must ship the tsdown bundle, not TypeScript source. */
export function tarballContainsSource(listing: string): boolean {
  return listing.split(/\r?\n/).some((l) => l.trim().startsWith("package/src/"));
}

/** True when the export map still points at `.ts` source (`.d.ts` is allowed). */
export function exportsPointAtSource(exportsValue: unknown, files: string[] = []): boolean {
  const exportText = JSON.stringify(exportsValue ?? {}).replaceAll(".d.ts", "");
  return exportText.includes(".ts") || files.includes("src");
}

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function packAndList(root: string): { tarball: string; listing: string } {
  const pkgDir = path.join(root, PACKAGE_DIR_REL);
  const wasm = path.join(pkgDir, "wasm", "rclweb.wasm");
  if (!existsSync(wasm)) {
    throw new Error("typescript/wasm/rclweb.wasm is missing; run just build");
  }
  const built = run("bun", ["--bun", "tsdown"], pkgDir);
  if (built.status !== 0) {
    throw new Error(`tsdown failed: ${built.stderr || built.stdout}`);
  }
  stageLicenseFiles(root);
  const outDir = mkdtempSync(path.join(tmpdir(), "rclweb-npm-"));
  try {
    const packed = run("bun", ["pm", "pack", "--destination", outDir], pkgDir);
    if (packed.status !== 0) {
      throw new Error(`bun pm pack failed: ${packed.stderr || packed.stdout}`);
    }
    const tarballLine = packed.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.endsWith(".tgz"));
    const tarball = tarballLine && existsSync(tarballLine)
      ? tarballLine
      : path.join(outDir, `${EXPECTED_PACKAGE_NAME}-${EXPECTED_PACKAGE_VERSION}.tgz`);
    if (!existsSync(tarball)) {
      throw new Error(`packed tarball not found (stdout: ${packed.stdout.trim()})`);
    }
    const listed = run("tar", ["-tzf", tarball], root);
    if (listed.status !== 0) {
      throw new Error(`tar -tzf failed: ${listed.stderr}`);
    }
    return { tarball, listing: listed.stdout };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function main(): void {
  const parsed = parseNpmPackMode(process.argv.slice(2));
  if (typeof parsed === "object" && "error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  const root = path.resolve(import.meta.dir, "..");
  if (parsed === "stage") {
    stageLicenseFiles(root);
    console.log("npm-pack: status=ok mode=stage");
    return;
  }
  const { listing } = packAndList(root);
  const missing = tarballMemberMissing(listing);
  if (missing.length) {
    console.error(`npm-pack: missing tarball members: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (tarballContainsSource(listing)) {
    console.error("npm-pack: tarball must not include package/src (ship the tsdown dist)");
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(path.join(root, PACKAGE_DIR_REL, "package.json"), "utf8")) as {
    name: string;
    version: string;
    private?: boolean;
    exports?: unknown;
    files?: string[];
  };
  if (pkg.name !== EXPECTED_PACKAGE_NAME || pkg.version !== EXPECTED_PACKAGE_VERSION || pkg.private) {
    console.error(
      `npm-pack: package must be ${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION} with private unset or false`,
    );
    process.exit(1);
  }
  if (exportsPointAtSource(pkg.exports, pkg.files ?? [])) {
    console.error("npm-pack: exports must point at dist; files must not include src");
    process.exit(1);
  }
  console.log(
    `npm-pack: status=ok mode=check name=${pkg.name} version=${pkg.version} members=${REQUIRED_TARBALL_MEMBERS.length}`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(`npm-pack: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
