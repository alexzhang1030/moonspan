import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  cp,
  symlink,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BINARY_MAX_BYTES,
  DEFAULT_AVAILABLE_CLOCK_IDS,
  DEFAULT_EXPERIMENTAL_OPCODES_ENABLED,
  DEFAULT_SELECTED_VERSION,
  FRAME_DEFAULT_CLOCK_COUNT,
  FRAME_NARROW_CLOCK_COUNT,
  FRAME_TOTAL,
  GENERATED_SOURCE_MAX_BYTES,
  MALFORMED_BOOTSTRAP,
  MALFORMED_FRAME,
  MALFORMED_TOTAL,
  MANIFEST_MAX_BYTES,
  MATERIALIZED_BINARY_TOTAL,
  NARROW_CLOCK_IDS,
  ORACLE_BOOTSTRAP_COUNT,
  ORACLE_SELECTED_FRAME_COUNT,
  OUTPUT_REL,
  RECIPE_CHANNEL_ID,
  RECIPE_CLOCK_ID,
  RECIPE_ID,
  RECIPE_OPCODE,
  RECIPE_PATTERN_HEX,
  RECIPE_PRIORITY,
  RECIPE_SEQUENCE,
  RECIPE_SHA256,
  VALID_BOOTSTRAP,
  VALID_FRAME_BINARY,
  VALID_SEGMENT_RECIPE,
  VALID_TOTAL,
  assertDecoderDistribution,
  buildBridge,
  checkBridge,
  clocksKey,
  compactBytes,
  defaultDecoderContext,
  escapeMoonString,
  expandChunks,
  fingerprintHex,
  fromHex,
  moonStringLiteral,
  parseCliMode,
  parseDecoderContext,
  resolveUnderRoot,
  resolveUnderTestdata,
  sha256Hex,
  toHex,
  validateManifestEntry,
  validateManifestShape,
  writeBridge,
} from "./protocol-moonbit-fixtures.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

async function makeTempRoot(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "moonspan-mbt-fx-"));
  tempDirs.push(d);
  await mkdir(path.join(d, "protocol/testdata"), { recursive: true });
  await mkdir(path.join(d, "rclmbt/protocol"), { recursive: true });
  await cp(path.join(ROOT, "protocol/testdata/manifest.json"), path.join(d, "protocol/testdata/manifest.json"));
  await cp(path.join(ROOT, "protocol/testdata/valid"), path.join(d, "protocol/testdata/valid"), {
    recursive: true,
  });
  await cp(
    path.join(ROOT, "protocol/testdata/malformed"),
    path.join(d, "protocol/testdata/malformed"),
    { recursive: true },
  );
  return d;
}

