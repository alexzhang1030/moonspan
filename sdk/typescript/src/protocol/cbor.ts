/**
 * R2WP v0 deterministic CBOR subset (encode path, M0-03c slice 1).
 *
 * Fixed contract bounds from protocol/registry/r2wp-v0.json absolute_limits:
 * cbor_nesting_depth_max = 16, cbor_map_entries_max = 4096.
 *
 * Decoder lands in slice 2; head/argument helpers are shared-ready.
 */

/** Fixed v0 contract: absolute_limits.cbor_nesting_depth_max */
export const MAX_NESTING_DEPTH = 16;

/** Fixed v0 contract: absolute_limits.cbor_map_entries_max */
export const MAX_MAP_ENTRIES = 4096;

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const MIN_NINT = -(UINT64_MAX + 1n); // -2^64

export type CborValue =
  | boolean
  | null
  | number
  | bigint
  | string
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<number | bigint, CborValue>;

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

// --- Major types / simple values (shared with future decoder) ---

const MT_UINT = 0;
const MT_NINT = 1;
const MT_BYTES = 2;
const MT_TEXT = 3;
const MT_ARRAY = 4;
const MT_MAP = 5;
const MT_SIMPLE = 7;

const SIMPLE_FALSE = 20;
const SIMPLE_TRUE = 21;
const SIMPLE_NULL = 22;

/**
 * Encode a definite-length head: major type + non-negative argument (shortest form).
 * Module-private; callers must pass validated major types (0..7) and in-range arguments.
 */
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
  // 8-byte big-endian
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
      // high surrogate must be followed by low
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
  // CBOR nint argument = -1 - value
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
  // Reject non-integer numbers (floats)
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
    // 1) normalize all keys 2) reject duplicates 3) sort by encoded key 4) encode values in that order
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
