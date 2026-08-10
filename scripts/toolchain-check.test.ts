import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkToolchain,
  extractTomlTable,
  parseBunVersionOutput,
  parseCargoWorkspaceRustVersion,
  parseJustVersionOutput,
  parseMoonBundleMooncId,
  parseMooncVersionOutput,
  parsePackageJsonBunPins,
  parseRustToolVersionOutput,
  parseRustToolchainToml,
  parseSingleLinePin,
  probeMoonBundle,
  REQUIRED_PIN_FILES,
  type CommandRunner,
} from "./toolchain-check.ts";

const tempRoots: string[] = [];

async function fixtureRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "moonspan-toolchain-"));
  tempRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop()!;
    await rm(root, { recursive: true, force: true });
  }
});

const pinFiles = {
  ".bun-version": "1.3.14\n",
  ".moon-version": "0.10.6+80dc50f24\n",
  ".just-version": "1.50.0\n",
  "rust-toolchain.toml":
    '[toolchain]\nchannel = "1.97.1"\nprofile = "minimal"\ncomponents = ["rustfmt", "clippy"]\n',
  "Cargo.toml":
    '[workspace]\nresolver = "3"\nmembers = ["rclwebd"]\n\n[workspace.package]\nversion = "0.0.0"\nedition = "2024"\nrust-version = "1.97.1"\n',
  "package.json":
    '{\n  "name": "moonspan",\n  "packageManager": "bun@1.3.14",\n  "engines": { "bun": "1.3.14" }\n}\n',
};

const moonBundleOk = `moon 0.1.20260803 (c19f78e 2026-08-03) /tmp/moon/bin/moon
moonc v0.10.6+80dc50f24 (2026-08-04) /tmp/moon/bin/moonc
moonrun 0.1.20260803 (c19f78e 2026-08-03) /tmp/moon/bin/moonrun

Feature flags enabled: rr_moon_mod,rr_moon_pkg
`;

