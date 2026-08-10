/**
 * R2WP v0 deterministic CBOR subset (encode + decode, M0-03c).
 *
 * Fixed contract bounds from protocol/registry/r2wp-v0.json absolute_limits:
 * cbor_nesting_depth_max = 16, cbor_map_entries_max = 4096.
 */

/** Fixed v0 contract: absolute_limits.cbor_nesting_depth_max */
export const MAX_NESTING_DEPTH = 16;

/** Fixed v0 contract: absolute_limits.cbor_map_entries_max */
export const MAX_MAP_ENTRIES = 4096;

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const MIN_NINT = -(UINT64_MAX + 1n); // -2^64
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export type CborValue =
  | boolean
  | null
  | number
  | bigint
  | string
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<number | bigint, CborValue>;

// ---------------------------------------------------------------------------
// Encode errors
// ---------------------------------------------------------------------------

export type CborEncodeErrorReason =
  | "float_not_allowed"
  | "nan_or_infinity"
  | "unsafe_number"
  | "integer_out_of_range"
  | "invalid_utf16"
  | "duplicate_map_key"
  | "map_key_not_unsigned"
  | "map_key_out_of_range"
  | "nesting_depth_exceeded"
  | "map_entries_exceeded"
  | "unsupported_value";

export class CborEncodeError extends Error {
  readonly reason: CborEncodeErrorReason;

  constructor(reason: CborEncodeErrorReason, message: string) {
    super(message);
    this.name = "CborEncodeError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Decode errors (control-plane semantic: invalid_control)
// ---------------------------------------------------------------------------

export type CborDecodeErrorReason =
  | "empty_input"
  | "truncated"
  | "trailing_data"
  | "non_shortest_form"
  | "reserved_additional_info"
  | "indefinite_length"
  | "tag_not_allowed"
  | "float_not_allowed"
  | "simple_not_allowed"
  | "invalid_utf8"
  | "nesting_depth_exceeded"
  | "map_entries_exceeded"
  | "length_out_of_range"
  | "map_key_not_unsigned"
  | "duplicate_map_key"
  | "map_key_order"
  | "unsupported_major_type"
  | "wrong_input_type"
  | "decoder_failure";

export class CborDecodeError extends Error {
  readonly code = "invalid_control" as const;
  readonly reason: CborDecodeErrorReason;
  readonly offset: number;

  constructor(reason: CborDecodeErrorReason, offset: number, message: string) {
    super(message);
    this.name = "CborDecodeError";
    this.reason = reason;
    this.offset = offset;
  }
}

// --- Major types / simple values ---

const MT_UINT = 0;
const MT_NINT = 1;
const MT_BYTES = 2;
const MT_TEXT = 3;
const MT_ARRAY = 4;
const MT_MAP = 5;
const MT_TAG = 6;
const MT_SIMPLE = 7;

const SIMPLE_FALSE = 20;
const SIMPLE_TRUE = 21;
const SIMPLE_NULL = 22;

// ---------------------------------------------------------------------------
// Shared encode helpers
// ---------------------------------------------------------------------------

function encodeHead(majorType: number, argument: bigint): Uint8Array {
  if (!Number.isInteger(majorType) || majorType < 0 || majorType > 7) {
    throw new CborEncodeError("unsupported_value", `invalid CBOR major type: ${majorType}`);
  }
  if (argument < 0n || argument > UINT64_MAX) {
    throw new CborEncodeError("integer_out_of_range", `CBOR head argument out of range: ${argument}`);
  }
  const mt = majorType << 5;
  if (argument <= 23n) {
    return Uint8Array.of(mt | Number(argument));
  }
  if (argument <= 0xffn) {
    return Uint8Array.of(mt | 24, Number(argument));
  }
  if (argument <= 0xffffn) {
    const n = Number(argument);
    return Uint8Array.of(mt | 25, (n >>> 8) & 0xff, n & 0xff);
  }
  if (argument <= 0xffff_ffffn) {
    const n = Number(argument);
    return Uint8Array.of(
      mt | 26,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    );
  }
  let x = argument;
  const out = new Uint8Array(9);
  out[0] = mt | 27;
  for (let i = 8; i >= 1; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function assertNoUnpairedSurrogates(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= text.length) {
        throw new CborEncodeError("invalid_utf16", "unpaired high UTF-16 surrogate at end of string");
      }
      const d = text.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) {
        throw new CborEncodeError("invalid_utf16", "unpaired high UTF-16 surrogate");
      }
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CborEncodeError("invalid_utf16", "unpaired low UTF-16 surrogate");
    }
  }
}

