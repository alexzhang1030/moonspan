import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CONTROL_1MIB_DESC_LEN,
  MANIFEST_REL,
  MANIFEST_SIZE_SOFT_MAX,
  RECIPE_LENGTH_MAX,
  RECIPE_PATTERN_MAX_BYTES,
  asciiCompare,
  buildManifest,
  checkFixtures,
  diagnoseManifest,
  fromHex,
  materializeRecipe,
  parseCliMode,
  sha256Hex,
  sortAscii,
  stableManifestJson,
  toHex,
  writeFixtures,
} from "./protocol-fixtures.ts";
import { FRAME_PAYLOAD_MAX_BYTES as FRAME_MAX } from "../sdk/typescript/src/protocol/frame.ts";
import { CONTROL_PAYLOAD_MAX_BYTES as CTRL_MAX } from "../sdk/typescript/src/protocol/control.ts";

const root = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

async function makeTempRoot(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "moonspan-fixtures-"));
  tempDirs.push(d);
  return d;
}

describe("protocol-fixtures helpers", () => {
  test("hex roundtrip and sha256 stable", () => {
    const b = new Uint8Array([0x00, 0xab, 0xff]);
    expect(fromHex(toHex(b))).toEqual(b);
    expect(sha256Hex(b)).toBe(sha256Hex(new Uint8Array([0x00, 0xab, 0xff])));
  });

  test("pattern_fill recipe materializes exact length", () => {
    const r = materializeRecipe({
      $type: "recipe",
      kind: "pattern_fill",
      pattern_hex: "a55a",
      length: 7,
    });
    expect(r.length).toBe(7);
    expect(toHex(r)).toBe("a55aa55aa55aa5");
  });

  test("asciiCompare is code-unit order not locale", () => {
    expect(asciiCompare("A", "a")).toBeLessThan(0);
    expect(asciiCompare("a", "b")).toBeLessThan(0);
    expect(sortAscii(["b", "a", "A"])).toEqual(["A", "a", "b"]);
  });

  test("1MiB desc length constant matches control ceiling export", () => {
    expect(CTRL_MAX).toBe(1_048_576);
    expect(FRAME_MAX).toBe(67_108_864);
    expect(CONTROL_1MIB_DESC_LEN).toBe(1_048_452);
  });

  test("parseCliMode requires exactly one mode", () => {
    expect(parseCliMode(["--write"])).toEqual({ mode: "write" });
    expect(parseCliMode(["--check"])).toEqual({ mode: "check" });
    expect(parseCliMode([])).toHaveProperty("error");
    expect(parseCliMode(["--write", "--check"])).toHaveProperty("error");
    expect(parseCliMode(["--write", "--extra"])).toHaveProperty("error");
  });
});

describe("protocol-fixtures build", () => {
  test("manifest fixtures are sorted unique with required coverage", () => {
    const { manifest, binaries } = buildManifest();
    expect(manifest.schema_version).toBe(1);
    expect(manifest.protocol).toBe("r2wp-v0");
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(18);
    const ids = manifest.fixtures.map((f) => f.id);
    expect(ids).toEqual(sortAscii(ids));
    expect(new Set(ids).size).toBe(ids.length);

    const cov = new Set(manifest.fixtures.flatMap((f) => f.coverage));
    for (const token of [
      "client_hello",
      "wire_versions_16",
      "server_hello",
      "bootstrap_error",
      "session_ready",
      "support_row_H-FT",
      "support_row_J-CY",
      "trace_context",
      "control_payload_1mib",
      "application_payload_64mib",
      "extension_area_4096",
    ]) {
      expect(cov.has(token)).toBe(true);
    }

    for (const f of manifest.fixtures) {
      if (f.path !== null) {
        expect(binaries.has(f.path)).toBe(true);
        expect(binaries.get(f.path)!.length).toBe(f.byte_length);
        expect(sha256Hex(binaries.get(f.path)!)).toBe(f.sha256);
      } else {
        expect(f.representation).toBe("segment_recipe");
      }
    }
  });

  test("control 1MiB and 64MiB payload lengths are exact", () => {
    const { manifest, binaries } = buildManifest();
    const c1 = manifest.fixtures.find((f) => f.id === "frame-control-payload-1mib");
    expect(c1).toBeDefined();
    expect(c1!.payload_length).toBe(1_048_576);
    // Nested recipe compaction: description is not hex-expanded in source
    const src = JSON.stringify(c1!.source);
    expect(src.includes('"hex"') && src.length > 2_000_000).toBe(false);
    expect(src.includes("pattern_fill")).toBe(true);
    const c1bytes = binaries.get(c1!.path!)!;
    const plen =
      ((c1bytes[24]! << 24) | (c1bytes[25]! << 16) | (c1bytes[26]! << 8) | c1bytes[27]!) >>> 0;
    expect(plen).toBe(1_048_576);

    const p64 = manifest.fixtures.find((f) => f.id === "frame-app-payload-64mib-recipe");
    expect(p64).toBeDefined();
    expect(p64!.path).toBeNull();
    expect(p64!.payload_length).toBe(67_108_864);
    expect(p64!.byte_length).toBe(32 + 67_108_864);
  });

  test("stableManifestJson is deterministic and compact", () => {
    const a = stableManifestJson(buildManifest().manifest);
    const b = stableManifestJson(buildManifest().manifest);
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(a, "utf8")).toBeLessThan(MANIFEST_SIZE_SOFT_MAX);
  });
});

