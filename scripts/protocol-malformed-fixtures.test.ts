import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  cp,
  rm,
  symlink,
  lstat,
  readdir,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BOOTSTRAP_PAYLOAD_MAX_BYTES,
  REQUIRED_COVERAGE,
  asciiCompare,
  buildManifest,
  checkMalformedFixtures,
  diagnoseManifest,
  fromHex,
  isCanonicalMalformedPath,
  isCanonicalMalformedEntryPath,
  loadRegistryIndex,
  materializeSource,
  parseCliMode,
  sha256Hex,
  stableManifestJson,
  toHex,
  writeMalformedFixtures,
  ensureRealDirectoryChain,
  PER_FIXTURE_ALLOC_MAX,
  MUTATION_OPS_MAX,
  type ConstructionSource,
  type Manifest,
} from "./protocol-malformed-fixtures.ts";

const ROOT = path.resolve(import.meta.dir, "..");

function registry() {
  return loadRegistryIndex(
    JSON.parse(readFileSync(path.join(ROOT, "protocol/registry/r2wp-v0.json"), "utf8")),
  );
}

async function scaffoldTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "malformed-fx-"));
  await mkdir(path.join(dir, "protocol/registry"), { recursive: true });
  await mkdir(path.join(dir, "protocol/testdata"), { recursive: true });
  await cp(
    path.join(ROOT, "protocol/registry/r2wp-v0.json"),
    path.join(dir, "protocol/registry/r2wp-v0.json"),
  );
  await writeFile(path.join(dir, "package.json"), "{}\n");
  return dir;
}

describe("protocol-malformed-fixtures helpers", () => {
  test("hex roundtrip and sha256 stable", () => {
    const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(fromHex(toHex(b))).toEqual(b);
    expect(sha256Hex(b)).toBe(sha256Hex(b));
  });

  test("asciiCompare is code-unit order", () => {
    expect(asciiCompare("A", "B")).toBeLessThan(0);
    expect(asciiCompare("a", "A")).toBeGreaterThan(0);
  });

  test("bootstrap payload absolute ceiling is 65535", () => {
    expect(BOOTSTRAP_PAYLOAD_MAX_BYTES).toBe(65_535);
  });

  test("parseCliMode accepts exactly one mode argv item", () => {
    expect(parseCliMode(["--write"])).toBe("write");
    expect(parseCliMode(["--check"])).toBe("check");
    expect(parseCliMode([])).toBeNull();
    expect(parseCliMode(["--write", "--check"])).toBeNull();
    expect(parseCliMode(["--check", "extra"])).toBeNull();
    expect(parseCliMode(["extra"])).toBeNull();
    expect(parseCliMode(["--write", "extra"])).toBeNull();
  });

  test("canonical path gate", () => {
    expect(isCanonicalMalformedPath("malformed/x.bin")).toBe(true);
    expect(isCanonicalMalformedPath("../malformed/x.bin")).toBe(false);
    expect(isCanonicalMalformedPath("malformed/../x.bin")).toBe(false);
    expect(isCanonicalMalformedPath("/abs/x.bin")).toBe(false);
    expect(isCanonicalMalformedPath("malformed\\x.bin")).toBe(false);
    expect(isCanonicalMalformedPath("valid/x.bin")).toBe(false);
    expect(isCanonicalMalformedEntryPath("foo", "malformed/foo.bin")).toBe(true);
    expect(isCanonicalMalformedEntryPath("foo", "malformed/bar.bin")).toBe(false);
  });
});

