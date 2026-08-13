import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseNpmPackMode,
  stageLicenseFiles,
  tarballContainsSource,
  tarballMemberMissing,
} from "./npm-pack.ts";

describe("parseNpmPackMode", () => {
  test("requires exactly one of --stage or --check", () => {
    expect(parseNpmPackMode(["--stage"])).toBe("stage");
    expect(parseNpmPackMode(["--check"])).toBe("check");
    expect(parseNpmPackMode([])).toEqual({
      error: "usage: bun run scripts/npm-pack.ts --stage|--check",
    });
    expect(parseNpmPackMode(["--stage", "--check"])).toEqual({
      error: "usage: bun run scripts/npm-pack.ts --stage|--check",
    });
  });
});

describe("tarballMemberMissing", () => {
  test("accepts the required ship set", () => {
    const listing = [
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
      "package/dist/host-chunk.js",
    ].join("\n");
    expect(tarballMemberMissing(listing)).toEqual([]);
  });

  test("reports missing LICENSE and NOTICE", () => {
    const listing = [
      "package/README.md",
      "package/package.json",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/dist/internal.js",
      "package/dist/internal.d.ts",
      "package/dist/worker/io-worker.js",
      "package/wasm/rclweb.wasm",
    ].join("\n");
    expect(tarballMemberMissing(listing)).toEqual(["package/LICENSE", "package/NOTICE"]);
  });

  test("rejects a tarball that still ships TypeScript source", () => {
    const listing = [
      "package/dist/index.js",
      "package/src/index.ts",
    ].join("\n");
    expect(tarballContainsSource(listing)).toBe(true);
    expect(tarballContainsSource("package/dist/index.js\n")).toBe(false);
  });
});

describe("stageLicenseFiles", () => {
  test("copies root LICENSE and NOTICE into the package dir", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rclweb-npm-stage-"));
    mkdirSync(path.join(root, "typescript"));
    writeFileSync(path.join(root, "LICENSE"), "license-body\n");
    writeFileSync(path.join(root, "NOTICE"), "notice-body\n");
    const staged = stageLicenseFiles(root);
    expect(Bun.file(staged.license).text()).resolves.toBe("license-body\n");
    expect(Bun.file(staged.notice).text()).resolves.toBe("notice-body\n");
  });
});