describe("protocol-fixtures diagnose corruptions", () => {
  test("null root returns diagnostics without throwing", () => {
    const r = diagnoseManifest(null);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("root must be a plain object"))).toBe(true);
    expect(r.diagnostics).toEqual(sortAscii(r.diagnostics));
  });

  test("array root returns diagnostics without throwing", () => {
    const r = diagnoseManifest([]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toContain("root must be a plain object");
  });

  test("extra top-level key rejected", () => {
    const good = buildManifest().manifest as unknown as Record<string, unknown>;
    good.extra = true;
    const r = diagnoseManifest(good);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes('unknown key "extra"'))).toBe(true);
  });

  test("malformed fixture entry and wrong path type", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as unknown[];
    fixtures[0] = "not-an-object";
    fixtures[1] = {
      ...(fixtures[1] as object),
      path: 123,
      representation: "binary",
    };
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("must be object"))).toBe(true);
    expect(r.diagnostics.some((d) => d.includes("binary representation requires string path"))).toBe(
      true,
    );
  });

  test("missing coverage token and wrong expected shape", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as Array<Record<string, unknown>>;
    // strip all coverage to force missing required tokens
    for (const f of fixtures) f.coverage = ["zzz_only"];
    fixtures[0]!.expected = { status: "fail", roundtrip: "nope", extra: 1 };
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("missing required coverage token"))).toBe(true);
    expect(r.diagnostics.some((d) => d.includes("expected.status"))).toBe(true);
  });

  test("malformed tags and extra source field rejected", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as Array<Record<string, unknown>>;
    const frame = fixtures.find((f) => f.kind === "frame" && f.id === "frame-ros-sample-channel-u32-max");
    expect(frame).toBeDefined();
    const src = frame!.source as Record<string, unknown>;
    src.unexpectedEncoderIgnored = true;
    src.payload = { $type: "bytes", hex: "zz" };
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("unknown key \"unexpectedEncoderIgnored\""))).toBe(
      true,
    );
    expect(r.diagnostics.some((d) => d.includes("bytes.hex"))).toBe(true);
  });

  test("malformed bigint string", () => {
    const badBig = {
      schema_version: 1,
      protocol: "r2wp-v0",
      byte_order: "network",
      generated_by: "scripts/protocol-fixtures.ts",
      fixtures: [
        {
          id: "x",
          kind: "bootstrap",
          path: "valid/x.bin",
          representation: "binary",
          byte_length: 1,
          sha256: "0".repeat(64),
          expected: { status: "success", roundtrip: "decode-reencode" },
          coverage: ["client_hello"],
          source: {
            $type: "bootstrap",
            kind: "client_hello",
            wireVersions: [0],
            transportCapabilities: { webtransportHttp3: true, binaryWss: false },
            bufferCapabilities: { transferableArraybuffer: true, sharedArraybuffer: false },
            requestedLimits: { maxSessionBytes: { $type: "bigint", value: "12a" } },
            extensionCapabilities: [],
          },
        },
      ],
    };
    const r = diagnoseManifest(badBig);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("bigint.value"))).toBe(true);
  });

  test("empty recipe pattern is rejected", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as Array<Record<string, unknown>>;
    const frame = fixtures.find((f) => f.id === "frame-control-payload-1mib")!;
    const payload = frame.source as Record<string, unknown>;
    // Map entry key 26 is the description recipe
    const map = payload.payload as { entries: Array<[number, unknown]> };
    const desc = map.entries.find((e) => e[0] === 26);
    expect(desc).toBeDefined();
    (desc as [number, Record<string, unknown>])[1] = {
      $type: "recipe",
      kind: "pattern_fill",
      pattern_hex: "",
      length: 10,
    };
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("pattern_hex"))).toBe(true);
  });

  test("recipe length over FRAME_PAYLOAD_MAX_BYTES is rejected without materializing", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as Array<Record<string, unknown>>;
    const frame = fixtures.find((f) => f.id === "frame-app-payload-64mib-recipe")!;
    const src = frame.source as Record<string, unknown>;
    src.payload = {
      $type: "recipe",
      kind: "pattern_fill",
      pattern_hex: "aa",
      length: RECIPE_LENGTH_MAX + 1,
    };
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("recipe.length") && d.includes("exceeds"))).toBe(
      true,
    );
    expect(() =>
      materializeRecipe({
        $type: "recipe",
        kind: "pattern_fill",
        pattern_hex: "aa",
        length: RECIPE_LENGTH_MAX + 1,
      }),
    ).toThrow();
  });

  test("recipe pattern over RECIPE_PATTERN_MAX_BYTES is rejected", () => {
    const over = "ab".repeat(RECIPE_PATTERN_MAX_BYTES + 1);
    const r = diagnoseManifest({
      schema_version: 1,
      protocol: "r2wp-v0",
      byte_order: "network",
      generated_by: "scripts/protocol-fixtures.ts",
      fixtures: [
        {
          id: "y",
          kind: "frame",
          path: null,
          representation: "segment_recipe",
          byte_length: 1,
          sha256: "0".repeat(64),
          expected: { status: "success", roundtrip: "source-reencode" },
          coverage: ["segment_recipe"],
          source: {
            $type: "frame",
            opcode: 2,
            channelId: 1,
            sequence: 0,
            priority: 2,
            clockId: 0,
            payload: {
              $type: "recipe",
              kind: "pattern_fill",
              pattern_hex: over,
              length: 1,
            },
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("pattern length"))).toBe(true);
  });

  test("bootstrap payload_length is rejected", () => {
    const m = buildManifest().manifest as unknown as Record<string, unknown>;
    const fixtures = m.fixtures as Array<Record<string, unknown>>;
    const boot = fixtures.find((f) => f.kind === "bootstrap")!;
    boot.payload_length = 12;
    const r = diagnoseManifest(m);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.includes("payload_length is frame-only"))).toBe(true);
  });

  test("diagnostics are deterministically sorted", () => {
    const r = diagnoseManifest(null);
    const sorted = sortAscii(r.diagnostics);
    expect(r.diagnostics).toEqual(sorted);
  });
});