describe("protocol-malformed-fixtures build", () => {
  test("manifest fixtures sorted unique with required coverage", () => {
    const m = buildManifest();
    expect(m.schema_version).toBe(1);
    expect(m.protocol).toBe("r2wp-v0");
    expect(m.fixtures).toHaveLength(55);
    const ids = m.fixtures.map((f) => f.id);
    expect(ids).toEqual([...ids].sort(asciiCompare));
    expect(new Set(ids).size).toBe(ids.length);
    const cov = new Set<string>();
    for (const f of m.fixtures) {
      expect(f.representation).toBe("binary");
      expect(f.coverage).toEqual([...f.coverage].sort(asciiCompare));
      for (const c of f.coverage) cov.add(c);
      expect(f.path).toBe(`malformed/${f.id}.bin`);
      expect(isCanonicalMalformedEntryPath(f.id, f.path)).toBe(true);
      expect(f.byte_length).toBeLessThanOrEqual(PER_FIXTURE_ALLOC_MAX);
      // sources are hex or mutate over hex only
      const s = f.source as { $type: string; base?: { $type: string } };
      expect(s.$type === "hex" || s.$type === "mutate").toBe(true);
      if (s.$type === "mutate") expect(s.base?.$type).toBe("hex");
    }
    for (const req of REQUIRED_COVERAGE) {
      expect(cov.has(req)).toBe(true);
    }
    expect(m.fixtures.some((f) => f.id === "frame-step13-tlv-bounds")).toBe(true);
    const step6 = m.fixtures.find((f) => f.id === "bootstrap-step6-payload-overflow");
    expect(step6).toBeDefined();
    expect(step6!.byte_length).toBe(12);
    expect(step6!.source).toEqual({
      $type: "hex",
      hex: "523257500001000000010000",
    });
    expect(step6!.expected).toEqual({
      registry_code: 24,
      registry_name: "message_too_large",
      reason: "payload_too_large",
      offset: 8,
      plane: "bootstrap",
      step: 6,
    });
    expect(step6!.coverage).toEqual([
      "bootstrap_step_6",
      "payload_overflow",
      "precedence_6_before_7",
    ]);
  });

  test("stableManifestJson deterministic and two-write identity shape", () => {
    const a = stableManifestJson(buildManifest());
    const b = stableManifestJson(buildManifest());
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });
});

