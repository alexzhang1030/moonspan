import { describe, expect, test } from "bun:test";
import {
  EXTENSION_ALIGNMENT,
  EXTENSION_AREA_MAX_BYTES,
  ExtensionCodecError,
  OPERATION_ID_EXTENSION_TYPE,
  OPERATION_ID_VALUE_LENGTH,
  type R2wpExtension,
  TRACE_CONTEXT_EXTENSION_TYPE,
  TRACE_CONTEXT_VALUE_LENGTH,
  decodeExtensionArea,
  encodeExtensionArea,
} from "./extension.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function expectDecodeReject(
  bytes: Uint8Array,
  code: ExtensionCodecError["code"],
  reason: ExtensionCodecError["reason"],
  offset?: number,
): ExtensionCodecError {
  try {
    decodeExtensionArea(bytes);
    throw new Error("expected decode to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ExtensionCodecError);
    expect(e).not.toBeInstanceOf(RangeError);
    const err = e as ExtensionCodecError;
    expect(err.code).toBe(code);
    expect(err.reason).toBe(reason);
    if (offset !== undefined) expect(err.offset).toBe(offset);
    return err;
  }
}

function expectEncodeReject(
  extensions: unknown,
  code: ExtensionCodecError["code"],
  reason: ExtensionCodecError["reason"],
): ExtensionCodecError {
  try {
    encodeExtensionArea(extensions as R2wpExtension[]);
    throw new Error("expected encode to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ExtensionCodecError);
    const err = e as ExtensionCodecError;
    expect(err.code).toBe(code);
    expect(err.reason).toBe(reason);
    return err;
  }
}

function traceValue(flags = 0x01): Uint8Array {
  const v = new Uint8Array(TRACE_CONTEXT_VALUE_LENGTH);
  for (let i = 0; i < 16; i++) v[i] = i + 1;
  for (let i = 0; i < 8; i++) v[16 + i] = 0xa0 + i;
  v[24] = flags;
  // reserved 25..31 stay 0
  return v;
}

function opIdValue(): Uint8Array {
  const v = new Uint8Array(OPERATION_ID_VALUE_LENGTH);
  for (let i = 0; i < OPERATION_ID_VALUE_LENGTH; i++) v[i] = 0x10 + i;
  return v;
}

const traceExt: R2wpExtension = {
  type: TRACE_CONTEXT_EXTENSION_TYPE,
  critical: false,
  value: traceValue(),
};

const opExt: R2wpExtension = {
  type: OPERATION_ID_EXTENSION_TYPE,
  critical: true,
  value: opIdValue(),
};

describe("extension constants", () => {
  test("fixed v0 area max, alignment, and assigned type registry", () => {
    expect(EXTENSION_AREA_MAX_BYTES).toBe(4096);
    expect(EXTENSION_ALIGNMENT).toBe(4);
    expect(TRACE_CONTEXT_EXTENSION_TYPE).toBe(1);
    expect(OPERATION_ID_EXTENSION_TYPE).toBe(2);
    expect(TRACE_CONTEXT_VALUE_LENGTH).toBe(32);
    expect(OPERATION_ID_VALUE_LENGTH).toBe(16);
  });
});

describe("extension golden encode/decode", () => {
  test("empty area", () => {
    const bytes = encodeExtensionArea([]);
    expect(bytes.length).toBe(0);
    expect(decodeExtensionArea(bytes)).toEqual([]);
    expect(decodeExtensionArea(new Uint8Array(0))).toEqual([]);
  });

  test("type1 TRACE_CONTEXT exact golden bytes", () => {
    const bytes = encodeExtensionArea([traceExt]);
    // type=1 flags=0 value_len=32 BE, 32 value bytes, no pad (36 is already %4==0)
    expect(hex(bytes)).toBe(
      "01000020" +
        "0102030405060708090a0b0c0d0e0f10" +
        "a0a1a2a3a4a5a6a7" +
        "01" +
        "00000000000000",
    );
    const decoded = decodeExtensionArea(bytes);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.type).toBe(1);
    expect(decoded[0]!.critical).toBe(false);
    expect(hex(decoded[0]!.value)).toBe(hex(traceExt.value));
  });

  test("type2 OPERATION_ID exact golden bytes", () => {
    const bytes = encodeExtensionArea([opExt]);
    // type=2 flags=CRITICAL value_len=16, 16 value, no pad (20 %4==0)
    expect(hex(bytes)).toBe("02010010" + "101112131415161718191a1b1c1d1e1f");
    const decoded = decodeExtensionArea(bytes);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.type).toBe(2);
    expect(decoded[0]!.critical).toBe(true);
    expect(hex(decoded[0]!.value)).toBe(hex(opExt.value));
  });

  test("encoder sorts by numeric type", () => {
    const bytes = encodeExtensionArea([opExt, traceExt]); // reverse input order
    expect(bytes[0]).toBe(1);
    expect(bytes[36]).toBe(2);
    const decoded = decodeExtensionArea(bytes);
    expect(decoded.map((e) => e.type)).toEqual([1, 2]);
  });

  test("decode↔encode known byte stability", () => {
    const a = encodeExtensionArea([traceExt, opExt]);
    const decoded = decodeExtensionArea(a);
    const b = encodeExtensionArea(decoded);
    expect(hex(b)).toBe(hex(a));
  });

  test("copy ownership for input value and output area", () => {
    const value = traceValue();
    const ext: R2wpExtension = { type: 1, critical: false, value };
    const encoded = encodeExtensionArea([ext]);
    const snapshot = hex(encoded);
    value[0] = 0xff;
    expect(hex(encodeExtensionArea([{ type: 1, critical: false, value: traceValue() }]))).toBe(
      snapshot,
    );
    // mutating prior encode output does not affect re-encode
    encoded[0] = 0x99;
    expect(hex(encodeExtensionArea([traceExt]))).toBe(snapshot);

    const area = encodeExtensionArea([traceExt]);
    const decoded = decodeExtensionArea(area);
    area[4] = 0xee;
    expect(decoded[0]!.value[0]).toBe(0x01);
    decoded[0]!.value[0] = 0xcc;
    expect(decodeExtensionArea(encodeExtensionArea([traceExt]))[0]!.value[0]).toBe(0x01);
  });
});

