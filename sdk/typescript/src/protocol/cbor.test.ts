import { describe, expect, test } from "bun:test";
import {
  CborEncodeError,
  MAX_MAP_ENTRIES,
  MAX_NESTING_DEPTH,
  encodeDeterministicCbor,
} from "./cbor.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function expectHex(value: Parameters<typeof encodeDeterministicCbor>[0], expected: string): void {
  expect(hex(encodeDeterministicCbor(value))).toBe(expected);
}

function expectReject(
  value: unknown,
  reason: CborEncodeError["reason"],
): void {
  try {
    encodeDeterministicCbor(value as never);
    throw new Error("expected encode to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(CborEncodeError);
    expect((e as CborEncodeError).reason).toBe(reason);
  }
}

describe("encodeDeterministicCbor constants", () => {
  test("fixed v0 bounds", () => {
    expect(MAX_NESTING_DEPTH).toBe(16);
    expect(MAX_MAP_ENTRIES).toBe(4096);
  });
});

describe("encodeDeterministicCbor simple values", () => {
  test("booleans and null", () => {
    expectHex(false, "f4");
    expectHex(true, "f5");
    expectHex(null, "f6");
  });
});

describe("encodeDeterministicCbor integers", () => {
  test("unsigned width boundaries", () => {
    expectHex(0, "00");
    expectHex(23, "17");
    expectHex(24, "1818");
    expectHex(255, "18ff");
    expectHex(256, "190100");
    expectHex(65535, "19ffff");
    expectHex(65536, "1a00010000");
    expectHex(4294967295, "1affffffff");
    expectHex(4294967296, "1b0000000100000000");
    expectHex(0xffff_ffff_ffff_ffffn, "1bffffffffffffffff");
  });

  test("negative width boundaries", () => {
    expectHex(-1, "20");
    expectHex(-24, "37");
    expectHex(-25, "3818");
    expectHex(-256, "38ff");
    expectHex(-257, "390100");
    expectHex(-65536, "39ffff");
    expectHex(-65537, "3a00010000");
    expectHex(-4294967296, "3affffffff");
    expectHex(-4294967297, "3b0000000100000000");
    expectHex(-(0xffff_ffff_ffff_ffffn + 1n), "3bffffffffffffffff");
  });

  test("bigint and number agree on safe range", () => {
    expect(hex(encodeDeterministicCbor(1000))).toBe(hex(encodeDeterministicCbor(1000n)));
    expect(hex(encodeDeterministicCbor(-1000))).toBe(hex(encodeDeterministicCbor(-1000n)));
  });
});

describe("encodeDeterministicCbor bytes and text", () => {
  test("empty and short byte strings", () => {
    expectHex(new Uint8Array(0), "40");
    expectHex(new Uint8Array([1, 2, 3]), "43010203");
  });

  test("UTF-8 text", () => {
    expectHex("", "60");
    expectHex("a", "6161");
    expectHex("IETF", "6449455446");
    // "水" U+6C34 => e6 b0 b4
    expectHex("水", "63e6b0b4");
  });

  test("valid surrogate pair text (U+1F600)", () => {
    // 😀 U+1F600 UTF-8 f0 9f 98 80
    expectHex("\u{1F600}", "64f09f9880");
  });
});

describe("encodeDeterministicCbor arrays", () => {
  test("empty and nested", () => {
    expectHex([], "80");
    expectHex([1, 2, 3], "83010203");
    expectHex([1, [2, 3], [4, 5]], "8301820203820405");
  });
});

describe("encodeDeterministicCbor maps", () => {
  test("empty map", () => {
    expectHex(new Map(), "a0");
  });

  test("unsorted keys are canonicalized by encoded-key order", () => {
    const unsorted = new Map<number | bigint, unknown>([
      [2, false],
      [1, true],
    ]);
    // a2 01 f5 02 f4
    expectHex(unsorted as never, "a201f502f4");
  });

  test("number and bigint keys normalize and sort the same", () => {
    const a = new Map<number | bigint, unknown>([[10n, null], [2, true]]);
    const b = new Map<number | bigint, unknown>([[2n, true], [10, null]]);
    expect(hex(encodeDeterministicCbor(a as never))).toBe(
      hex(encodeDeterministicCbor(b as never)),
    );
  });

  test("duplicate normalized keys 1 and 1n rejected", () => {
    const m = new Map<number | bigint, unknown>([
      [1, true],
      [1n, false],
    ]);
    expectReject(m, "duplicate_map_key");
  });

  test("cross-width uint keys sort by encoded-key order", () => {
    // Insert out of encoded order: 65536, 24, 255, 23, 256
    const m = new Map<number, unknown>([
      [65536, 0],
      [24, 1],
      [255, 2],
      [23, 3],
      [256, 4],
    ]);
    // Canonical key order by encoded keys: 23, 24, 255, 256, 65536
    // a5 17 03 1818 01 18ff 02 190100 04 1a00010000 00
    expectHex(
      m as never,
      "a5170318180118ff02190100041a0001000000",
    );
  });

  test("value encode errors follow canonical key order, not insertion order", () => {
    // Key 1 value is float; key 2 value is unsupported. First failure is always key 1.
    const invalidFloat = 1.5;
    const invalidUnsupported = Symbol("x");
    const m1 = new Map<number, unknown>([
      [2, invalidUnsupported],
      [1, invalidFloat],
    ]);
    const m2 = new Map<number, unknown>([
      [1, invalidFloat],
      [2, invalidUnsupported],
    ]);
    let r1: string | undefined;
    let r2: string | undefined;
    try {
      encodeDeterministicCbor(m1 as never);
    } catch (e) {
      r1 = (e as CborEncodeError).reason;
    }
    try {
      encodeDeterministicCbor(m2 as never);
    } catch (e) {
      r2 = (e as CborEncodeError).reason;
    }
    expect(r1).toBe("float_not_allowed");
    expect(r2).toBe("float_not_allowed");
    expect(r1).toBe(r2);
  });
});

describe("encodeDeterministicCbor nesting depth", () => {
  function nestArray(depth: number): unknown {
    let v: unknown = 0;
    for (let i = 0; i < depth; i++) v = [v];
    return v;
  }

  test("16 nested containers pass", () => {
    const v = nestArray(MAX_NESTING_DEPTH);
    expect(() => encodeDeterministicCbor(v as never)).not.toThrow();
  });

  test("17 nested containers fail", () => {
    const v = nestArray(MAX_NESTING_DEPTH + 1);
    expectReject(v, "nesting_depth_exceeded");
  });

  test("scalar depth 0", () => {
    expectHex(42, "182a");
  });
});

describe("encodeDeterministicCbor map entry bound", () => {
  test("4096 entries pass", () => {
    const m = new Map<number, unknown>();
    for (let i = 0; i < MAX_MAP_ENTRIES; i++) m.set(i, null);
    expect(() => encodeDeterministicCbor(m as never)).not.toThrow();
  });

  test("4097 entries fail", () => {
    const m = new Map<number, unknown>();
    for (let i = 0; i < MAX_MAP_ENTRIES + 1; i++) m.set(i, null);
    expectReject(m, "map_entries_exceeded");
  });
});

describe("encodeDeterministicCbor rejections", () => {
  test("invalid unpaired surrogate", () => {
    expectReject("\uD800", "invalid_utf16");
    expectReject("\uDC00", "invalid_utf16");
  });

  test("floats and specials", () => {
    expectReject(1.5, "float_not_allowed");
    expectReject(Number.NaN, "nan_or_infinity");
    expectReject(Number.POSITIVE_INFINITY, "nan_or_infinity");
  });

  test("unsafe number", () => {
    expectReject(Number.MAX_SAFE_INTEGER + 1, "unsafe_number");
  });

  test("integer out of range", () => {
    expectReject(0xffff_ffff_ffff_ffffn + 1n, "integer_out_of_range");
    expectReject(-(0xffff_ffff_ffff_ffffn + 2n), "integer_out_of_range");
  });

  test("unsupported runtime values", () => {
    expectReject(undefined, "unsupported_value");
    expectReject(Symbol("x"), "unsupported_value");
    expectReject({ a: 1 }, "unsupported_value");
    expectReject(() => 0, "unsupported_value");
  });

  test("negative map key", () => {
    expectReject(new Map([[-1, true]]), "map_key_not_unsigned");
  });

  test("map key out of uint64 range", () => {
    expectReject(new Map([[0xffff_ffff_ffff_ffffn + 1n, true]]), "map_key_out_of_range");
  });
});