describe("protocol-malformed-fixtures diagnose closed schema", () => {
  const reg = registry();

  test("null root returns diagnostics", () => {
    const d = diagnoseManifest(null, reg);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.includes("null"))).toBe(true);
  });

  test("extra top-level key rejected", () => {
    const m = buildManifest() as unknown as Record<string, unknown>;
    m.extra = true;
    expect(diagnoseManifest(m, reg).some((x) => x.includes("unknown key"))).toBe(true);
  });

  test("extra top-level legacy_step6_metadata key rejected", () => {
    const m = structuredClone(buildManifest()) as unknown as Record<string, unknown>;
    m.legacy_step6_metadata = {
      plane: "bootstrap",
      step: 6,
      claim: "stale",
    };
    expect(diagnoseManifest(m, reg).some((x) => x.includes("unknown key"))).toBe(true);
  });

  test("decoder_context selectedVersion string rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures[0]!;
    (f.decoder_context as Record<string, unknown>).selectedVersion = "0";
    expect(diagnoseManifest(m, reg).some((x) => x.includes("selectedVersion"))).toBe(
      true,
    );
  });

  test("expected.reason number rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures[0]!;
    (f.expected as unknown as Record<string, unknown>).reason = 5;
    expect(diagnoseManifest(m, reg).some((x) => x.includes("reason"))).toBe(true);
  });

  test("id/path mismatch rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures[0]!;
    f.path = "malformed/not-the-id.bin";
    expect(diagnoseManifest(m, reg).some((x) => x.includes("path"))).toBe(true);
  });

  test("mutation offset negative rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find(
      (x) => (x.source as { $type: string }).$type === "mutate",
    )!;
    const src = f.source as {
      $type: "mutate";
      base: { $type: "hex"; hex: string };
      ops: Array<Record<string, unknown>>;
    };
    src.ops = [{ op: "set_u8", offset: -1, value: 0 }];
    expect(diagnoseManifest(m, reg).some((x) => x.includes("offset"))).toBe(true);
  });


  test("sequential mutation truncate then set_u8 offset rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.representation === "binary")!;
    f.source = {
      $type: "mutate",
      base: { $type: "hex", hex: "0000" },
      ops: [
        { op: "truncate", length: 1 },
        { op: "set_u8", offset: 1, value: 0 },
      ],
    };
    const d = diagnoseManifest(m, reg);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.includes("offset") || x.includes("current length"))).toBe(
      true,
    );
  });

  test("sequential mutation append then set_u8 valid control", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.representation === "binary")!;
    f.source = {
      $type: "mutate",
      base: { $type: "hex", hex: "00" },
      ops: [
        { op: "append_hex", hex: "ff" },
        { op: "set_u8", offset: 1, value: 0xaa },
      ],
    };
    // Still fails rebuild identity, but sequential operand validation must accept this source shape.
    // diagnose will still fail required coverage/rebuild later — isolate source validation:
    const diags = diagnoseManifest(m, reg).filter((x) => x.includes("/source"));
    expect(diags.some((x) => x.includes("offset"))).toBe(false);
  });

  test("duplicate ids and paths and coverage rejected", () => {
    const m = structuredClone(buildManifest());
    const a = m.fixtures.find((x) => x.representation === "binary")!;
    m.fixtures.push({ ...a });
    expect(diagnoseManifest(m, reg).some((x) => x.includes("duplicate id"))).toBe(true);

    const m2 = structuredClone(buildManifest());
    const b = m2.fixtures.filter((x) => x.representation === "binary");
    b[1]!.path = b[0]!.path;
    expect(diagnoseManifest(m2, reg).some((x) => x.includes("duplicate path"))).toBe(
      true,
    );

    const m3 = structuredClone(buildManifest());
    const c = m3.fixtures[0]!;
    c.coverage = ["a", "a"];
    expect(diagnoseManifest(m3, reg).some((x) => x.includes("duplicate coverage"))).toBe(
      true,
    );
  });

  test("unknown source tag and unknown op rejected", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.representation === "binary")!;
    f.source = { $type: "nope", hex: "00" } as never;
    expect(diagnoseManifest(m, reg).some((x) => x.includes("unknown source"))).toBe(
      true,
    );

    const m2 = structuredClone(buildManifest());
    const g = m2.fixtures.find((x) => x.representation === "binary")!;
    g.source = {
      $type: "mutate",
      base: { $type: "hex", hex: "00" },
      ops: [{ op: "explode" as "truncate", length: 0 }],
    };
    expect(diagnoseManifest(m2, reg).some((x) => x.includes("unknown op"))).toBe(true);
  });

  test("allocation bound on huge hex", () => {
    expect(() =>
      materializeSource(
        { $type: "hex", hex: "aa".repeat(PER_FIXTURE_ALLOC_MAX + 1) } as ConstructionSource,
        { used: 0 },
      ),
    ).toThrow();
  });

  test("mutation ops ceiling", () => {
    const ops = Array.from({ length: MUTATION_OPS_MAX + 1 }, () => ({
      op: "append_hex" as const,
      hex: "00",
    }));
    expect(() =>
      materializeSource(
        { $type: "mutate", base: { $type: "hex", hex: "00" }, ops },
        { used: 0 },
      ),
    ).toThrow();
  });

  test("registry binding rejects wrong code/name/step", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.representation === "binary")!;
    f.expected.registry_code = 1;
    f.expected.registry_name = "malformed_frame";
    expect(diagnoseManifest(m, reg).length).toBeGreaterThan(0);

    const m2 = structuredClone(buildManifest());
    const g = m2.fixtures.find((x) => x.kind === "frame")!;
    g.expected.step = 1;
    g.expected.registry_code = 24;
    g.expected.registry_name = "message_too_large";
    // step 1 is malformed_frame code 3 — binding should fail
    expect(diagnoseManifest(m2, reg).length).toBeGreaterThan(0);
  });

  test("kind/plane pairing enforced", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.kind === "bootstrap")!;
    f.expected.plane = "selected_frame";
    expect(diagnoseManifest(m, reg).some((x) => x.includes("plane"))).toBe(true);
  });

  test("availableClockIds must be sorted unique 0..4", () => {
    const m = structuredClone(buildManifest());
    const f = m.fixtures.find((x) => x.id.includes("clock-unavailable"))!;
    f.decoder_context.availableClockIds = [2, 1];
    expect(
      diagnoseManifest(m, reg).some((x) => x.includes("availableClockIds")),
    ).toBe(true);
  });
});