describe("extension per-TLV padding and wire details", () => {
  test("per-TLV padding 0/1/2/3 remainder cases with zero pad", () => {
    // unknown noncritical type 128 with value lengths 0,1,2,3 → padded sizes 4,8,8,8
    for (const valueLen of [0, 1, 2, 3]) {
      const value = new Uint8Array(valueLen).fill(0xab);
      const bytes = encodeExtensionArea([{ type: 128, critical: false, value }]);
      const content = 4 + valueLen;
      const padded = (content + 3) & ~3;
      expect(bytes.length).toBe(padded);
      for (let i = content; i < padded; i++) {
        expect(bytes[i]).toBe(0);
      }
      // decoder skips unknown noncritical
      expect(decodeExtensionArea(bytes)).toEqual([]);
    }
  });

  test("value_len is big-endian", () => {
    const value = new Uint8Array(256).fill(7);
    // type 128 noncritical, value_len 256 = 0x0100
    const bytes = encodeExtensionArea([{ type: 128, critical: false, value }]);
    expect(bytes[2]).toBe(0x01);
    expect(bytes[3]).toBe(0x00);
    expect(decodeExtensionArea(bytes)).toEqual([]);
  });

  test("strict ascending order and duplicate reject on encode", () => {
    expectEncodeReject(
      [
        { type: 1, critical: false, value: traceValue() },
        { type: 1, critical: true, value: traceValue() },
      ],
      "malformed_frame",
      "duplicate_type",
    );
  });

  test("strict ascending order and duplicate reject on decode", () => {
    const a = encodeExtensionArea([traceExt]);
    const b = encodeExtensionArea([traceExt]);
    const dup = new Uint8Array(a.length + b.length);
    dup.set(a, 0);
    dup.set(b, a.length);
    expectDecodeReject(dup, "malformed_frame", "duplicate_type", a.length);

    // type 2 then type 1
    const t2 = encodeExtensionArea([opExt]);
    const t1 = encodeExtensionArea([traceExt]);
    const unordered = new Uint8Array(t2.length + t1.length);
    unordered.set(t2, 0);
    unordered.set(t1, t2.length);
    expectDecodeReject(unordered, "malformed_frame", "order_violation", t2.length);
  });
});

