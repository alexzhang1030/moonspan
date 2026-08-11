import { afterEach, describe, expect, test } from "bun:test";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARTIFACT_REL as TAIL_SLACK_REL,
  BINARY_MAX_BYTES as CORPUS_BINARY_MAX_BYTES,
  CORPUS_REL,
  MANIFEST_REL,
} from "./cdr-tail-slack.ts";
import {
  BIG_ENDIAN_TOTAL,
  BINARY_MAX_BYTES,
  COMPARISON_TOTAL,
  EXACT_TAIL_TOTAL,
  FIXTURE_GROUP_TOTAL,
  FIXTURE_TOTAL,
  FOUR_BYTE_TAIL_TOTAL,
  FROZEN_MANIFEST_SHA256,
  FROZEN_TAIL_SLACK_SHA256,
  GENERATED_SOURCE_MAX_BYTES,
  HUMBLE_TOTAL,
  JAZZY_TOTAL,
  LITTLE_ENDIAN_TOTAL,
  MAX_FIXTURE_BYTES,
  OUTPUT_REL,
  ROW_TOTALS,
  SINGLETON_BIG_ENDIAN_TOTAL,
  TOTAL_BINARY_PAYLOAD_BYTES,
  TWELVE_BYTE_TAIL_TOTAL,
  assertGeneratedSourceSize,
  buildBridge,
  checkBridge,
  escapeMoonString,
  fingerprintHex,
  fromHex,
  moonStringLiteral,
  parseCliMode,
  parseFullManifestFixtures,
  resolveUnderRoot,
  sha256Hex,
  toHex,
  validateIdentityJoin,
  writeBridge,
} from "./cdr-moonbit-fixtures.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

async function makeTempRoot(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "moonspan-cdr-mbt-fx-"));
  tempDirs.push(d);
  await mkdir(path.join(d, CORPUS_REL), { recursive: true });
  await mkdir(path.join(d, "rclmbt/cdr"), { recursive: true });
  // Minimal Moon workspace so `moon fmt` can format generated bridge source.
  await cp(path.join(ROOT, "moon.work"), path.join(d, "moon.work"));
  await cp(path.join(ROOT, "rclmbt/moon.mod"), path.join(d, "rclmbt/moon.mod"));
  await cp(path.join(ROOT, "rclmbt/moon.pkg"), path.join(d, "rclmbt/moon.pkg"));
  await cp(path.join(ROOT, "rclmbt/cdr/moon.pkg"), path.join(d, "rclmbt/cdr/moon.pkg"));
  await cp(path.join(ROOT, MANIFEST_REL), path.join(d, MANIFEST_REL));
  await cp(path.join(ROOT, TAIL_SLACK_REL), path.join(d, TAIL_SLACK_REL));
  await cp(path.join(ROOT, CORPUS_REL, "fixtures"), path.join(d, CORPUS_REL, "fixtures"), {
    recursive: true,
  });
  return d;
}

describe("cdr-moonbit-fixtures helpers", () => {
  test("hex roundtrip and fingerprint stable", () => {
    const b = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x42]);
    expect(fromHex(toHex(b))).toEqual(b);
    expect(fingerprintHex(b)).toBe(fingerprintHex(new Uint8Array(b)));
    expect(fingerprintHex(b)).toHaveLength(16);
  });

  test("parseCliMode requires exactly one mode", () => {
    expect(parseCliMode(["--write"])).toBe("write");
    expect(parseCliMode(["--check"])).toBe("check");
    expect(parseCliMode([])).toBeNull();
    expect(parseCliMode(["--write", "--check"])).toBeNull();
    expect(parseCliMode(["--write", "extra"])).toBeNull();
  });

  test("moonStringLiteral allowlist and escapeMoonString", () => {
    expect(moonStringLiteral("H-CY-collections")).toBe('"H-CY-collections"');
    expect(moonStringLiteral("little")).toBe('"little"');
    expect(moonStringLiteral("a".repeat(64))).toBe(`"${"a".repeat(64)}"`);
    expect(escapeMoonString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(moonStringLiteral("sensor_msgs/msg/PointCloud2")).toBe(
      '"sensor_msgs/msg/PointCloud2"',
    );
  });

  test("resolveUnderRoot confines paths", () => {
    const abs = resolveUnderRoot(ROOT, OUTPUT_REL);
    expect(abs.startsWith(path.resolve(ROOT) + path.sep)).toBe(true);
    expect(() => resolveUnderRoot(ROOT, "../outside")).toThrow(/escapes/);
    expect(() => resolveUnderRoot(ROOT, "rclmbt/../package.json")).toThrow(/escapes/);
    expect(() => resolveUnderRoot(ROOT, "/etc/passwd")).toThrow(/escapes/);
  });

  test("frozen pins match committed production artifacts", async () => {
    const man = await readFile(path.join(ROOT, MANIFEST_REL));
    const tail = await readFile(path.join(ROOT, TAIL_SLACK_REL));
    expect(sha256Hex(new Uint8Array(man))).toBe(FROZEN_MANIFEST_SHA256);
    expect(sha256Hex(new Uint8Array(tail))).toBe(FROZEN_TAIL_SLACK_SHA256);
    expect(FROZEN_MANIFEST_SHA256).toBe(
      "319cb1c55da8a236054ba625f3fdbd43e239bd13c74c523d7912618c02b9fa7f",
    );
    expect(FROZEN_TAIL_SLACK_SHA256).toBe(
      "1531d011f0715e5b82fa675be266d97387db7dd55ed8ff06784b213ae6256984",
    );
  });
});