describe("protocol-moonbit-fixtures helpers", () => {
  test("hex roundtrip and fingerprint stable", () => {
    const b = new Uint8Array([0x52, 0x32, 0x00, 0x00, 0x00, 0x00, 0x01]);
    expect(fromHex(toHex(b))).toEqual(b);
    expect(fingerprintHex(b)).toBe("08f0aa3c2aef54dc");
    expect(fingerprintHex(b)).toBe(fingerprintHex(new Uint8Array(b)));
  });

  test("compactBytes roundtrips and compresses long runs", () => {
    const run = new Uint8Array(1000).fill(0x42);
    const chunks = compactBytes(run);
    expect(expandChunks(chunks)).toEqual(run);
    expect(chunks.some((c) => c.kind === "rep" && c.count >= 2)).toBe(true);
    const text = chunks.map((c) => (c.kind === "raw" ? c.hex : `${c.hex}*${c.count}`)).join("");
    expect(text.length).toBeLessThan(run.length);
  });

  test("parseCliMode requires exactly one mode", () => {
    expect(parseCliMode(["--write"])).toBe("write");
    expect(parseCliMode(["--check"])).toBe("check");
    expect(parseCliMode([])).toBeNull();
    expect(parseCliMode(["--write", "--check"])).toBeNull();
    expect(parseCliMode(["--write", "extra"])).toBeNull();
  });

  test("defaultDecoderContext matches parser contract", () => {
    const d = defaultDecoderContext();
    expect(d.selectedVersion).toBe(DEFAULT_SELECTED_VERSION);
    expect(d.experimentalOpcodesEnabled).toBe(DEFAULT_EXPERIMENTAL_OPCODES_ENABLED);
    expect(d.availableClockIds).toEqual([...DEFAULT_AVAILABLE_CLOCK_IDS]);
    expect(d.selectedVersion).toBe(0);
    expect(d.experimentalOpcodesEnabled).toBe(false);
    expect(d.availableClockIds).toEqual([0, 1, 2, 3, 4]);
  });

  test("parseDecoderContext fills defaults and accepts narrow clocks", () => {
    expect(parseDecoderContext(undefined).availableClockIds).toEqual([0, 1, 2, 3, 4]);
    expect(parseDecoderContext({}).availableClockIds).toEqual([0, 1, 2, 3, 4]);
    expect(
      parseDecoderContext({ experimentalOpcodesEnabled: false }).availableClockIds,
    ).toEqual([0, 1, 2, 3, 4]);
    expect(parseDecoderContext({ availableClockIds: [0, 1] }).availableClockIds).toEqual([0, 1]);
  });

  test("moonStringLiteral allowlist and escapeMoonString", () => {
    expect(moonStringLiteral("bootstrap-step1")).toBe('"bootstrap-step1"');
    expect(moonStringLiteral("a55a")).toBe('"a55a"');
    expect(escapeMoonString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(moonStringLiteral('x"y')).toBe('"x\\"y"');
  });

  test("resolveUnderTestdata confines paths", () => {
    const abs = resolveUnderTestdata(ROOT, "valid/bootstrap-client-hello-maxima.bin");
    expect(abs.startsWith(path.resolve(ROOT, "protocol/testdata") + path.sep)).toBe(true);
    expect(() => resolveUnderTestdata(ROOT, "../Cargo.toml")).toThrow(/escapes/);
    expect(() => resolveUnderTestdata(ROOT, "valid/../../package.json")).toThrow(/escapes/);
    expect(() => resolveUnderTestdata(ROOT, "/etc/passwd")).toThrow(/escapes/);
    expect(() => resolveUnderRoot(ROOT, "../outside")).toThrow(/escapes/);
  });
});

describe("protocol-moonbit-fixtures build", () => {
  test("exact totals and splits", async () => {
    const model = await buildBridge(ROOT);
    expect(model.fixtures.length).toBe(VALID_TOTAL + MALFORMED_TOTAL);
    const valid = model.fixtures.filter((f) => f.corpus === "valid");
    const mal = model.fixtures.filter((f) => f.corpus === "malformed");
    expect(valid.length).toBe(VALID_TOTAL);
    expect(mal.length).toBe(MALFORMED_TOTAL);
    expect(valid.filter((f) => f.kind === "bootstrap").length).toBe(VALID_BOOTSTRAP);
    expect(
      valid.filter((f) => f.kind === "frame" && f.representation === "binary").length,
    ).toBe(VALID_FRAME_BINARY);
    expect(valid.filter((f) => f.representation === "segment_recipe").length).toBe(
      VALID_SEGMENT_RECIPE,
    );
    expect(mal.filter((f) => f.kind === "bootstrap").length).toBe(MALFORMED_BOOTSTRAP);
    expect(mal.filter((f) => f.kind === "frame").length).toBe(MALFORMED_FRAME);
    expect(model.fixtures.filter((f) => f.representation === "binary").length).toBe(
      MATERIALIZED_BINARY_TOTAL,
    );
  });

  test("decoder context normalized distribution", async () => {
    const model = await buildBridge(ROOT);
    assertDecoderDistribution(model.fixtures);
    const frames = model.fixtures.filter((f) => f.kind === "frame");
    expect(frames.length).toBe(FRAME_TOTAL);
    let narrow = 0;
    let defaults = 0;
    for (const f of frames) {
      const ctx = f.decoderContext!;
      expect(ctx.selectedVersion).toBe(0);
      expect(ctx.experimentalOpcodesEnabled).toBe(false);
      const key = clocksKey(ctx.availableClockIds);
      if (key === clocksKey(NARROW_CLOCK_IDS)) {
        expect(f.corpus).toBe("malformed");
        narrow++;
      } else if (key === clocksKey(DEFAULT_AVAILABLE_CLOCK_IDS)) {
        defaults++;
      } else {
        throw new Error(`unexpected clocks ${key}`);
      }
    }
    expect(narrow).toBe(FRAME_NARROW_CLOCK_COUNT);
    expect(defaults).toBe(FRAME_DEFAULT_CLOCK_COUNT);
    expect(narrow).toBe(2);
    expect(defaults).toBe(56);
  });

  test("canonical order valid then malformed and ids sorted within corpus", async () => {
    const model = await buildBridge(ROOT);
    const ids = model.fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstMal = model.fixtures.findIndex((f) => f.corpus === "malformed");
    expect(firstMal).toBe(VALID_TOTAL);
    for (let i = 0; i < firstMal; i++) {
      expect(model.fixtures[i]!.corpus).toBe("valid");
    }
    for (let i = firstMal; i < model.fixtures.length; i++) {
      expect(model.fixtures[i]!.corpus).toBe("malformed");
    }
    const validIds = model.fixtures.slice(0, firstMal).map((f) => f.id);
    const malIds = model.fixtures.slice(firstMal).map((f) => f.id);
    expect(validIds).toEqual([...validIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(malIds).toEqual([...malIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test("compact recipe handling keeps 64mib as descriptor with exact fields", async () => {
    const model = await buildBridge(ROOT);
    const recipe = model.fixtures.find((f) => f.id === RECIPE_ID);
    expect(recipe).toBeDefined();
    expect(recipe!.representation).toBe("segment_recipe");
    expect(recipe!.chunks).toBeNull();
    expect(recipe!.recipe).not.toBeNull();
    expect(recipe!.recipe!.length).toBe(67_108_864);
    expect(recipe!.recipe!.patternHex).toBe(RECIPE_PATTERN_HEX);
    expect(recipe!.recipe!.opcode).toBe(RECIPE_OPCODE);
    expect(recipe!.recipe!.channelId).toBe(RECIPE_CHANNEL_ID);
    expect(recipe!.recipe!.sequence).toBe(RECIPE_SEQUENCE);
    expect(recipe!.recipe!.priority).toBe(RECIPE_PRIORITY);
    expect(recipe!.recipe!.clockId).toBe(RECIPE_CLOCK_ID);
    expect(recipe!.sourceSha256).toBe(RECIPE_SHA256);
    expect(recipe!.byteLength).toBe(67_108_896);
    expect(model.sourceText.includes("SegmentRecipe")).toBe(true);
    expect(Buffer.byteLength(model.sourceText, "utf8")).toBeLessThan(GENERATED_SOURCE_MAX_BYTES);
  });

  test("every binary expands to manifest length and sha256", async () => {
    const model = await buildBridge(ROOT);
    let n = 0;
    for (const f of model.fixtures) {
      if (f.representation !== "binary" || !f.chunks) continue;
      const bytes = expandChunks(f.chunks);
      expect(bytes.length).toBe(f.byteLength);
      expect(sha256Hex(bytes)).toBe(f.sourceSha256);
      expect(fingerprintHex(bytes)).toBe(f.fingerprintHex);
      n++;
    }
    expect(n).toBe(MATERIALIZED_BINARY_TOTAL);
  });

  test("malformed oracles six fields and plane counts", async () => {
    const model = await buildBridge(ROOT);
    let bootstrap = 0;
    let selected = 0;
    for (const f of model.fixtures.filter((x) => x.corpus === "malformed")) {
      expect(f.oracle).not.toBeNull();
      expect(f.oracle!.code).toBeGreaterThanOrEqual(1);
      expect(f.oracle!.name.length).toBeGreaterThan(0);
      expect(f.oracle!.reason.length).toBeGreaterThan(0);
      if (f.oracle!.plane === "bootstrap") {
        expect(f.oracle!.step).toBeGreaterThanOrEqual(1);
        expect(f.oracle!.step).toBeLessThanOrEqual(9);
        bootstrap++;
      } else if (f.oracle!.plane === "selected_frame") {
        expect(f.oracle!.step).toBeGreaterThanOrEqual(1);
        expect(f.oracle!.step).toBeLessThanOrEqual(16);
        selected++;
      } else {
        throw new Error(`bad plane ${f.oracle!.plane}`);
      }
    }
    expect(bootstrap).toBe(ORACLE_BOOTSTRAP_COUNT);
    expect(selected).toBe(ORACLE_SELECTED_FRAME_COUNT);
    expect(bootstrap).toBe(14);
    expect(selected).toBe(41);
  });

  test("deterministic second generation", async () => {
    const a = await buildBridge(ROOT);
    const b = await buildBridge(ROOT);
    expect(a.sourceText).toBe(b.sourceText);
    expect(a.fixtures).toEqual(b.fixtures);
  });

  test("generated source size under regression ceiling", async () => {
    const model = await buildBridge(ROOT);
    const size = Buffer.byteLength(model.sourceText, "utf8");
    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThanOrEqual(GENERATED_SOURCE_MAX_BYTES);
    expect(GENERATED_SOURCE_MAX_BYTES).toBe(256 * 1024);
  });

  test("canonical output path is rclmbt/protocol/fixture_data_wbtest.mbt", () => {
    expect(OUTPUT_REL).toBe("rclmbt/protocol/fixture_data_wbtest.mbt");
  });

  test("generated header uses positive regenerate prose", async () => {
    const model = await buildBridge(ROOT);
    const lines = model.sourceText.split("\n");
    expect(lines[0]).toBe("// Generated by scripts/protocol-moonbit-fixtures.ts.");
    expect(lines[1]).toBe("// Regenerate with bun run protocol-moonbit-fixtures:write.");
  });
});

describe("protocol-moonbit-fixtures write and check", () => {
  test("write creates canonical output and check accepts it", async () => {
    const root = await makeTempRoot();
    const r = await writeBridge(root);
    expect(r.fixtures).toBe(VALID_TOTAL + MALFORMED_TOTAL);
    expect(r.bytes).toBeLessThanOrEqual(GENERATED_SOURCE_MAX_BYTES);
    const disk = await readFile(path.join(root, OUTPUT_REL), "utf8");
    expect(Buffer.byteLength(disk, "utf8")).toBe(r.bytes);
    await checkBridge(root);
  });

  test("check-mode drift detection", async () => {
    const root = await makeTempRoot();
    await writeBridge(root);
    const out = path.join(root, OUTPUT_REL);
    const disk = await readFile(out, "utf8");
    await writeFile(out, disk + "// drift\n", "utf8");
    await expect(checkBridge(root)).rejects.toThrow(/drift/);
  });

  test("corruption of a source binary fails generation", async () => {
    const root = await makeTempRoot();
    const victim = path.join(
      root,
      "protocol/testdata/valid/bootstrap-client-hello-maxima.bin",
    );
    const bytes = new Uint8Array(await readFile(victim));
    bytes[0] = bytes[0]! ^ 0xff;
    await writeFile(victim, bytes);
    await expect(buildBridge(root)).rejects.toThrow(/sha256/);
  });

  test("symlink binary is rejected", async () => {
    const root = await makeTempRoot();
    const fixturePath = path.join(
      root,
      "protocol/testdata/valid/bootstrap-client-hello-maxima.bin",
    );
    const targetPath = path.join(root, "protocol/testdata/valid/real-target.bin");
    const original = await readFile(fixturePath);
    await writeFile(targetPath, original);
    await rm(fixturePath);
    await symlink(targetPath, fixturePath);
    await expect(buildBridge(root)).rejects.toThrow(/symlink/);
  });

  test("output-path symlink is rejected by write and check", async () => {
    const root = await makeTempRoot();
    const outPath = path.join(root, OUTPUT_REL);
    const targetPath = path.join(root, "rclmbt/protocol/fixture_data_target.mbt");
    const sentinel = "// preserved target content\n";
    await writeFile(targetPath, sentinel, "utf8");
    await symlink(targetPath, outPath);
    await expect(writeBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(targetPath, "utf8")).toBe(sentinel);
    await expect(checkBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(targetPath, "utf8")).toBe(sentinel);
  });

  test("escaped fixture path is rejected", async () => {
    expect(() => resolveUnderTestdata(ROOT, "valid/../../README.md")).toThrow(/escapes/);
    expect(() => resolveUnderTestdata(ROOT, "../secret.bin")).toThrow(/escapes/);
  });

  test("oversize manifest is rejected before parse", async () => {
    const root = await makeTempRoot();
    const huge = "x".repeat(MANIFEST_MAX_BYTES + 1);
    await writeFile(path.join(root, "protocol/testdata/manifest.json"), huge);
    await expect(buildBridge(root)).rejects.toThrow(/exceeds max|size/);
  });

  test("oversize binary is rejected via lstat ceiling", async () => {
    const root = await makeTempRoot();
    // Sparse oversize: truncate sets the logical size to BINARY_MAX_BYTES + 1
    // while the file remains sparse.
    const oversizePath = path.join(root, "protocol/testdata/valid/oversize.bin");
    const oversizeBytes = BINARY_MAX_BYTES + 1;
    await writeFile(oversizePath, new Uint8Array(0));
    await truncate(oversizePath, oversizeBytes);
    const manPath = path.join(root, "protocol/testdata/manifest.json");
    const man = JSON.parse(await readFile(manPath, "utf8"));
    const entry = man.fixtures.find((f: { id: string }) => f.id === "bootstrap-client-hello-maxima");
    entry.path = "valid/oversize.bin";
    entry.byte_length = oversizeBytes;
    entry.sha256 = "0".repeat(64);
    await writeFile(manPath, JSON.stringify(man));
    await expect(buildBridge(root)).rejects.toThrow(/exceeds max|size/);
  });
});

describe("protocol-moonbit-fixtures corrupt manifests", () => {
  test("schema_version and protocol required", () => {
    expect(() => validateManifestShape({ fixtures: [] }, "x")).toThrow(/schema_version/);
    expect(() =>
      validateManifestShape({ schema_version: 1, fixtures: [] }, "x"),
    ).toThrow(/protocol/);
    expect(() =>
      validateManifestShape({ schema_version: 1, protocol: "r2wp-v0", fixtures: [] }, "x"),
    ).not.toThrow();
  });

  test("entry id sha length and kind validated", () => {
    const base = {
      id: "ok-id",
      kind: "bootstrap",
      path: "valid/x.bin",
      representation: "binary",
      byte_length: 1,
      sha256: "a".repeat(64),
    };
    expect(validateManifestEntry(base, "valid", "e").id).toBe("ok-id");
    expect(() =>
      validateManifestEntry({ ...base, id: "../evil" }, "valid", "e"),
    ).toThrow(/id/);
    expect(() =>
      validateManifestEntry({ ...base, sha256: "ZZ" }, "valid", "e"),
    ).toThrow(/sha256/);
    expect(() =>
      validateManifestEntry({ ...base, byte_length: 1.5 }, "valid", "e"),
    ).toThrow(/byte_length/);
    expect(() =>
      validateManifestEntry({ ...base, kind: "other" }, "valid", "e"),
    ).toThrow(/kind/);
  });

  test("corrupt committed-style manifest fails build", async () => {
    const root = await makeTempRoot();
    const manPath = path.join(root, "protocol/testdata/manifest.json");
    const man = JSON.parse(await readFile(manPath, "utf8"));
    man.schema_version = 99;
    await writeFile(manPath, JSON.stringify(man));
    await expect(buildBridge(root)).rejects.toThrow(/schema_version/);
  });

  test("unsafe oracle plane fails materialization", async () => {
    const root = await makeTempRoot();
    const manPath = path.join(root, "protocol/testdata/malformed/manifest.json");
    const man = JSON.parse(await readFile(manPath, "utf8"));
    man.fixtures[0].expected.plane = "other_plane";
    await writeFile(manPath, JSON.stringify(man));
    await expect(buildBridge(root)).rejects.toThrow(/plane/);
  });
});
