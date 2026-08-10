import { describe, expect, test } from "bun:test";
import {
  CborDecodeError,
  CborEncodeError,
  MAX_MAP_ENTRIES,
  MAX_NESTING_DEPTH,
  decodeDeterministicCbor,
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

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

function fromHex(h: string): Uint8Array {
  const clean = h.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function expectDecodeReject(
  bytes: Uint8Array,
  reason: CborDecodeError["reason"],
): void {
  try {
    decodeDeterministicCbor(bytes);
    throw new Error(`expected decode to throw for ${hex(bytes)}`);
  } catch (e) {
    expect(e).toBeInstanceOf(CborDecodeError);
    const err = e as CborDecodeError;
    expect(err.code).toBe("invalid_control");
    expect(err.reason).toBe(reason);
    expect(typeof err.offset).toBe("number");
    expect(err.offset).toBeGreaterThanOrEqual(0);
  }
}

function roundTrip(value: Parameters<typeof encodeDeterministicCbor>[0]): void {
  const a = encodeDeterministicCbor(value);
  const decoded = decodeDeterministicCbor(a);
  const b = encodeDeterministicCbor(decoded as never);
  expect(hex(b)).toBe(hex(a));
}

describe("decodeDeterministicCbor simple values", () => {
  test("booleans and null", () => {
    expect(decodeDeterministicCbor(fromHex("f4"))).toBe(false);
    expect(decodeDeterministicCbor(fromHex("f5"))).toBe(true);
    expect(decodeDeterministicCbor(fromHex("f6"))).toBe(null);
  });
});

describe("decodeDeterministicCbor integers", () => {
  test("unsigned width boundaries and safe/bigint conversion", () => {
    expect(decodeDeterministicCbor(fromHex("00"))).toBe(0);
    expect(decodeDeterministicCbor(fromHex("17"))).toBe(23);
    expect(decodeDeterministicCbor(fromHex("1818"))).toBe(24);
    expect(decodeDeterministicCbor(fromHex("18ff"))).toBe(255);
    expect(decodeDeterministicCbor(fromHex("190100"))).toBe(256);
    expect(decodeDeterministicCbor(fromHex("19ffff"))).toBe(65535);
    expect(decodeDeterministicCbor(fromHex("1a00010000"))).toBe(65536);
    expect(decodeDeterministicCbor(fromHex("1affffffff"))).toBe(4294967295);
    expect(decodeDeterministicCbor(fromHex("1b0000000100000000"))).toBe(4294967296);
    // Max safe integer still number
    const maxSafe = encodeDeterministicCbor(Number.MAX_SAFE_INTEGER);
    expect(typeof decodeDeterministicCbor(maxSafe)).toBe("number");
    expect(decodeDeterministicCbor(maxSafe)).toBe(Number.MAX_SAFE_INTEGER);
    // Beyond safe -> bigint
    const wide = decodeDeterministicCbor(fromHex("1b0020000000000000")); // 2^53
    expect(typeof wide).toBe("bigint");
    expect(wide).toBe(0x20_0000_0000_0000n);
    const u64max = decodeDeterministicCbor(fromHex("1bffffffffffffffff"));
    expect(u64max).toBe(0xffff_ffff_ffff_ffffn);
  });

  test("negative width boundaries", () => {
    expect(decodeDeterministicCbor(fromHex("20"))).toBe(-1);
    expect(decodeDeterministicCbor(fromHex("37"))).toBe(-24);
    expect(decodeDeterministicCbor(fromHex("3818"))).toBe(-25);
    expect(decodeDeterministicCbor(fromHex("38ff"))).toBe(-256);
    expect(decodeDeterministicCbor(fromHex("390100"))).toBe(-257);
    expect(decodeDeterministicCbor(fromHex("3bffffffffffffffff"))).toBe(
      -(0xffff_ffff_ffff_ffffn + 1n),
    );
  });
});

describe("decodeDeterministicCbor bytes text array map", () => {
  test("bytes and text", () => {
    expect(hex(decodeDeterministicCbor(fromHex("43010203")) as Uint8Array)).toBe("010203");
    expect(decodeDeterministicCbor(fromHex("6449455446"))).toBe("IETF");
    expect(decodeDeterministicCbor(fromHex("64f09f9880"))).toBe("\u{1F600}");
  });

  test("UTF-8 BOM octets decode to U+FEFF and re-encode stably", () => {
    // text length 3: ef bb bf (UTF-8 BOM / U+FEFF)
    const bytes = fromHex("63efbbbf");
    const value = decodeDeterministicCbor(bytes);
    expect(value).toBe("\uFEFF");
    expect(hex(encodeDeterministicCbor(value as string))).toBe("63efbbbf");
  });

  test("arrays and maps", () => {
    expect(decodeDeterministicCbor(fromHex("83010203"))).toEqual([1, 2, 3]);
    const m = decodeDeterministicCbor(fromHex("a201f502f4")) as Map<number, unknown>;
    expect(m).toBeInstanceOf(Map);
    expect(m.get(1)).toBe(true);
    expect(m.get(2)).toBe(false);
  });

  test("decoded bytes are a copy", () => {
    const input = fromHex("43010203");
    const out = decodeDeterministicCbor(input) as Uint8Array;
    out[0] = 9;
    expect(input[1]).toBe(1);
  });
});

describe("decodeDeterministicCbor round trips", () => {
  test("encode→decode→encode byte-stable", () => {
    roundTrip(0);
    roundTrip(-1);
    roundTrip(0xffff_ffff_ffff_ffffn);
    roundTrip(-(0xffff_ffff_ffff_ffffn + 1n));
    roundTrip("水");
    roundTrip(new Uint8Array([0, 255]));
    roundTrip([1, [2, 3], true, null]);
    const m = new Map<number | bigint, unknown>([
      [65536, "x"],
      [1, false],
      [24n, 0],
    ]);
    roundTrip(m as never);
  });

  test("depth 16 and 4096-entry map round-trip", () => {
    let v: unknown = 0;
    for (let i = 0; i < MAX_NESTING_DEPTH; i++) v = [v];
    roundTrip(v as never);

    const big = new Map<number, unknown>();
    for (let i = 0; i < MAX_MAP_ENTRIES; i++) big.set(i, i % 3 === 0 ? null : i % 3 === 1);
    roundTrip(big as never);
  });
});

describe("decodeDeterministicCbor non-shortest forms", () => {
  test("major 0-5 non-shortest integer/length heads", () => {
    // uint 0 with ai=24
    expectDecodeReject(fromHex("1800"), "non_shortest_form");
    // nint -1 with ai=24 (arg 0)
    expectDecodeReject(fromHex("3800"), "non_shortest_form");
    // empty bytes with ai=24 length 0
    expectDecodeReject(fromHex("5800"), "non_shortest_form");
    // empty text with ai=24 length 0
    expectDecodeReject(fromHex("7800"), "non_shortest_form");
    // empty array with ai=24 length 0
    expectDecodeReject(fromHex("9800"), "non_shortest_form");
    // empty map with ai=24 length 0
    expectDecodeReject(fromHex("b800"), "non_shortest_form");
    // uint 23 with 2-byte form
    expectDecodeReject(fromHex("190017"), "non_shortest_form");
    // uint 255 with 2-byte form
    expectDecodeReject(fromHex("1900ff"), "non_shortest_form");
  });

  test("non-shortest map key", () => {
    // map {0: true} but key encoded as 1800
    expectDecodeReject(fromHex("a11800f5"), "non_shortest_form");
  });
});

describe("decodeDeterministicCbor malformed UTF-8", () => {
  test("overlong and invalid sequences", () => {
    // overlong encoding of slash: c0 af
    expectDecodeReject(fromHex("62c0af"), "invalid_utf8");
    // unexpected continuation
    expectDecodeReject(fromHex("6180"), "invalid_utf8");
    // truncated multi-byte (e2 80 is incomplete 3-byte sequence)
    expectDecodeReject(fromHex("62e280"), "invalid_utf8");
    // lone surrogate code unit in UTF-8 (ed a0 80 = U+D800)
    expectDecodeReject(fromHex("63eda080"), "invalid_utf8");
  });
});

describe("decodeDeterministicCbor map key rules", () => {
  test("duplicate keys", () => {
    // a2 01 f5 01 f4
    expectDecodeReject(fromHex("a201f501f4"), "duplicate_map_key");
  });

  test("duplicate key after intervening key is still duplicate_map_key", () => {
    // a3 01 f4 02 f4 01 f5  — keys 1, 2, 1 (duplicate not adjacent)
    expectDecodeReject(fromHex("a301f402f401f5"), "duplicate_map_key");
  });

  test("unsorted keys", () => {
    // a2 02 f4 01 f5  (2 then 1)
    expectDecodeReject(fromHex("a202f401f5"), "map_key_order");
  });

  test("negative key", () => {
    // a1 20 f5  key -1
    expectDecodeReject(fromHex("a120f5"), "map_key_not_unsigned");
  });

  test("text key", () => {
    // a1 6161 f5
    expectDecodeReject(fromHex("a16161f5"), "map_key_not_unsigned");
  });

  test("4097 map length rejected before entries", () => {
    // b9 1001 = map length 4097 in 2-byte form (0x1001 = 4097)
    expectDecodeReject(fromHex("b91001"), "map_entries_exceeded");
  });
});

describe("decodeDeterministicCbor depth and bounds", () => {
  test("depth 17 rejected", () => {
    // Hand-built 17 nested single-element arrays ending in 0 (encoder rejects depth 17).
    const parts: number[] = [];
    for (let i = 0; i < MAX_NESTING_DEPTH + 1; i++) parts.push(0x81);
    parts.push(0x00);
    expectDecodeReject(new Uint8Array(parts), "nesting_depth_exceeded");
  });
});

describe("decodeDeterministicCbor prohibited types", () => {
  test("tag", () => {
    // tag 0 date string prefix: c0 ...
    expectDecodeReject(fromHex("c0"), "tag_not_allowed");
  });

  test("float", () => {
    // half-precision 0.0: f9 0000
    expectDecodeReject(fromHex("f90000"), "float_not_allowed");
    // float32
    expectDecodeReject(fromHex("fa00000000"), "float_not_allowed");
    // float64
    expectDecodeReject(fromHex("fb0000000000000000"), "float_not_allowed");
  });

  test("undefined and other simple", () => {
    expectDecodeReject(fromHex("f7"), "simple_not_allowed"); // undefined
    expectDecodeReject(fromHex("f0"), "simple_not_allowed"); // simple 16
  });

  test("indefinite length", () => {
    expectDecodeReject(fromHex("9f"), "indefinite_length"); // indefinite array
    expectDecodeReject(fromHex("bf"), "indefinite_length"); // indefinite map
    expectDecodeReject(fromHex("5f"), "indefinite_length"); // indefinite bytes
    expectDecodeReject(fromHex("7f"), "indefinite_length"); // indefinite text
  });

  test("reserved additional info", () => {
    // major 0, ai 28
    expectDecodeReject(fromHex("1c"), "reserved_additional_info");
  });

  test("break is reserved outside indefinite (ai 31 on simple is break 0xff)", () => {
    expectDecodeReject(fromHex("ff"), "indefinite_length");
  });
});

describe("decodeDeterministicCbor truncation empty trailing", () => {
  test("empty input", () => {
    expectDecodeReject(new Uint8Array(0), "empty_input");
  });

  test("huge canonical array length fails without RangeError leak", () => {
    // array major 4, ai 27, length 2^32: 9b 00 00 00 01 00 00 00 00
    // remaining bytes cannot satisfy length => truncated (pre-allocation guard)
    expectDecodeReject(fromHex("9b0000000100000000"), "truncated");
  });

  test("truncation at head argument", () => {
    expectDecodeReject(fromHex("18"), "truncated"); // ai 24 missing byte
    expectDecodeReject(fromHex("19ff"), "truncated");
  });

  test("truncation at payload", () => {
    expectDecodeReject(fromHex("43"), "truncated"); // 3-byte bytes, none present
    expectDecodeReject(fromHex("4301"), "truncated");
  });

  test("truncation in array and map value", () => {
    expectDecodeReject(fromHex("81"), "truncated"); // array len 1, no item
    expectDecodeReject(fromHex("a101"), "truncated"); // map {1: ?}
  });

  test("trailing data", () => {
    expectDecodeReject(fromHex("00ff"), "trailing_data");
    expectDecodeReject(fromHex("f500"), "trailing_data");
  });

  test("wrong input type", () => {
    try {
      decodeDeterministicCbor([] as never);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CborDecodeError);
      expect((e as CborDecodeError).code).toBe("invalid_control");
      expect((e as CborDecodeError).reason).toBe("wrong_input_type");
    }
  });
});