describe("protocol-malformed-fixtures repository check", () => {
  test("committed artifacts pass check read-only", async () => {
    const before = await readFile(
      path.join(ROOT, "protocol/testdata/malformed/manifest.json"),
      "utf8",
    );
    const { diags } = await checkMalformedFixtures(ROOT);
    expect(diags).toEqual([]);
    const after = await readFile(
      path.join(ROOT, "protocol/testdata/malformed/manifest.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });
});

describe("protocol-malformed-fixtures write/check temp", () => {
  test("write then check idempotent two-write byte identity", async () => {
    const dir = await scaffoldTemp();
    try {
      const m1 = await writeMalformedFixtures(dir);
      const j1 = await readFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
      );
      const bins1 = new Map<string, Buffer>();
      for (const f of m1.fixtures) {
        if (f.path) {
          bins1.set(
            f.path,
            await readFile(path.join(dir, "protocol/testdata", f.path)),
          );
        }
      }
      await writeMalformedFixtures(dir);
      const j2 = await readFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
      );
      expect(Buffer.compare(j1, j2)).toBe(0);
      for (const f of m1.fixtures) {
        if (!f.path) continue;
        const b = await readFile(path.join(dir, "protocol/testdata", f.path));
        expect(Buffer.compare(b, bins1.get(f.path)!)).toBe(0);
      }
      expect((await checkMalformedFixtures(dir)).diags).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("byte and hash drift detected at constant length", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      const bytes = new Uint8Array(await readFile(abs));
      bytes[0] = (bytes[0]! + 1) & 0xff;
      await writeFile(abs, bytes);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("sha256") || d.includes("bytes differ"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("truncation length drift detected", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path && f.byte_length > 2)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      const bytes = new Uint8Array(await readFile(abs));
      await writeFile(abs, bytes.slice(0, bytes.length - 1));
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("length") || d.includes(victim.id))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing and extra file detected", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path)!;
      await rm(path.join(dir, "protocol/testdata", victim.path!));
      const missing = (await checkMalformedFixtures(dir)).diags;
      expect(missing.some((d) => d.includes("missing"))).toBe(true);

      await writeMalformedFixtures(dir);
      await writeFile(
        path.join(dir, "protocol/testdata/malformed/extra-file.bin"),
        new Uint8Array([1]),
      );
      const extra = (await checkMalformedFixtures(dir)).diags;
      expect(extra.some((d) => d.includes("extra file"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("file-level malformed JSON and null JSON", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const man = path.join(dir, "protocol/testdata/malformed/manifest.json");
      await writeFile(man, "{not json");
      const d1 = (await checkMalformedFixtures(dir)).diags;
      expect(d1.some((x) => x.includes("malformed JSON") || x.includes("JSON") || x.includes("manifest"))).toBe(
        true,
      );
      await writeFile(man, "null");
      const d2 = (await checkMalformedFixtures(dir)).diags;
      expect(d2.some((x) => x.includes("null"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("expected reason and offset tampering", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manPath = path.join(dir, "protocol/testdata/malformed/manifest.json");
      const m = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const f = m.fixtures.find((x) => x.representation === "binary")!;
      // Valid-looking reason and in-range offset+1: exercises rebuild/oracle, not range validation.
      f.expected.reason = "truncated_prefix";
      f.expected.offset = f.expected.offset + 1;
      await writeFile(manPath, stableManifestJson(m));
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(
        diags.some(
          (d) =>
            d.includes("rebuild") ||
            d.includes("reason") ||
            d.includes("offset") ||
            d.includes(f.id),
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed registry handling", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      await writeFile(path.join(dir, "protocol/registry/r2wp-v0.json"), "{");
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("registry"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("traversal sentinel reports structural diagnostics before fixture disk access", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manPath = path.join(dir, "protocol/testdata/malformed/manifest.json");
      const m = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const f = m.fixtures.find((x) => x.representation === "binary")!;
      // Unsafe path that would escape if followed.
      f.path = "../sentinel.bin";
      await writeFile(manPath, JSON.stringify(m, null, 2) + "\n");
      // Place a sentinel outside malformed that must not be read as fixture bytes.
      const sentinel = path.join(dir, "protocol/testdata/sentinel.bin");
      await writeFile(sentinel, new Uint8Array([0xca, 0xfe]));
      const before = await readFile(sentinel);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("path") || d.includes("canonical") || d.includes("symlink"))).toBe(
        true,
      );
      const after = await readFile(sentinel);
      expect(Buffer.compare(before, after)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("symlink fixture artifact rejected; external target unchanged", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      const external = path.join(dir, "external-target.bin");
      await writeFile(external, new Uint8Array([0x11, 0x22, 0x33, 0x44]));
      const externalBefore = await readFile(external);
      await rm(abs);
      await symlink(external, abs);
      const st = await lstat(abs);
      expect(st.isSymbolicLink()).toBe(true);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("symlink") || d.includes(victim.id))).toBe(
        true,
      );
      const externalAfter = await readFile(external);
      expect(Buffer.compare(externalBefore, externalAfter)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


  test("manifest symlink write sentinel", async () => {
    const dir = await scaffoldTemp();
    try {
      await ensureRealDirectoryChain(dir, ["protocol", "testdata", "malformed"], true);
      const external = path.join(dir, "external-manifest.json");
      await writeFile(external, "SENTINEL_MANIFEST\n");
      const before = await readFile(external);
      const manAbs = path.join(dir, "protocol/testdata/malformed/manifest.json");
      await symlink(external, manAbs);
      let err: unknown = null;
      try {
        await writeMalformedFixtures(dir);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const after = await readFile(external);
      expect(Buffer.compare(before, after)).toBe(0);
      expect(after.toString("utf8").startsWith("{")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed directory symlink write sentinel", async () => {
    const dir = await scaffoldTemp();
    try {
      await ensureRealDirectoryChain(dir, ["protocol", "testdata"], true);
      const externalDir = path.join(dir, "external-malformed-dir");
      await mkdir(externalDir, { recursive: true });
      const malformed = path.join(dir, "protocol/testdata/malformed");
      await symlink(externalDir, malformed);
      let err: unknown = null;
      try {
        await writeMalformedFixtures(dir);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const externalFiles = await readdir(externalDir);
      expect(externalFiles.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bin symlink write sentinel", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      const external = path.join(dir, "external-bin.bin");
      await writeFile(external, new Uint8Array([0xab, 0xcd, 0xef, 0x01]));
      const before = await readFile(external);
      await rm(abs);
      await symlink(external, abs);
      let err: unknown = null;
      try {
        await writeMalformedFixtures(dir);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const after = await readFile(external);
      expect(Buffer.compare(before, after)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest and registry symlink reads rejected", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manAbs = path.join(dir, "protocol/testdata/malformed/manifest.json");
      const external = path.join(dir, "ext-man.json");
      await writeFile(external, await readFile(manAbs));
      await rm(manAbs);
      await symlink(external, manAbs);
      const d1 = (await checkMalformedFixtures(dir)).diags;
      expect(d1.some((d) => d.includes("symlink") || d.includes("manifest"))).toBe(true);

      // restore real manifest, symlink registry
      await rm(manAbs);
      await writeFile(manAbs, await readFile(external));
      const regAbs = path.join(dir, "protocol/registry/r2wp-v0.json");
      const regExt = path.join(dir, "ext-reg.json");
      await writeFile(regExt, await readFile(regAbs));
      await rm(regAbs);
      await symlink(regExt, regAbs);
      const d2 = (await checkMalformedFixtures(dir)).diags;
      expect(d2.some((d) => d.includes("registry") || d.includes("symlink"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("oversized manifest registry and bin rejected from stat before read", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manAbs = path.join(dir, "protocol/testdata/malformed/manifest.json");
      // Oversized manifest
      await writeFile(manAbs, "x".repeat(600 * 1024));
      const d1 = (await checkMalformedFixtures(dir)).diags;
      expect(d1.some((d) => d.includes("size") || d.includes("exceeds") || d.includes("manifest"))).toBe(
        true,
      );

      await writeMalformedFixtures(dir);
      const regAbs = path.join(dir, "protocol/registry/r2wp-v0.json");
      await writeFile(regAbs, "y".repeat(3 * 1024 * 1024));
      const d2 = (await checkMalformedFixtures(dir)).diags;
      expect(d2.some((d) => d.includes("registry") || d.includes("size") || d.includes("exceeds"))).toBe(
        true,
      );

      await writeFile(
        path.join(dir, "protocol/registry/r2wp-v0.json"),
        await readFile(path.join(ROOT, "protocol/registry/r2wp-v0.json")),
      );
      await writeMalformedFixtures(dir);
      const m = JSON.parse(
        await readFile(path.join(dir, "protocol/testdata/malformed/manifest.json"), "utf8"),
      ) as Manifest;
      const victim = m.fixtures.find((f) => f.path)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      // Oversized bin content
      await writeFile(abs, new Uint8Array(300 * 1024));
      const d3 = (await checkMalformedFixtures(dir)).diags;
      expect(d3.some((d) => d.includes("size") || d.includes("exceeds") || d.includes(victim.id))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("existing directory at bin artifact path rejected before open", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeMalformedFixtures(dir);
      const victim = m.fixtures.find((f) => f.path)!;
      const abs = path.join(dir, "protocol/testdata", victim.path!);
      await rm(abs);
      await mkdir(abs);
      let err: unknown = null;
      try {
        await writeMalformedFixtures(dir);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err)).toMatch(/non-regular|directory|refusing/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("registry error name and step tampering", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      // Tamper error name for code 1
      reg.errors["1"].name = "not_malformed_bootstrap";
      await writeFile(regPath, JSON.stringify(reg));
      const d1 = (await checkMalformedFixtures(dir)).diags;
      expect(d1.length).toBeGreaterThan(0);
      expect(d1.some((d) => d.includes("registry") || d.includes("name") || d.includes("expected"))).toBe(
        true,
      );

      // restore and tamper step code
      const reg2 = JSON.parse(
        await readFile(path.join(ROOT, "protocol/registry/r2wp-v0.json"), "utf8"),
      );
      const step = reg2.validation_order.bootstrap.find((r: { step: number }) => r.step === 1);
      step.code = 99;
      await writeFile(regPath, JSON.stringify(reg2));
      const d2 = (await checkMalformedFixtures(dir)).diags;
      expect(d2.length).toBeGreaterThan(0);

      // duplicate step row
      const reg3 = JSON.parse(
        await readFile(path.join(ROOT, "protocol/registry/r2wp-v0.json"), "utf8"),
      );
      reg3.validation_order.bootstrap.push({ ...reg3.validation_order.bootstrap[0] });
      await writeFile(regPath, JSON.stringify(reg3));
      const d3 = (await checkMalformedFixtures(dir)).diags;
      expect(d3.some((d) => d.includes("registry") || d.includes("duplicate"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });



  test("extra newline on manifest fails canonical raw-text validation", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manPath = path.join(dir, "protocol/testdata/malformed/manifest.json");
      const text = await readFile(manPath, "utf8");
      await writeFile(manPath, text + "\n");
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some((d) => d.includes("canonical") || d.includes("raw text"))).toBe(
        true,
      );
      // Must fail before corpus disk reads / decoder calls: no disk: missing/extra bin noise required
      expect(diags.every((d) => !d.startsWith("disk: extra") && !d.includes("decode "))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("minified or reordered manifest JSON fails canonical raw-text validation", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const manPath = path.join(dir, "protocol/testdata/malformed/manifest.json");
      const parsed = JSON.parse(await readFile(manPath, "utf8"));
      // Minified single-line JSON (same object, different bytes).
      await writeFile(manPath, JSON.stringify(parsed));
      const d1 = (await checkMalformedFixtures(dir)).diags;
      expect(d1.some((d) => d.includes("canonical") || d.includes("raw text"))).toBe(true);
      expect(d1.every((d) => !d.includes("decode "))).toBe(true);

      // Reordered top-level keys via rebuild-then-reorder: fixtures first.
      const reordered = {
        fixtures: parsed.fixtures,
        schema_version: parsed.schema_version,
        protocol: parsed.protocol,
        byte_order: parsed.byte_order,
        generated_by: parsed.generated_by,
      };
      await writeFile(manPath, JSON.stringify(reordered, null, 2) + "\n");
      const d2 = (await checkMalformedFixtures(dir)).diags;
      expect(d2.length).toBeGreaterThan(0);
      expect(
        d2.some(
          (d) =>
            d.includes("canonical") ||
            d.includes("raw text") ||
            d.includes("unknown key") ||
            d.includes("rebuild"),
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing malformed check creates nothing", async () => {
    const dir = await scaffoldTemp();
    try {
      // protocol/registry + protocol/testdata exist; malformed absent
      const malformed = path.join(dir, "protocol/testdata/malformed");
      const before = await readdir(path.join(dir, "protocol/testdata"));
      expect(before.includes("malformed")).toBe(false);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some((d) => d.includes("missing") || d.includes("malformed"))).toBe(
        true,
      );
      const after = await readdir(path.join(dir, "protocol/testdata"));
      expect(after.includes("malformed")).toBe(false);
      expect(after).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing protocol/registry check creates nothing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "malformed-noreg-"));
    try {
      await mkdir(path.join(dir, "protocol/testdata/malformed"), { recursive: true });
      await writeFile(path.join(dir, "package.json"), "{}\n");
      await writeFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
        stableManifestJson(buildManifest()),
      );
      const protocolBefore = await readdir(path.join(dir, "protocol"));
      expect(protocolBefore.includes("registry")).toBe(false);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some((d) => d.includes("registry") || d.includes("missing"))).toBe(
        true,
      );
      const protocolAfter = await readdir(path.join(dir, "protocol"));
      expect(protocolAfter.includes("registry")).toBe(false);
      expect(protocolAfter).toEqual(protocolBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("protocol symlink with malformed external registry is not parsed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "malformed-prot-sym-"));
    try {
      await writeFile(path.join(dir, "package.json"), "{}\n");
      const external = path.join(dir, "external-protocol");
      await mkdir(path.join(external, "registry"), { recursive: true });
      await writeFile(path.join(external, "registry/r2wp-v0.json"), "{not-json");
      await mkdir(path.join(dir, "protocol-placeholder")); // unused
      await symlink(external, path.join(dir, "protocol"));
      // also need testdata/malformed under root as real dirs for check's second chain,
      // but protocol is symlink so first chain fails at protocol.
      let writeErr: string | null = null;
      try {
        await writeMalformedFixtures(dir);
      } catch (e) {
        writeErr = e instanceof Error ? e.message : String(e);
      }
      expect(writeErr).not.toBeNull();
      expect(writeErr!).toMatch(/symlink/i);
      expect(writeErr!).not.toMatch(/JSON|parse/i);

      // check mode: create real protocol tree is impossible while protocol is symlink;
      // ensure diagnostic is symlink-chain, not external JSON parse.
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("symlink"))).toBe(true);
      expect(diags.every((d) => !d.toLowerCase().includes("json"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("protocol/registry symlink read sentinel rejected before external read", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      const regAbs = path.join(dir, "protocol/registry");
      const external = path.join(dir, "external-registry-dir");
      await mkdir(external, { recursive: true });
      await writeFile(
        path.join(external, "r2wp-v0.json"),
        await readFile(path.join(dir, "protocol/registry/r2wp-v0.json")),
      );
      // replace registry directory with symlink
      await rm(regAbs, { recursive: true, force: true });
      await symlink(external, regAbs);
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.some((d) => d.includes("symlink") || d.includes("registry"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("check is tree-shape read-only on valid temp repository", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      async function snapshot(base: string): Promise<string[]> {
        const out: string[] = [];
        async function walk(rel: string) {
          const abs = path.join(base, rel);
          const entries = await readdir(abs, { withFileTypes: true });
          for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const r = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) {
              out.push(`D:${r}`);
              await walk(r);
            } else {
              const st = await lstat(path.join(base, r));
              out.push(`F:${r}:${st.size}`);
            }
          }
        }
        await walk("protocol");
        return out;
      }
      const before = (await snapshot(dir)).join("\n");
      const beforeMan = await readFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
      );
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags).toEqual([]);
      const after = (await snapshot(dir)).join("\n");
      const afterMan = await readFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
      );
      expect(after).toBe(before);
      expect(Buffer.compare(beforeMan, afterMan)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing malformed directory is stable diagnostic", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeMalformedFixtures(dir);
      // Remove entire malformed dir after placing a valid-looking rebuild-breaking path
      // Actually: write manifest then delete dir
      await rm(path.join(dir, "protocol/testdata/malformed"), {
        recursive: true,
        force: true,
      });
      // recreate only manifest parent with manifest so diagnose can run? check loads manifest first
      await mkdir(path.join(dir, "protocol/testdata/malformed"), { recursive: true });
      await writeFile(
        path.join(dir, "protocol/testdata/malformed/manifest.json"),
        stableManifestJson(buildManifest()),
      );
      await rm(path.join(dir, "protocol/testdata/malformed"), {
        recursive: true,
        force: true,
      });
      // Now both manifest and dir missing — manifest load fails first
      const { diags } = await checkMalformedFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some((d) => d.includes("manifest") || d.includes("directory") || d.includes("path"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