describe("protocol-fixtures repository check is read-only", () => {
  test("committed artifacts pass check without rewriting", async () => {
    const before = await readFile(path.join(root, MANIFEST_REL));
    const result = await checkFixtures(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const after = await readFile(path.join(root, MANIFEST_REL));
    expect(Buffer.compare(before, after)).toBe(0);
    expect(before.byteLength).toBeLessThan(MANIFEST_SIZE_SOFT_MAX);
  }, 120_000);
});

describe("protocol-fixtures write/check in temp dir", () => {
  test("write then check is idempotent outside the repository", async () => {
    const tmp = await makeTempRoot();
    await writeFixtures(tmp);
    const manifestPath = path.join(tmp, MANIFEST_REL);
    const before = await readFile(manifestPath);
    expect(before.byteLength).toBeLessThan(MANIFEST_SIZE_SOFT_MAX);

    const check1 = await checkFixtures(tmp);
    expect(check1.ok).toBe(true);
    expect(check1.diagnostics).toEqual([]);

    await writeFixtures(tmp);
    const after = await readFile(manifestPath);
    expect(Buffer.compare(before, after)).toBe(0);

    const check2 = await checkFixtures(tmp);
    expect(check2.ok).toBe(true);
  }, 180_000);

  test("path traversal is structural-only and never reads unsafe paths", async () => {
    const tmp = await makeTempRoot();
    await writeFixtures(tmp);
    const manifestPath = path.join(tmp, MANIFEST_REL);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      fixtures: Array<Record<string, unknown>>;
    };
    // Place a sentinel that would be readable if join accepted traversal.
    const sentinelRel = "sentinel.bin";
    await Bun.write(path.join(tmp, sentinelRel), new Uint8Array([0xde, 0xad]));
    const first = manifest.fixtures[0]!;
    first.path = `../../${sentinelRel}`;
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await checkFixtures(tmp);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("path must be"))).toBe(true);
    // Disk phase must not mention reading/comparing the traversal path.
    expect(result.diagnostics.every((d) => !d.includes("../../sentinel.bin"))).toBe(true);
    expect(result.diagnostics.every((d) => !d.includes("committed file ../../"))).toBe(true);
  }, 120_000);

  test("backslash and absolute paths are structural-only", async () => {
    const tmp = await makeTempRoot();
    await writeFixtures(tmp);
    const manifestPath = path.join(tmp, MANIFEST_REL);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      fixtures: Array<Record<string, unknown>>;
    };
    manifest.fixtures[0]!.path = "valid\\evil.bin";
    manifest.fixtures[1]!.path = "/tmp/evil.bin";
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await checkFixtures(tmp);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("path must be"))).toBe(true);
    expect(result.diagnostics.every((d) => !d.includes("committed file /tmp/"))).toBe(true);
    expect(result.diagnostics.every((d) => !d.includes("committed file valid\\"))).toBe(true);
  }, 120_000);

  test("file-level null JSON manifest returns diagnostics without throw", async () => {
    const tmp = await makeTempRoot();
    const dir = path.join(tmp, "protocol/testdata");
    await Bun.write(path.join(dir, "manifest.json"), "null\n");
    // empty valid dir
    await Bun.write(path.join(dir, "valid/.keep"), "");
    const result = await checkFixtures(tmp);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("root must be a plain object"))).toBe(true);
  });
});