describe("cdr-moonbit-fixtures build", () => {
  test("production counts and frozen buckets", async () => {
    const model = await buildBridge(ROOT);
    expect(model.fixtures.length).toBe(FIXTURE_TOTAL);
    expect(model.comparisons.length).toBe(COMPARISON_TOTAL);
    expect(model.manifestSha256).toBe(FROZEN_MANIFEST_SHA256);
    expect(model.tailSlackSha256).toBe(FROZEN_TAIL_SLACK_SHA256);

    const rows: Record<string, number> = {
      "H-CY": 0,
      "H-FT": 0,
      "H-ZN": 0,
      "J-CY": 0,
      "J-FT": 0,
      "J-ZN": 0,
    };
    let humble = 0;
    let jazzy = 0;
    let little = 0;
    let big = 0;
    let exact = 0;
    let four = 0;
    let twelve = 0;
    let payload = 0;
    let maxBytes = 0;
    const groups = new Map<string, number>();

    for (const f of model.fixtures) {
      rows[f.supportRowId]! += 1;
      if (f.rosDistro === "humble") humble += 1;
      else jazzy += 1;
      if (f.serializedEndianness === "little") little += 1;
      else big += 1;
      if (f.zeroTailBytes === 0) exact += 1;
      else if (f.zeroTailBytes === 4) four += 1;
      else if (f.zeroTailBytes === 12) twelve += 1;
      payload += f.byteLength;
      maxBytes = Math.max(maxBytes, f.byteLength);
      const key = `${f.rosDistro}|${f.caseId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    expect(rows).toEqual({ ...ROW_TOTALS });
    expect(humble).toBe(HUMBLE_TOTAL);
    expect(jazzy).toBe(JAZZY_TOTAL);
    expect(little).toBe(LITTLE_ENDIAN_TOTAL);
    expect(big).toBe(BIG_ENDIAN_TOTAL);
    expect(exact).toBe(EXACT_TAIL_TOTAL);
    expect(four).toBe(FOUR_BYTE_TAIL_TOTAL);
    expect(twelve).toBe(TWELVE_BYTE_TAIL_TOTAL);
    expect(payload).toBe(TOTAL_BINARY_PAYLOAD_BYTES);
    expect(maxBytes).toBe(MAX_FIXTURE_BYTES);
    expect(groups.size).toBe(FIXTURE_GROUP_TOTAL);
    expect(FIXTURE_TOTAL).toBe(56);
    expect(COMPARISON_TOTAL).toBe(18);
    expect(FIXTURE_GROUP_TOTAL).toBe(20);
    expect(HUMBLE_TOTAL).toBe(28);
    expect(JAZZY_TOTAL).toBe(28);
    expect(LITTLE_ENDIAN_TOTAL).toBe(54);
    expect(BIG_ENDIAN_TOTAL).toBe(2);
    expect(EXACT_TAIL_TOTAL).toBe(24);
    expect(FOUR_BYTE_TAIL_TOTAL).toBe(12);
    expect(TWELVE_BYTE_TAIL_TOTAL).toBe(20);
    expect(SINGLETON_BIG_ENDIAN_TOTAL).toBe(2);
  });

  test("fixtures sorted by ASCII id with unique ids", async () => {
    const model = await buildBridge(ROOT);
    const ids = model.fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test("every binary expands to length fingerprint and logical+tail identity", async () => {
    const model = await buildBridge(ROOT);
    for (const f of model.fixtures) {
      const bytes = fromHex(f.hexBytes);
      expect(bytes.length).toBe(f.byteLength);
      expect(sha256Hex(bytes)).toBe(f.serializedSha256);
      expect(fingerprintHex(bytes)).toBe(f.fingerprintHex);
      expect(f.logicalByteLength + f.zeroTailBytes).toBe(f.byteLength);
      for (let i = f.logicalByteLength; i < bytes.length; i++) {
        expect(bytes[i]).toBe(0);
      }
      const canon = model.fixtures.find((x) => x.id === f.canonicalFixtureId);
      expect(canon).toBeDefined();
      expect(canon!.zeroTailBytes).toBe(0);
      const canonBytes = fromHex(canon!.hexBytes);
      expect(canonBytes.length).toBe(f.logicalByteLength);
      expect(bytes.subarray(0, f.logicalByteLength)).toEqual(canonBytes);
    }
  });

  test("multi-row comparisons and singleton big-endian groups", async () => {
    const model = await buildBridge(ROOT);
    expect(model.comparisons.length).toBe(COMPARISON_TOTAL);
    for (const c of model.comparisons) {
      expect(c.fixtureIds.length).toBeGreaterThanOrEqual(2);
      expect(c.rows.length).toBe(c.fixtureIds.length);
      const members = c.fixtureIds.map(
        (id) => model.fixtures.find((f) => f.id === id)!,
      );
      const first = members[0]!;
      for (const m of members) {
        expect(m.caseId).toBe(c.caseId);
        expect(m.rosDistro).toBe(c.rosDistro);
        expect(m.semanticValueSha256).toBe(first.semanticValueSha256);
        expect(m.schemaIdentity).toEqual(first.schemaIdentity);
      }
    }
    const big = model.fixtures.filter((f) => f.serializedEndianness === "big");
    expect(big.length).toBe(SINGLETON_BIG_ENDIAN_TOTAL);
    for (const f of big) {
      const peers = model.fixtures.filter(
        (g) => g.caseId === f.caseId && g.rosDistro === f.rosDistro,
      );
      expect(peers.length).toBe(1);
    }
  });

  test("deterministic second generation", async () => {
    const a = await buildBridge(ROOT);
    const b = await buildBridge(ROOT);
    expect(a.sourceText).toBe(b.sourceText);
    expect(a.fixtures).toEqual(b.fixtures);
    expect(a.comparisons).toEqual(b.comparisons);
  });

  test("generated source size under regression ceiling", async () => {
    const model = await buildBridge(ROOT);
    const size = Buffer.byteLength(model.sourceText, "utf8");
    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThanOrEqual(GENERATED_SOURCE_MAX_BYTES);
    expect(GENERATED_SOURCE_MAX_BYTES).toBe(256 * 1024);
    expect(BINARY_MAX_BYTES).toBeGreaterThanOrEqual(MAX_FIXTURE_BYTES);
  });

  test("canonical output path and positive regenerate prose", async () => {
    expect(OUTPUT_REL).toBe("rclmbt/cdr/fixture_data_wbtest.mbt");
    const model = await buildBridge(ROOT);
    const lines = model.sourceText.split("\n");
    expect(lines[0]).toBe("// Generated by scripts/cdr-moonbit-fixtures.ts.");
    expect(lines[1]).toBe("// Regenerate with bun run cdr-moonbit-fixtures:write.");
    expect(model.sourceText.includes("let cdr_corpus_fixtures")).toBe(true);
    expect(model.sourceText.includes("let cdr_corpus_comparisons")).toBe(true);
    expect(model.sourceText.includes("CdrReader::open_default")).toBe(true);
  });
});

describe("cdr-moonbit-fixtures write and check", () => {
  test("write creates canonical output and check accepts it", async () => {
    const root = await makeTempRoot();
    const r = await writeBridge(root);
    expect(r.fixtures).toBe(FIXTURE_TOTAL);
    expect(r.comparisons).toBe(COMPARISON_TOTAL);
    expect(r.bytes).toBeLessThanOrEqual(GENERATED_SOURCE_MAX_BYTES);
    const disk = await readFile(path.join(root, OUTPUT_REL), "utf8");
    expect(Buffer.byteLength(disk, "utf8")).toBe(r.bytes);
    await checkBridge(root);
  });

  test("check-mode drift detection on real output", async () => {
    const root = await makeTempRoot();
    await writeBridge(root);
    const out = path.join(root, OUTPUT_REL);
    const disk = await readFile(out, "utf8");
    await writeFile(out, disk + "// drift\n", "utf8");
    await expect(checkBridge(root)).rejects.toThrow(/drift/);
  });

  test("corruption of a source binary fails generation", async () => {
    const root = await makeTempRoot();
    const victim = path.join(root, CORPUS_REL, "fixtures/H-CY/collections.bin");
    const bytes = new Uint8Array(await readFile(victim));
    bytes[0] = bytes[0]! ^ 0xff;
    await writeFile(victim, bytes);
    await expect(buildBridge(root)).rejects.toThrow(/sha256/i);
  });

  test("corrupted tail-slack artifact fails generation", async () => {
    const root = await makeTempRoot();
    const tailPath = path.join(root, TAIL_SLACK_REL);
    const body = await readFile(tailPath, "utf8");
    await writeFile(tailPath, body.replace('"exact_fixtures": 24', '"exact_fixtures": 23'));
    await expect(buildBridge(root)).rejects.toThrow(/tail-slack|SHA-256|differs/i);
  });

  test("missing binary fails corpus load before identity join", async () => {
    const root = await makeTempRoot();
    await rm(path.join(root, CORPUS_REL, "fixtures/H-CY/collections.bin"));
    await expect(buildBridge(root)).rejects.toThrow(/missing|path/i);
  });

  test("output-path symlink is rejected by write and check with target preserved", async () => {
    const root = await makeTempRoot();
    const outPath = path.join(root, OUTPUT_REL);
    const targetPath = path.join(root, "rclmbt/cdr/fixture_data_target.mbt");
    const sentinel = "// preserved target content\n";
    await writeFile(targetPath, sentinel, "utf8");
    await symlink(targetPath, outPath);
    await expect(writeBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(targetPath, "utf8")).toBe(sentinel);
    // Write a real output elsewhere then point the output path at a symlink for check.
    const realOut = path.join(root, "rclmbt/cdr/real_output.mbt");
    const model = await buildBridge(root);
    await writeFile(realOut, model.sourceText, "utf8");
    await rm(outPath);
    await symlink(targetPath, outPath);
    await expect(checkBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(targetPath, "utf8")).toBe(sentinel);
  });

  test("parent-directory symlink is rejected and external target stays unchanged", async () => {
    const root = await makeTempRoot();
    const outside = path.join(root, "outside-cdr-dir");
    await mkdir(outside, { recursive: true });
    const sentinel = path.join(outside, "sentinel.txt");
    await writeFile(sentinel, "keep-me\n", "utf8");
    // Replace rclmbt/cdr with a symlink to an external directory.
    await rm(path.join(root, "rclmbt/cdr"), { recursive: true, force: true });
    await symlink(outside, path.join(root, "rclmbt/cdr"));
    await expect(writeBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(sentinel, "utf8")).toBe("keep-me\n");
    // Formatter path also walks parents under the trusted root.
    await expect(buildBridge(root)).rejects.toThrow(/symlink/);
    expect(await readFile(sentinel, "utf8")).toBe("keep-me\n");
  });

  test("sparse on-disk binary longer than declared length fails size guard", async () => {
    const root = await makeTempRoot();
    const victim = path.join(root, CORPUS_REL, "fixtures/H-CY/collections.bin");
    // Keep committed manifest declaration; enlarge only the on-disk file so the
    // opened-handle maxBytes=declared guard fires (frozen manifest SHA stays valid).
    const man = JSON.parse(await readFile(path.join(root, MANIFEST_REL), "utf8"));
    const entry = man.fixtures.find((f: { id: string }) => f.id === "H-CY-collections");
    const declared = entry.serialized.byte_length as number;
    const onDisk = declared + 1024;
    await writeFile(victim, new Uint8Array(0));
    await truncate(victim, onDisk);
    await expect(buildBridge(root)).rejects.toThrow(
      new RegExp(`file size ${onDisk} exceeds max ${declared}`),
    );
  });
});

describe("cdr-moonbit-fixtures pure guards", () => {
  test("validateIdentityJoin accepts exact unique sets", () => {
    expect(validateIdentityJoin(["a", "b"], ["b", "a"])).toEqual({ ok: true });
  });

  test("validateIdentityJoin rejects duplicate fixture identities", () => {
    const r = validateIdentityJoin(["a", "a"], ["a"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("identity join: duplicate fixture id a");
  });

  test("validateIdentityJoin rejects duplicate evidence identities", () => {
    const r = validateIdentityJoin(["a", "b"], ["a", "a"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("identity join: duplicate evidence id a");
  });

  test("validateIdentityJoin rejects missing evidence with exact diagnostic", () => {
    const r = validateIdentityJoin(["a", "b"], ["a"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("identity join: missing tail evidence for b");
    }
  });

  test("validateIdentityJoin rejects extra evidence with exact diagnostic", () => {
    const r = validateIdentityJoin(["a"], ["a", "b"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "identity join: tail evidence b has no manifest fixture",
      );
    }
  });

  test("assertGeneratedSourceSize accepts under-ceiling text", () => {
    expect(assertGeneratedSourceSize("ok\n", 16)).toBe(3);
  });

  test("assertGeneratedSourceSize rejects true oversized strings", () => {
    const huge = "x".repeat(GENERATED_SOURCE_MAX_BYTES + 1);
    expect(() => assertGeneratedSourceSize(huge)).toThrow(/exceeds ceiling/);
    expect(() =>
      assertGeneratedSourceSize("abcd", 3, "sample"),
    ).toThrow(/sample 4 bytes exceeds ceiling 3/);
  });

  test("binary ceiling matches shared corpus 64 MiB bound", () => {
    expect(BINARY_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(BINARY_MAX_BYTES).toBe(CORPUS_BINARY_MAX_BYTES);
  });
});

describe("cdr-moonbit-fixtures corrupt inputs", () => {
  test("parseFullManifestFixtures rejects non-object root and wrong corpus", () => {
    expect(() => parseFullManifestFixtures(null)).toThrow(/plain object/);
    expect(() =>
      parseFullManifestFixtures({ corpus: "x", fixtures: [] }),
    ).toThrow(/corpus/);
  });

  test("real manifest duplicate fixture id is rejected", async () => {
    const root = await makeTempRoot();
    // Keep frozen SHAs valid by only mutating the in-memory parse path:
    // parseFullManifestFixtures is the identity-surface gate for full metadata.
    const man = JSON.parse(await readFile(path.join(ROOT, MANIFEST_REL), "utf8"));
    man.fixtures[1].id = man.fixtures[0].id;
    expect(() => parseFullManifestFixtures(man)).toThrow(/duplicate fixture id/);
  });

  test("real manifest frozen fixture count is enforced", async () => {
    const man = JSON.parse(await readFile(path.join(ROOT, MANIFEST_REL), "utf8"));
    man.fixtures = man.fixtures.slice(0, FIXTURE_TOTAL - 1);
    expect(() => parseFullManifestFixtures(man)).toThrow(
      new RegExp(`fixtures ${FIXTURE_TOTAL - 1} != frozen ${FIXTURE_TOTAL}`),
    );
  });

  test("corrupt committed-style manifest fails build", async () => {
    const root = await makeTempRoot();
    const manPath = path.join(root, MANIFEST_REL);
    const man = JSON.parse(await readFile(manPath, "utf8"));
    man.corpus = "other-corpus";
    await writeFile(manPath, JSON.stringify(man));
    await expect(buildBridge(root)).rejects.toThrow(/corpus|SHA-256/i);
  });

  test("write is atomic regular file not a symlink", async () => {
    const root = await makeTempRoot();
    await writeBridge(root);
    const st = await lstat(path.join(root, OUTPUT_REL));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
  });

  test("comparison fixture ids pair with support_row_id rows", async () => {
    const model = await buildBridge(ROOT);
    for (const c of model.comparisons) {
      expect(c.fixtureIds.length).toBe(c.rows.length);
      for (let i = 0; i < c.fixtureIds.length; i++) {
        const f = model.fixtures.find((x) => x.id === c.fixtureIds[i]);
        expect(f).toBeDefined();
        expect(f!.supportRowId).toBe(c.rows[i]);
      }
    }
  });
});