function matchingRunner(): CommandRunner {
  return (command, args) => {
    switch (command) {
      case "bun":
        return { status: 0, stdout: "1.3.14+0d9b296af\n", stderr: "" };
      case "rustc":
        return {
          status: 0,
          stdout: "rustc 1.97.1 (8bab26f4f 2026-07-14)\n",
          stderr: "",
        };
      case "cargo":
        return {
          status: 0,
          stdout: "cargo 1.97.1 (c980f4866 2026-06-30)\n",
          stderr: "",
        };
      case "moon":
        if (args[0] === "version" && args[1] === "--all") {
          return { status: 0, stdout: moonBundleOk, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected moon args" };
      case "moonc":
        return {
          status: 0,
          stdout: "v0.10.6+80dc50f24 (2026-08-04)\n",
          stderr: "",
        };
      case "just":
        return { status: 0, stdout: "just 1.50.0\n", stderr: "" };
      default:
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: `spawn ${command} ENOENT`,
        };
    }
  };
}

describe("pin parsers", () => {
  test("parseSingleLinePin accepts one value", () => {
    expect(parseSingleLinePin("1.50.0\n", ".just-version")).toBe("1.50.0");
    expect(
      parseSingleLinePin("# comment\n0.10.6+80dc50f24\n", ".moon-version"),
    ).toBe("0.10.6+80dc50f24");
  });

  test("parseSingleLinePin rejects empty or multi-value files", () => {
    expect(() => parseSingleLinePin("\n", ".bun-version")).toThrow(/exactly one/);
    expect(() => parseSingleLinePin("a\nb\n", ".bun-version")).toThrow(
      /exactly one/,
    );
  });

  test("parseRustToolchainToml reads channel from [toolchain]", () => {
    expect(
      parseRustToolchainToml('[toolchain]\nchannel = "1.97.1"\n'),
    ).toBe("1.97.1");
  });

  test("parseRustToolchainToml ignores channel outside [toolchain]", () => {
    expect(() =>
      parseRustToolchainToml(
        'channel = "1.91.1"\n\n[toolchain]\nprofile = "minimal"\n',
      ),
    ).toThrow(/missing channel/);
    expect(() =>
      parseRustToolchainToml(
        '[profile]\nchannel = "1.91.1"\n\n[toolchain]\nprofile = "minimal"\n',
      ),
    ).toThrow(/missing channel/);
  });

  test("parseCargoWorkspaceRustVersion reads [workspace.package] only", () => {
    expect(
      parseCargoWorkspaceRustVersion(
        '[workspace.package]\nversion = "0.0.0"\nrust-version = "1.97.1"\n',
      ),
    ).toBe("1.97.1");
  });

  test("parseCargoWorkspaceRustVersion ignores rust-version outside workspace.package", () => {
    expect(() =>
      parseCargoWorkspaceRustVersion(
        '[package]\nrust-version = "1.91.1"\n\n[workspace.package]\nversion = "0.0.0"\n',
      ),
    ).toThrow(/missing rust-version/);
    expect(
      parseCargoWorkspaceRustVersion(
        '[package]\nrust-version = "1.91.1"\n\n[workspace.package]\nversion = "0.0.0"\nrust-version = "1.97.1"\n\n[profile.release]\nrust-version = "1.88.0"\n',
      ),
    ).toBe("1.97.1");
  });

  test("extractTomlTable stops at the next table header", () => {
    const body = extractTomlTable(
      '[workspace.package]\nrust-version = "1.97.1"\n\n[profile.release]\nrust-version = "1.88.0"\n',
      "workspace.package",
    );
    expect(body).toContain('rust-version = "1.97.1"');
    expect(body).not.toContain("1.88.0");
  });

  test("parsePackageJsonBunPins reads packageManager and engines", () => {
    expect(
      parsePackageJsonBunPins(
        '{"packageManager":"bun@1.3.14","engines":{"bun":"1.3.14"}}',
      ),
    ).toEqual({ packageManager: "bun@1.3.14", enginesBun: "1.3.14" });
  });

  test("tool version parsers", () => {
    expect(parseBunVersionOutput("1.3.14+0d9b296af\n")).toBe("1.3.14");
    expect(parseBunVersionOutput("1.3.14\n")).toBe("1.3.14");
    expect(
      parseRustToolVersionOutput("rustc 1.97.1 (8bab26f4f 2026-07-14)\n", "rustc"),
    ).toBe("1.97.1");
    expect(
      parseRustToolVersionOutput("cargo 1.97.1 (c980f4866 2026-06-30)\n", "cargo"),
    ).toBe("1.97.1");
    expect(parseMooncVersionOutput("v0.10.6+80dc50f24 (2026-08-04)\n")).toBe(
      "0.10.6+80dc50f24",
    );
    expect(parseMoonBundleMooncId(moonBundleOk)).toBe("0.10.6+80dc50f24");
    expect(parseJustVersionOutput("just 1.50.0\n")).toBe("1.50.0");
  });
});

describe("checkToolchain", () => {
  test("success when every tool matches project pins", async () => {
    const root = await fixtureRoot(pinFiles);
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.pins).toEqual({
      bun: "1.3.14",
      rust: "1.97.1",
      moonc: "0.10.6+80dc50f24",
      just: "1.50.0",
    });
    expect(result.tools.every((t) => t.ok)).toBe(true);
    expect(result.tools.map((t) => t.tool)).toEqual([
      "bun",
      "rustc",
      "cargo",
      "moon",
      "moonc",
      "just",
    ]);
    expect(result.tools.find((t) => t.tool === "moon")?.detail).toBe(
      "moon: bundle moonc 0.10.6+80dc50f24",
    );
  });

  test("missing tools produce deterministic sorted diagnostics", async () => {
    const root = await fixtureRoot(pinFiles);
    const run: CommandRunner = () => ({
      status: null,
      stdout: "",
      stderr: "",
      error: "spawn ENOENT",
    });
    const result = await checkToolchain({ root, run });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(6);
    expect(result.diagnostics).toEqual([...result.diagnostics].sort());
    expect(result.diagnostics[0]).toContain("bun: not runnable");
    expect(result.diagnostics.some((d) => d.startsWith("moon: not runnable"))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.startsWith("moonc: not runnable"))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.startsWith("just: not runnable"))).toBe(
      true,
    );
  });

  test("missing moon alone fails bundle probe", async () => {
    const root = await fixtureRoot(pinFiles);
    const run: CommandRunner = (command, args) => {
      if (command === "moon") {
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: "spawn moon ENOENT",
        };
      }
      return matchingRunner()(command, args);
    };
    const result = await checkToolchain({ root, run });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      "moon: not runnable (spawn moon ENOENT)",
    ]);
  });

  test("moon bundle mismatch when CLI omits pinned moonc id", async () => {
    const root = await fixtureRoot(pinFiles);
    const staleBundle = `moon 0.1.20250606 (c80dae2 2025-06-06) /home/.moon/bin/moon
moonc v0.10.4 (2026-07-13) /home/.moon/bin/moonc
moonrun 0.1.20250606 (c80dae2 2025-06-06) /home/.moon/bin/moonrun
`;
    const run: CommandRunner = (command, args) => {
      if (command === "moon") {
        return { status: 0, stdout: staleBundle, stderr: "" };
      }
      return matchingRunner()(command, args);
    };
    const result = await checkToolchain({ root, run });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain(
      "moon: bundle moonc expected 0.10.6+80dc50f24, found 0.10.4",
    );
  });

  test("version mismatches report expected vs found", async () => {
    const root = await fixtureRoot(pinFiles);
    const run: CommandRunner = (command, args) => {
      if (command === "bun") {
        return { status: 0, stdout: "1.2.0\n", stderr: "" };
      }
      if (command === "just") {
        return { status: 0, stdout: "just 1.36.0\n", stderr: "" };
      }
      return matchingRunner()(command, args);
    };
    const result = await checkToolchain({ root, run });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      "bun: expected 1.3.14, found 1.2.0",
      "just: expected 1.50.0, found 1.36.0",
    ]);
  });

  test("moonc short form mismatch against full pin", async () => {
    const root = await fixtureRoot(pinFiles);
    const run: CommandRunner = (command, args) => {
      if (command === "moonc") {
        return { status: 0, stdout: "v0.10.4\n", stderr: "" };
      }
      return matchingRunner()(command, args);
    };
    const result = await checkToolchain({ root, run });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain(
      "moonc: expected 0.10.6+80dc50f24, found 0.10.4",
    );
  });

  test("package.json bun pin drift is reported", async () => {
    const root = await fixtureRoot({
      ...pinFiles,
      "package.json":
        '{\n  "packageManager": "bun@1.2.0",\n  "engines": { "bun": "1.2.0" }\n}\n',
    });
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      "package.json engines.bun: expected 1.3.14, found 1.2.0",
      "package.json packageManager: expected bun@1.3.14, found bun@1.2.0",
    ]);
  });

  test("Cargo.toml rust-version drift is reported", async () => {
    const root = await fixtureRoot({
      ...pinFiles,
      "Cargo.toml":
        '[workspace.package]\nversion = "0.0.0"\nrust-version = "1.91.1"\n',
    });
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      "Cargo.toml workspace rust-version: expected 1.97.1, found 1.91.1",
    ]);
  });

  test("missing pin file yields concise failure", async () => {
    const root = await fixtureRoot({
      ".bun-version": "1.3.14\n",
      // .moon-version omitted
      ".just-version": "1.50.0\n",
      "rust-toolchain.toml": pinFiles["rust-toolchain.toml"],
      "Cargo.toml": pinFiles["Cargo.toml"],
      "package.json": pinFiles["package.json"],
    });
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(false);
    expect(result.pins).toBeNull();
    expect(result.diagnostics).toEqual([".moon-version: missing or unreadable"]);
  });

  test("multiple missing pin files report in fixed REQUIRED_PIN_FILES order", async () => {
    // Omit .moon-version and Cargo.toml (order in REQUIRED_PIN_FILES:
    // .bun-version, .moon-version, .just-version, rust-toolchain.toml,
    // package.json, Cargo.toml).
    const root = await fixtureRoot({
      ".bun-version": "1.3.14\n",
      ".just-version": "1.50.0\n",
      "rust-toolchain.toml": pinFiles["rust-toolchain.toml"],
      "package.json": pinFiles["package.json"],
    });
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(false);
    expect(result.pins).toBeNull();
    expect(result.tools).toEqual([]);
    expect(result.diagnostics).toEqual([
      ".moon-version: missing or unreadable",
      "Cargo.toml: missing or unreadable",
    ]);
    expect(REQUIRED_PIN_FILES.indexOf(".moon-version")).toBeLessThan(
      REQUIRED_PIN_FILES.indexOf("Cargo.toml"),
    );
  });

  test("multiple missing pin files keep order independent of omission pattern", async () => {
    // Omit package.json and .just-version; fixed order must still list
    // .just-version before package.json.
    const root = await fixtureRoot({
      ".bun-version": "1.3.14\n",
      ".moon-version": "0.10.6+80dc50f24\n",
      "rust-toolchain.toml": pinFiles["rust-toolchain.toml"],
      "Cargo.toml": pinFiles["Cargo.toml"],
    });
    const result = await checkToolchain({ root, run: matchingRunner() });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      ".just-version: missing or unreadable",
      "package.json: missing or unreadable",
    ]);
  });

  test("probeMoonBundle success helper", () => {
    const result = probeMoonBundle(matchingRunner(), "0.10.6+80dc50f24");
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("moon: bundle moonc 0.10.6+80dc50f24");
  });
});
