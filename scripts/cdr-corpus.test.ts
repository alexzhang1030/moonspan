import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FIXTURE_SPECS,
  GENERATED_CORPUS_ENTRIES,
  PLATFORM,
  REQUIRED_COVERAGE,
  SUPPORT_ROWS,
  asciiCompare,
  digestsEqual,
  listGeneratedCorpusDigests,
  normalizeSourceText,
  parseCliMode,
  parseSummaryTsv,
  sha256Hex,
  sortKeysDeep,
  stableJsonCompact,
  stableJsonPretty,
  bundleFileName,
  bundleRelPath,
} from "./cdr-corpus.ts";

describe("cdr-corpus helpers", () => {
  test("phase-one support rows are the six first-class RMW rows", () => {
    expect(SUPPORT_ROWS.map((row) => row.id)).toEqual([
      "H-FT",
      "H-CY",
      "H-ZN",
      "J-FT",
      "J-CY",
      "J-ZN",
    ]);
    expect(new Set(SUPPORT_ROWS.map((row) => row.rmw))).toEqual(
      new Set(["rmw_fastrtps_cpp", "rmw_cyclonedds_cpp", "rmw_zenoh_cpp"]),
    );
    expect(PLATFORM).toBe("linux/arm64");
  });

  test("fixture coverage includes required CDR surfaces", () => {
    const coverage = new Set(
      Object.values(FIXTURE_SPECS).flatMap((spec) => spec.coverage),
    );
    for (const token of REQUIRED_COVERAGE) {
      expect(coverage.has(token)).toBe(true);
    }
    expect(FIXTURE_SPECS.primitive_scalars_big_endian?.coverage).toContain(
      "endianness_big",
    );
  });

  test("CLI mode parsing accepts write check and reproduce", () => {
    expect(parseCliMode(["--write"])).toEqual({ mode: "write" });
    expect(parseCliMode(["--check"])).toEqual({ mode: "check" });
    expect(parseCliMode(["--reproduce"])).toEqual({ mode: "reproduce" });
    expect(parseCliMode([])).toHaveProperty("error");
    expect(parseCliMode(["--other"])).toHaveProperty("error");
  });

  test("stable JSON helpers sort keys and normalize source text", () => {
    expect(stableJsonCompact({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(stableJsonPretty({ z: 1, a: 2 })).toBe('{\n  "a": 2,\n  "z": 1\n}\n');
    expect(sortKeysDeep({ b: [2, 1], a: 0 })).toEqual({ a: 0, b: [2, 1] });
    expect(normalizeSourceText("a  \r\nb\t\n\n")).toBe("a\nb\n");
    expect(asciiCompare("a", "b")).toBe(-1);
    expect(sha256Hex("rclweb")).toHaveLength(64);
    expect(bundleFileName("rclweb_cdr_interfaces/msg/PrimitiveScalars")).toBe(
      "rclweb_cdr_interfaces.msg.PrimitiveScalars.json",
    );
    expect(bundleRelPath("sensor_msgs/msg/PointCloud2")).toBe(
      "fixtures/bundles/sensor_msgs.msg.PointCloud2.json",
    );
  });

  test("summary.tsv parser validates header and rows", () => {
    const text = [
      "fixture_id\ttype_name\tserializer\tendianness\ttype_hash\tbyte_length",
      "primitive_scalars\trclweb_cdr_interfaces/msg/PrimitiveScalars\trmw_serialize_zero_padding_v1\tlittle\t\t48",
      "primitive_scalars_big_endian\trclweb_cdr_interfaces/msg/PrimitiveScalars\trosidl_typesupport_fastrtps_cpp\tbig\tRIHS01_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\t48",
      "",
    ].join("\n");
    const rows = parseSummaryTsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.endianness).toBe("little");
    expect(rows[1]?.endianness).toBe("big");
    expect(() => parseSummaryTsv("bad\n")).toThrow();
  });
});

describe("cdr-corpus reproduce comparison scope", () => {
  const temps: string[] = [];
  afterEach(async () => {
    for (const dir of temps.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("generated corpus entries are fixtures and manifest only", () => {
    expect([...GENERATED_CORPUS_ENTRIES]).toEqual(["fixtures", "manifest.json"]);
  });

  test("listGeneratedCorpusDigests ignores docs and source trees outside the artifact set", async () => {
    const corpus = await mkdtemp(path.join(tmpdir(), "rclweb-cdr-scope-"));
    temps.push(corpus);
    await mkdir(path.join(corpus, "fixtures", "H-FT"), { recursive: true });
    await mkdir(path.join(corpus, "generate"), { recursive: true });
    await writeFile(path.join(corpus, "manifest.json"), '{"corpus":"test"}\n');
    await writeFile(path.join(corpus, "fixtures", "H-FT", "primitive_scalars.bin"), "bin-a");
    await writeFile(path.join(corpus, "fixtures", "H-FT", "row.json"), '{"id":"H-FT"}\n');
    await writeFile(path.join(corpus, "README.md"), "# docs outside generated set\n");
    await writeFile(path.join(corpus, "generate", "Dockerfile"), "FROM scratch\n");

    const digests = await listGeneratedCorpusDigests(corpus);
    const paths = digests.map(([rel]) => rel).sort(asciiCompare);
    expect(paths).toEqual([
      "fixtures/H-FT/primitive_scalars.bin",
      "fixtures/H-FT/row.json",
      "manifest.json",
    ]);
    expect(paths.some((rel) => rel === "README.md" || rel.startsWith("generate/"))).toBe(
      false,
    );

    const twin = await mkdtemp(path.join(tmpdir(), "rclweb-cdr-scope-twin-"));
    temps.push(twin);
    await mkdir(path.join(twin, "fixtures", "H-FT"), { recursive: true });
    await writeFile(path.join(twin, "manifest.json"), '{"corpus":"test"}\n');
    await writeFile(path.join(twin, "fixtures", "H-FT", "primitive_scalars.bin"), "bin-a");
    await writeFile(path.join(twin, "fixtures", "H-FT", "row.json"), '{"id":"H-FT"}\n');
    // Twin has no README.md or generate/ tree — still equal under generated scope.
    expect(digestsEqual(digests, await listGeneratedCorpusDigests(twin))).toBe(true);

    await writeFile(path.join(twin, "fixtures", "H-FT", "primitive_scalars.bin"), "bin-b");
    expect(digestsEqual(digests, await listGeneratedCorpusDigests(twin))).toBe(false);
  });
});
