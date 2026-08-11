import { describe, expect, test } from "bun:test";
import {
  FIXTURE_SPECS,
  PLATFORM,
  REQUIRED_COVERAGE,
  SUPPORT_ROWS,
  asciiCompare,
  normalizeSourceText,
  parseCliMode,
  parseSummaryTsv,
  sha256Hex,
  sortKeysDeep,
  stableJsonCompact,
  stableJsonPretty,
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
    expect(sha256Hex("moonspan")).toHaveLength(64);
  });

  test("summary.tsv parser validates header and rows", () => {
    const text = [
      "fixture_id\ttype_name\tserializer\tendianness\ttype_hash\tbyte_length",
      "primitive_scalars\tmoonspan_cdr_interfaces/msg/PrimitiveScalars\trmw_serialize_zero_padding_v1\tlittle\t\t48",
      "primitive_scalars_big_endian\tmoonspan_cdr_interfaces/msg/PrimitiveScalars\trosidl_typesupport_fastrtps_cpp\tbig\tRIHS01_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\t48",
      "",
    ].join("\n");
    const rows = parseSummaryTsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.endianness).toBe("little");
    expect(rows[1]?.endianness).toBe("big");
    expect(() => parseSummaryTsv("bad\n")).toThrow();
  });
});