describe("extension assigned fixed lengths and reserved", () => {
  test("type1 fixed length 32 and reserved zeros", () => {
    const short = new Uint8Array(31);
    expectEncodeReject(
      [{ type: 1, critical: false, value: short }],
      "malformed_frame",
      "fixed_length_mismatch",
    );
    const long = new Uint8Array(33);
    expectEncodeReject(
      [{ type: 1, critical: false, value: long }],
      "malformed_frame",
      "fixed_length_mismatch",
    );

    const badReserved = traceValue();
    badReserved[25] = 1;
    expectEncodeReject(
      [{ type: 1, critical: false, value: badReserved }],
      "malformed_frame",
      "reserved_nonzero",
    );

    // decode-side reserved
    const good = encodeExtensionArea([traceExt]);
    good[4 + 25] = 0x02;
    expectDecodeReject(good, "malformed_frame", "reserved_nonzero", 4 + 25);
  });

  test("type2 fixed length 16", () => {
    expectEncodeReject(
      [{ type: 2, critical: false, value: new Uint8Array(15) }],
      "malformed_frame",
      "fixed_length_mismatch",
    );
    const area = encodeExtensionArea([opExt]);
    // corrupt value_len to 15
    area[2] = 0x00;
    area[3] = 0x0f;
    expectDecodeReject(area, "malformed_frame", "fixed_length_mismatch", 2);
  });
});

describe("extension unknown types", () => {
  test("unknown noncritical is skipped", () => {
    const unknown = encodeExtensionArea([{ type: 200, critical: false, value: new Uint8Array([1, 2]) }]);
    const withKnown = encodeExtensionArea([
      traceExt,
      { type: 200, critical: false, value: new Uint8Array([9]) },
      opExt,
    ]);
    expect(decodeExtensionArea(unknown)).toEqual([]);
    const decoded = decodeExtensionArea(withKnown);
    expect(decoded.map((e) => e.type)).toEqual([1, 2]);
  });

  test("unknown critical is unsupported_extension after structural ok", () => {
    const bytes = encodeExtensionArea([{ type: 99, critical: true, value: new Uint8Array(0) }]);
    expectDecodeReject(bytes, "unsupported_extension", "unknown_critical", 0);
  });
});

describe("extension multi-invalid structural priority", () => {
  test("later bad padding wins over earlier unknown critical", () => {
    // type 50 critical unknown, then type 60 with nonzero padding
    // type 50: header+0 value = 4 bytes, no pad
    // type 60: header + 1 byte value = 5, pad 3 bytes — set nonzero pad
    const area = new Uint8Array(4 + 8);
    area[0] = 50;
    area[1] = 0x01; // critical
    area[2] = 0x00;
    area[3] = 0x00; // value_len 0
    area[4] = 60;
    area[5] = 0x00;
    area[6] = 0x00;
    area[7] = 0x01; // value_len 1
    area[8] = 0xaa; // value
    area[9] = 0x01; // nonzero padding → structural
    area[10] = 0x00;
    area[11] = 0x00;
    expectDecodeReject(area, "malformed_frame", "nonzero_padding", 9);
  });

  test("later order violation wins over earlier unknown critical", () => {
    // type 80 critical, then type 10 (descending)
    const a = encodeExtensionArea([{ type: 80, critical: true, value: new Uint8Array(0) }]);
    const b = encodeExtensionArea([{ type: 10, critical: false, value: new Uint8Array(0) }]);
    const area = new Uint8Array(a.length + b.length);
    area.set(a);
    area.set(b, a.length);
    expectDecodeReject(area, "malformed_frame", "order_violation", a.length);
  });

  test("later reserved flag bits wins over earlier unknown critical", () => {
    const area = new Uint8Array(8);
    area[0] = 40;
    area[1] = 0x01; // critical unknown
    area[2] = 0;
    area[3] = 0;
    area[4] = 41;
    area[5] = 0x02; // reserved bit set
    area[6] = 0;
    area[7] = 0;
    expectDecodeReject(area, "malformed_frame", "reserved_flag_bits", 5);
  });
});

