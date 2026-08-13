import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  crateLicenseDrift,
  cratePublishExplicitlyFalse,
  parseCargoPublishMode,
  stageCrateLicenseFiles,
} from "./cargo-publish.ts";

describe("parseCargoPublishMode", () => {
  test("requires exactly one of --stage or --check", () => {
    expect(parseCargoPublishMode(["--stage"])).toBe("stage");
    expect(parseCargoPublishMode(["--check"])).toBe("check");
    expect(parseCargoPublishMode([])).toEqual({
      error: "usage: bun run scripts/cargo-publish.ts --stage|--check",
    });
    expect(parseCargoPublishMode(["--stage", "--check"])).toEqual({
      error: "usage: bun run scripts/cargo-publish.ts --stage|--check",
    });
  });
});

describe("cratePublishExplicitlyFalse", () => {
  test("detects publish = false and ignores comments", () => {
    expect(cratePublishExplicitlyFalse("publish = false\n")).toBe(true);
    expect(cratePublishExplicitlyFalse("name = \"rclweb\"\n")).toBe(false);
    expect(cratePublishExplicitlyFalse("# publish = false\n")).toBe(false);
  });
});

describe("stageCrateLicenseFiles", () => {
  test("copies root LICENSE and NOTICE into published crate dirs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rclweb-cargo-stage-"));
    mkdirSync(path.join(root, "rclweb"));
    mkdirSync(path.join(root, "rclwebd"));
    writeFileSync(path.join(root, "LICENSE"), "license-body\n");
    writeFileSync(path.join(root, "NOTICE"), "notice-body\n");
    const staged = stageCrateLicenseFiles(root);
    expect(staged.map((s) => s.crate)).toEqual(["rclweb", "rclwebd"]);
    expect(Bun.file(staged[0]!.license).text()).resolves.toBe("license-body\n");
    expect(Bun.file(staged[1]!.notice).text()).resolves.toBe("notice-body\n");
  });
});

describe("crateLicenseDrift", () => {
  test("reports crate copies that do not match the root files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rclweb-cargo-drift-"));
    mkdirSync(path.join(root, "rclweb"));
    mkdirSync(path.join(root, "rclwebd"));
    writeFileSync(path.join(root, "LICENSE"), "root-license\n");
    writeFileSync(path.join(root, "NOTICE"), "root-notice\n");
    writeFileSync(path.join(root, "rclweb", "LICENSE"), "root-license\n");
    writeFileSync(path.join(root, "rclweb", "NOTICE"), "root-notice\n");
    writeFileSync(path.join(root, "rclwebd", "LICENSE"), "stale\n");
    writeFileSync(path.join(root, "rclwebd", "NOTICE"), "root-notice\n");
    expect(crateLicenseDrift(root)).toEqual(["rclwebd/LICENSE"]);
  });
});
