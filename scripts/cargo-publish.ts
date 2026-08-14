#!/usr/bin/env bun
/**
 * Stage LICENSE/NOTICE into published crates and verify they can be packed.
 *
 * --stage  copy root LICENSE and NOTICE into rclweb/ and rclwebd/
 * --check  stage, require publish flags, dry-run rclweb, package rclwebd
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PUBLISHED_CRATES = ["rclweb", "rclwebd"] as const;
export const UNPUBLISHED_CRATES = ["protocol-fixtures", "r1_04_fixture_gen"] as const;
export const EXPECTED_CRATE_VERSION = "0.0.3";

export type CargoPublishMode = "stage" | "check";

export function parseCargoPublishMode(argv: string[]): CargoPublishMode | { error: string } {
  const flags = argv.filter((a) => a === "--stage" || a === "--check");
  if (flags.length !== 1) {
    return { error: "usage: bun run scripts/cargo-publish.ts --stage|--check" };
  }
  return flags[0] === "--check" ? "check" : "stage";
}

export function cratePublishExplicitlyFalse(toml: string): boolean {
  return /^\s*publish\s*=\s*false\s*$/m.test(toml);
}

export function stageCrateLicenseFiles(root: string): { crate: string; license: string; notice: string }[] {
  const licenseSrc = path.join(root, "LICENSE");
  const noticeSrc = path.join(root, "NOTICE");
  if (!existsSync(licenseSrc) || !existsSync(noticeSrc)) {
    throw new Error("repository LICENSE and NOTICE must exist at the root");
  }
  return PUBLISHED_CRATES.map((crate) => {
    const dir = path.join(root, crate);
    const license = path.join(dir, "LICENSE");
    const notice = path.join(dir, "NOTICE");
    copyFileSync(licenseSrc, license);
    copyFileSync(noticeSrc, notice);
    return { crate, license, notice };
  });
}

export function crateLicenseDrift(root: string): string[] {
  const licenseSrc = readFileSync(path.join(root, "LICENSE"), "utf8");
  const noticeSrc = readFileSync(path.join(root, "NOTICE"), "utf8");
  const drifted: string[] = [];
  for (const crate of PUBLISHED_CRATES) {
    const license = path.join(root, crate, "LICENSE");
    const notice = path.join(root, crate, "NOTICE");
    if (!existsSync(license) || readFileSync(license, "utf8") !== licenseSrc) {
      drifted.push(`${crate}/LICENSE`);
    }
    if (!existsSync(notice) || readFileSync(notice, "utf8") !== noticeSrc) {
      drifted.push(`${crate}/NOTICE`);
    }
  }
  return drifted;
}

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readCrateToml(root: string, crateDir: string): string {
  return readFileSync(path.join(root, crateDir, "Cargo.toml"), "utf8");
}

export function unpublishedCrateStillPrivate(root: string): string[] {
  const missing: string[] = [];
  const dirs: Record<(typeof UNPUBLISHED_CRATES)[number], string> = {
    "protocol-fixtures": "scripts/protocol-fixtures",
    r1_04_fixture_gen: "scripts/fixture-gen",
  };
  for (const name of UNPUBLISHED_CRATES) {
    if (!cratePublishExplicitlyFalse(readCrateToml(root, dirs[name]))) {
      missing.push(name);
    }
  }
  return missing;
}

export function publishedCrateBlocked(root: string): string[] {
  return PUBLISHED_CRATES.filter((crate) => cratePublishExplicitlyFalse(readCrateToml(root, crate)));
}

function main(): void {
  const parsed = parseCargoPublishMode(process.argv.slice(2));
  if (typeof parsed === "object" && "error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  const root = path.resolve(import.meta.dir, "..");
  if (parsed === "stage") {
    const staged = stageCrateLicenseFiles(root);
    console.log(`cargo-publish: status=ok mode=stage crates=${staged.map((s) => s.crate).join(",")}`);
    return;
  }
  const drifted = crateLicenseDrift(root);
  if (drifted.length) {
    console.error(`cargo-publish: crate license copies must match the root files: ${drifted.join(", ")}`);
    process.exit(1);
  }
  const blocked = publishedCrateBlocked(root);
  if (blocked.length) {
    console.error(`cargo-publish: published crates must not set publish = false: ${blocked.join(", ")}`);
    process.exit(1);
  }
  const leaked = unpublishedCrateStillPrivate(root);
  if (leaked.length) {
    console.error(`cargo-publish: fixture crates must keep publish = false: ${leaked.join(", ")}`);
    process.exit(1);
  }
  const ws = readFileSync(path.join(root, "Cargo.toml"), "utf8");
  if (
    !ws.includes(`version = "${EXPECTED_CRATE_VERSION}"`) ||
    !ws.includes(`rclweb = { path = "rclweb", version = "${EXPECTED_CRATE_VERSION}" }`)
  ) {
    console.error(`cargo-publish: workspace version must be ${EXPECTED_CRATE_VERSION} with a versioned rclweb path dep`);
    process.exit(1);
  }
  const dry = run("cargo", ["publish", "-p", "rclweb", "--locked", "--dry-run", "--allow-dirty"], root);
  if (dry.status !== 0) {
    console.error(`cargo-publish: cargo publish -p rclweb --dry-run failed: ${dry.stderr || dry.stdout}`);
    process.exit(1);
  }
  const packed = run(
    "cargo",
    ["package", "-p", "rclwebd", "--locked", "--no-verify", "--list", "--allow-dirty"],
    root,
  );
  if (packed.status !== 0) {
    console.error(`cargo-publish: cargo package -p rclwebd --list failed: ${packed.stderr || packed.stdout}`);
    process.exit(1);
  }
  const listing = new Set(packed.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  for (const member of ["LICENSE", "NOTICE", "README.md", "Cargo.toml"]) {
    if (!listing.has(member)) {
      console.error(`cargo-publish: rclwebd package missing ${member} (listing:\n${packed.stdout})`);
      process.exit(1);
    }
  }
  console.log(
    `cargo-publish: status=ok mode=check crates=${PUBLISHED_CRATES.join(",")} version=${EXPECTED_CRATE_VERSION}`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(`cargo-publish: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