describe("extension area bounds and truncation", () => {
  test("exact 4096 area boundary and 4100 reject", () => {
    // Fill with noncritical type 128 TLVs of value_len 0 (4 bytes each) → 1024 TLVs = 4096
    // But types must be unique ascending — so use one large unknown noncritical value.
    // One TLV: header 4 + value 4092 = 4096, no pad.
    const value = new Uint8Array(4092).fill(0x5a);
    const exact = encodeExtensionArea([{ type: 128, critical: false, value }]);
    expect(exact.length).toBe(4096);
    expect(decodeExtensionArea(exact)).toEqual([]);

    const tooBig = new Uint8Array(4100);
    expectDecodeReject(tooBig, "message_too_large", "area_too_large", 0);

    expectEncodeReject(
      [{ type: 128, critical: false, value: new Uint8Array(4093) }], // 4+4093=4097 → pad to 4100
      "message_too_large",
      "area_too_large",
    );
  });

  test("area length not multiple of 4", () => {
    // Area length and TLV offsets are 4-aligned, so partial header/padding inputs
    // surface as area_alignment (or truncated_value below). truncated_header /
    // truncated_padding branches stay defensive.
    expectDecodeReject(new Uint8Array(2), "malformed_frame", "area_alignment", 0);
    expectDecodeReject(new Uint8Array(6), "malformed_frame", "area_alignment", 0);
  });

  test("truncated value when declared length exceeds area", () => {
    // Aligned 4-byte area, value_len 4 → needs 8 bytes total.
    const shortValue = new Uint8Array(4);
    shortValue[0] = 128;
    shortValue[1] = 0;
    shortValue[2] = 0;
    shortValue[3] = 4;
    expectDecodeReject(shortValue, "malformed_frame", "truncated_value", 4);

    // Aligned 4-byte area, value_len 16 → needs 20 bytes total.
    const hdr = new Uint8Array(4);
    hdr[0] = 128;
    hdr[1] = 0;
    hdr[2] = 0x00;
    hdr[3] = 0x10;
    expectDecodeReject(hdr, "malformed_frame", "truncated_value", 4);
  });

  test("reserved flag bits must be zero", () => {
    const area = encodeExtensionArea([traceExt]);
    area[1] = 0x02;
    expectDecodeReject(area, "malformed_frame", "reserved_flag_bits", 1);
    area[1] = 0x03; // critical + reserved
    expectDecodeReject(area, "malformed_frame", "reserved_flag_bits", 1);
  });
});

describe("extension encode shape and native normalization", () => {
  test("exact object shape and runtime types", () => {
    expectEncodeReject(
      [{ type: 1, critical: false, value: traceValue(), extra: true }],
      "malformed_frame",
      "extra_key",
    );
    expectEncodeReject(
      [{ type: 1, critical: false }],
      "malformed_frame",
      "missing_key",
    );
    expectEncodeReject(
      [{ type: 1, critical: "yes", value: traceValue() }],
      "malformed_frame",
      "wrong_type",
    );
    expectEncodeReject(
      [{ type: 256, critical: false, value: new Uint8Array(0) }],
      "malformed_frame",
      "range_violation",
    );
    expectEncodeReject("not-array", "malformed_frame", "wrong_input_type");
  });

  test("wrong input type on decode", () => {
    try {
      decodeExtensionArea("nope" as unknown as Uint8Array);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExtensionCodecError);
      expect((e as ExtensionCodecError).code).toBe("malformed_frame");
      expect((e as ExtensionCodecError).reason).toBe("wrong_input_type");
    }
  });

  test("native RangeError from slice normalizes to codec_failure", () => {
    const bytes = encodeExtensionArea([traceExt]);
    Object.defineProperty(bytes, "slice", {
      configurable: true,
      value: () => {
        throw new RangeError("forced slice failure");
      },
    });
    try {
      decodeExtensionArea(bytes);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExtensionCodecError);
      expect(e).not.toBeInstanceOf(RangeError);
      const err = e as ExtensionCodecError;
      expect(err.code).toBe("malformed_frame");
      expect(err.reason).toBe("codec_failure");
    }
  });
});