function normalizeUnsignedKey(key: number | bigint): bigint {
  if (typeof key === "number") {
    if (!Number.isFinite(key) || Number.isNaN(key)) {
      throw new CborEncodeError("nan_or_infinity", "map key is NaN or Infinity");
    }
    if (!Number.isSafeInteger(key)) {
      throw new CborEncodeError("unsafe_number", "map key is not a safe integer");
    }
    if (key < 0) {
      throw new CborEncodeError("map_key_not_unsigned", "map key must be unsigned");
    }
    return BigInt(key);
  }
  if (typeof key === "bigint") {
    if (key < 0n) {
      throw new CborEncodeError("map_key_not_unsigned", "map key must be unsigned");
    }
    if (key > UINT64_MAX) {
      throw new CborEncodeError("map_key_out_of_range", "map key exceeds uint64");
    }
    return key;
  }
  throw new CborEncodeError("map_key_not_unsigned", "map key must be number or bigint");
}

function encodeUnsignedInteger(value: bigint): Uint8Array {
  if (value < 0n || value > UINT64_MAX) {
    throw new CborEncodeError("integer_out_of_range", `unsigned integer out of CBOR range: ${value}`);
  }
  return encodeHead(MT_UINT, value);
}

function encodeNegativeInteger(value: bigint): Uint8Array {
  if (value >= 0n) {
    throw new CborEncodeError("integer_out_of_range", "expected negative integer");
  }
  if (value < MIN_NINT) {
    throw new CborEncodeError("integer_out_of_range", `negative integer below -2^64: ${value}`);
  }
  const arg = -1n - value;
  return encodeHead(MT_NINT, arg);
}

function encodeLengthHead(majorType: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new CborEncodeError("integer_out_of_range", `invalid length: ${length}`);
  }
  return encodeHead(majorType, BigInt(length));
}

function encodeIntegerFromNumber(n: number): Uint8Array {
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new CborEncodeError("nan_or_infinity", "NaN and Infinity are not allowed");
  }
  if (!Number.isInteger(n)) {
    throw new CborEncodeError("float_not_allowed", "floating-point numbers are not allowed");
  }
  if (!Number.isSafeInteger(n)) {
    throw new CborEncodeError("unsafe_number", "number is not a safe integer; use bigint for full range");
  }
  if (n >= 0) return encodeUnsignedInteger(BigInt(n));
  return encodeNegativeInteger(BigInt(n));
}

