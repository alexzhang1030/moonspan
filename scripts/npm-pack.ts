#!/usr/bin/env bun
/**
 * Stage LICENSE/NOTICE into typescript/ and verify the npm tarball.
 *
 * --stage  copy root LICENSE and NOTICE into typescript/
 * --check  stage, pack, and require LICENSE, NOTICE, wasm, and source in the tarball
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PACKAGE_DIR_REL = "typescript";

export const REQUIRED_TARBALL_MEMBERS = [
  "package/LICENSE",
  "package/NOTICE",
  "package/README.md",
  "package/package.json",
  "package/src/index.ts",
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
      : path.join(outDir, "rcl-web-0.0.1.tgz");
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
  const pkg = JSON.parse(readFileSync(path.join(root, PACKAGE_DIR_REL, "package.json"), "utf8")) as {
    name: string;
    version: string;
    private?: boolean;
  };
  if (pkg.name !== "rcl-web" || pkg.version !== "0.0.1" || pkg.private) {
    console.error("npm-pack: package must be rcl-web@0.0.1 with private unset or false");
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