function encodeIntegerFromBigInt(n: bigint): Uint8Array {
  if (n >= 0n) return encodeUnsignedInteger(n);
  return encodeNegativeInteger(n);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function encodeValue(value: CborValue, depth: number): Uint8Array {
  if (value === null) {
    return Uint8Array.of((MT_SIMPLE << 5) | SIMPLE_NULL);
  }
  if (typeof value === "boolean") {
    return Uint8Array.of((MT_SIMPLE << 5) | (value ? SIMPLE_TRUE : SIMPLE_FALSE));
  }
  if (typeof value === "number") {
    return encodeIntegerFromNumber(value);
  }
  if (typeof value === "bigint") {
    return encodeIntegerFromBigInt(value);
  }
  if (typeof value === "string") {
    assertNoUnpairedSurrogates(value);
    const utf8 = new TextEncoder().encode(value);
    return concatChunks([encodeLengthHead(MT_TEXT, utf8.length), utf8]);
  }
  if (value instanceof Uint8Array) {
    return concatChunks([encodeLengthHead(MT_BYTES, value.length), value]);
  }
  if (Array.isArray(value)) {
    const next = depth + 1;
    if (next > MAX_NESTING_DEPTH) {
      throw new CborEncodeError(
        "nesting_depth_exceeded",
        `array nesting depth ${next} exceeds max ${MAX_NESTING_DEPTH}`,
      );
    }
    const parts: Uint8Array[] = [encodeLengthHead(MT_ARRAY, value.length)];
    for (const el of value) {
      parts.push(encodeValue(el as CborValue, next));
    }
    return concatChunks(parts);
  }
  if (value instanceof Map) {
    const next = depth + 1;
    if (next > MAX_NESTING_DEPTH) {
      throw new CborEncodeError(
        "nesting_depth_exceeded",
        `map nesting depth ${next} exceeds max ${MAX_NESTING_DEPTH}`,
      );
    }
    if (value.size > MAX_MAP_ENTRIES) {
      throw new CborEncodeError(
        "map_entries_exceeded",
        `map has ${value.size} entries; max is ${MAX_MAP_ENTRIES}`,
      );
    }
    type KeyRecord = { keyNorm: bigint; keyEnc: Uint8Array; value: CborValue };
    const keyRecords: KeyRecord[] = [];
    const seen = new Set<string>();
    for (const [k, v] of value.entries()) {
      const keyNorm = normalizeUnsignedKey(k as number | bigint);
      const keyId = keyNorm.toString();
      if (seen.has(keyId)) {
        throw new CborEncodeError(
          "duplicate_map_key",
          `duplicate map key after normalization: ${keyId}`,
        );
      }
      seen.add(keyId);
      keyRecords.push({
        keyNorm,
        keyEnc: encodeUnsignedInteger(keyNorm),
        value: v as CborValue,
      });
    }
    keyRecords.sort((a, b) => compareBytes(a.keyEnc, b.keyEnc));
    const parts: Uint8Array[] = [encodeLengthHead(MT_MAP, keyRecords.length)];
    for (const rec of keyRecords) {
      parts.push(rec.keyEnc, encodeValue(rec.value, next));
    }
    return concatChunks(parts);
  }

  throw new CborEncodeError(
    "unsupported_value",
    `unsupported CBOR value type: ${Object.prototype.toString.call(value)}`,
  );
}

/**
 * Encode a value with R2WP v0 deterministic CBOR rules.
 * Returns a new Uint8Array of the definite-length encoding.
 */
export function encodeDeterministicCbor(value: CborValue): Uint8Array {
  return encodeValue(value, 0);
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

class Reader {
  readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  fail(reason: CborDecodeErrorReason, message: string, at?: number): never {
    throw new CborDecodeError(reason, at ?? this.offset, message);
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      this.fail("truncated", "unexpected end of input");
    }
    return this.bytes[this.offset++]!;
  }

  readBytes(n: number): Uint8Array {
    if (n < 0 || !Number.isSafeInteger(n)) {
      this.fail("length_out_of_range", `invalid byte length ${n}`);
    }
    if (this.remaining < n) {
      this.fail("truncated", `need ${n} bytes, have ${this.remaining}`);
    }
    const slice = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    // Return a copy so callers cannot mutate the input buffer via the result.
    return new Uint8Array(slice);
  }
}

type Head = {
  major: number;
  additional: number;
  argument: bigint;
  headOffset: number;
};

function readHead(r: Reader): Head {
  const headOffset = r.offset;
  if (r.remaining === 0) {
    r.fail("truncated", "unexpected end of input while reading head", headOffset);
  }
  const initial = r.readByte();
  const major = initial >> 5;
  const additional = initial & 0x1f;
  // Major type 7 with ai 25/26/27 is IEEE float, not an integer argument.
  const integerArgument = !(major === MT_SIMPLE && additional >= 25 && additional <= 27);

  if (additional <= 23) {
    return { major, additional, argument: BigInt(additional), headOffset };
  }
  if (additional === 24) {
    if (r.remaining < 1) r.fail("truncated", "truncated 1-byte argument", headOffset);
    const arg = BigInt(r.readByte());
    // Integer args and simple values 0-23 must use the compact additional-info form.
    if (arg < 24n) {
      r.fail("non_shortest_form", "additional info 24 used for value < 24", headOffset);
    }
    return { major, additional, argument: arg, headOffset };
  }
  if (additional === 25) {
    if (r.remaining < 2) r.fail("truncated", "truncated 2-byte argument", headOffset);
    const arg = (BigInt(r.readByte()) << 8n) | BigInt(r.readByte());
    if (integerArgument && arg < 0x100n) {
      r.fail("non_shortest_form", "additional info 25 used for value < 256", headOffset);
    }
    return { major, additional, argument: arg, headOffset };
  }
  if (additional === 26) {
    if (r.remaining < 4) r.fail("truncated", "truncated 4-byte argument", headOffset);
    let arg = 0n;
    for (let i = 0; i < 4; i++) arg = (arg << 8n) | BigInt(r.readByte());
    if (integerArgument && arg < 0x1_0000n) {
      r.fail("non_shortest_form", "additional info 26 used for value < 65536", headOffset);
    }
    return { major, additional, argument: arg, headOffset };
  }
  if (additional === 27) {
    if (r.remaining < 8) r.fail("truncated", "truncated 8-byte argument", headOffset);
    let arg = 0n;
    for (let i = 0; i < 8; i++) arg = (arg << 8n) | BigInt(r.readByte());
    if (integerArgument && arg < 0x1_0000_0000n) {
      r.fail("non_shortest_form", "additional info 27 used for value < 2^32", headOffset);
    }
    return { major, additional, argument: arg, headOffset };
  }
  if (additional === 31) {
    r.fail("indefinite_length", "indefinite-length items are not allowed", headOffset);
  }
  // 28, 29, 30 reserved
  r.fail("reserved_additional_info", `reserved additional info ${additional}`, headOffset);
}

function bigintToJsInteger(arg: bigint): number | bigint {
  if (arg <= MAX_SAFE) return Number(arg);
  return arg;
}

function nintToJsInteger(arg: bigint): number | bigint {
  // value = -1 - arg
  const v = -1n - arg;
  if (v >= -MAX_SAFE && v <= MAX_SAFE) return Number(v);
  return v;
}

/** Convert length argument to a safe Number for allocation, or fail. */
function lengthToNumber(r: Reader, arg: bigint, headOffset: number): number {
  if (arg > MAX_SAFE) {
    r.fail("length_out_of_range", `length ${arg} exceeds safe integer / allocation limit`, headOffset);
  }
  return Number(arg);
}

function decodeValue(r: Reader, depth: number): CborValue {
  const head = readHead(r);
  const { major, additional, argument, headOffset } = head;

  switch (major) {
    case MT_UINT:
      return bigintToJsInteger(argument);

    case MT_NINT:
      return nintToJsInteger(argument);

    case MT_BYTES: {
      const len = lengthToNumber(r, argument, headOffset);
      return r.readBytes(len);
    }

    case MT_TEXT: {
      const len = lengthToNumber(r, argument, headOffset);
      const raw = r.readBytes(len);
      try {
        // ignoreBOM: keep U+FEFF when the payload is the UTF-8 BOM octets.
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
      } catch {
        r.fail("invalid_utf8", "malformed UTF-8 text string", headOffset);
      }
    }

    case MT_ARRAY: {
      const next = depth + 1;
      if (next > MAX_NESTING_DEPTH) {
        r.fail(
          "nesting_depth_exceeded",
          `array nesting depth ${next} exceeds max ${MAX_NESTING_DEPTH}`,
          headOffset,
        );
      }
      const len = lengthToNumber(r, argument, headOffset);
      // Each element is at least one byte; reject before allocation.
      if (len > r.remaining) {
        r.fail(
          "truncated",
          `array length ${len} exceeds remaining ${r.remaining} bytes`,
          headOffset,
        );
      }
      let out: CborValue[];
      try {
        out = new Array(len);
      } catch {
        r.fail("length_out_of_range", `unable to allocate array of length ${len}`, headOffset);
      }
      for (let i = 0; i < len; i++) {
        out[i] = decodeValue(r, next);
      }
      return out;
    }

    case MT_MAP: {
      const next = depth + 1;
      if (next > MAX_NESTING_DEPTH) {
        r.fail(
          "nesting_depth_exceeded",
          `map nesting depth ${next} exceeds max ${MAX_NESTING_DEPTH}`,
          headOffset,
        );
      }
      // Reject oversized maps before entry parsing
      if (argument > BigInt(MAX_MAP_ENTRIES)) {
        r.fail(
          "map_entries_exceeded",
          `map declares ${argument} entries; max is ${MAX_MAP_ENTRIES}`,
          headOffset,
        );
      }
      const len = lengthToNumber(r, argument, headOffset);
      // Each entry is at least key (1 byte) + value (1 byte).
      if (len > 0 && len * 2 > r.remaining) {
        r.fail(
          "truncated",
          `map length ${len} exceeds remaining ${r.remaining} bytes`,
          headOffset,
        );
      }
      const out = new Map<number | bigint, CborValue>();
      const seenKeys = new Set<string>();
      let prevKey: bigint | null = null;
      for (let i = 0; i < len; i++) {
        const keyHead = readHead(r);
        if (keyHead.major !== MT_UINT) {
          r.fail(
            "map_key_not_unsigned",
            `map key major type ${keyHead.major} is not unsigned integer`,
            keyHead.headOffset,
          );
        }
        const keyNorm = keyHead.argument;
        const keyId = keyNorm.toString();
        // Full-set duplicate detection before order checks (any prior position).
        if (seenKeys.has(keyId)) {
          r.fail("duplicate_map_key", `duplicate map key ${keyNorm}`, keyHead.headOffset);
        }
        if (prevKey !== null && keyNorm < prevKey) {
          r.fail(
            "map_key_order",
            `map keys not in strictly increasing order: ${keyNorm} after ${prevKey}`,
            keyHead.headOffset,
          );
        }
        seenKeys.add(keyId);
        prevKey = keyNorm;
        const keyJs = bigintToJsInteger(keyNorm);
        const val = decodeValue(r, next);
        out.set(keyJs, val);
      }
      return out;
    }

    case MT_TAG:
      r.fail("tag_not_allowed", "CBOR tags are not allowed", headOffset);

    case MT_SIMPLE: {
      // Floats use additional 25/26/27 with payload already consumed as argument in readHead —
      // but for major 7, ai 25/26/27 are half/float/double, NOT integer args in our subset.
      // readHead already read 2/4/8 bytes as integer argument. Reject floats here.
      if (additional === 25 || additional === 26 || additional === 27) {
        r.fail("float_not_allowed", `floating-point simple/float (ai=${additional}) not allowed`, headOffset);
      }
      if (additional === 24) {
        // one-byte simple value in argument
        const simple = Number(argument);
        if (simple === SIMPLE_FALSE) return false;
        if (simple === SIMPLE_TRUE) return true;
        if (simple === SIMPLE_NULL) return null;
        if (simple === 23) {
          // undefined
          r.fail("simple_not_allowed", "simple value undefined is not allowed", headOffset);
        }
        r.fail("simple_not_allowed", `simple value ${simple} is not allowed`, headOffset);
      }
      // Direct simple 0-23 in additional
      if (additional === SIMPLE_FALSE) return false;
      if (additional === SIMPLE_TRUE) return true;
      if (additional === SIMPLE_NULL) return null;
      if (additional === 23) {
        r.fail("simple_not_allowed", "simple value undefined is not allowed", headOffset);
      }
      // Simple values 0-19 (except we allow nothing else)
      r.fail("simple_not_allowed", `simple value ${additional} is not allowed`, headOffset);
    }

    default:
      r.fail("unsupported_major_type", `unsupported major type ${major}`, headOffset);
  }
}

/**
 * Decode exactly one complete R2WP v0 deterministic CBOR item.
 * Rejects empty input, truncation, and trailing bytes. Never returns partial values.
 */
export function decodeDeterministicCbor(bytes: Uint8Array): CborValue {
  if (!(bytes instanceof Uint8Array)) {
    throw new CborDecodeError(
      "wrong_input_type",
      0,
      "decodeDeterministicCbor requires a Uint8Array",
    );
  }
  if (bytes.length === 0) {
    throw new CborDecodeError("empty_input", 0, "empty CBOR input");
  }
  const r = new Reader(bytes);
  try {
    const value = decodeValue(r, 0);
    if (r.offset !== bytes.length) {
      throw new CborDecodeError(
        "trailing_data",
        r.offset,
        `trailing data after complete item at offset ${r.offset}`,
      );
    }
    return value;
  } catch (e) {
    if (e instanceof CborDecodeError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new CborDecodeError(
      "decoder_failure",
      r.offset,
      `unexpected decoder failure: ${msg}`,
    );
  }
}
