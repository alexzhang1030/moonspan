/**
 * R2WP v0 extension area / TLV codec (M0-03d slice 2).
 *
 * Normative sources:
 * - protocol/r2wp-v0.md Extension TLVs; selected-frame validation steps 13–14
 *   (step 3 area bound; TRACE consistency step 15 is frame-level, not here)
 * - protocol/registry/r2wp-v0.json extensions + absolute_limits.extension_area_max_bytes
 */

/** Fixed v0 contract: absolute_limits.extension_area_max_bytes */
export const EXTENSION_AREA_MAX_BYTES = 4096;

/** Fixed v0 contract: extensions.alignment */
export const EXTENSION_ALIGNMENT = 4;

/** Assigned extension type: TRACE_CONTEXT (registry extensions.types.assigned.1). */
export const TRACE_CONTEXT_EXTENSION_TYPE = 1;

/** Assigned extension type: OPERATION_ID (registry extensions.types.assigned.2). */
export const OPERATION_ID_EXTENSION_TYPE = 2;

/** Fixed value_len for TRACE_CONTEXT. */
export const TRACE_CONTEXT_VALUE_LENGTH = 32;

/** Fixed value_len for OPERATION_ID. */
export const OPERATION_ID_VALUE_LENGTH = 16;

const TLV_HEADER_LEN = 4;
const FLAG_CRITICAL = 0x01;
const FLAG_RESERVED_MASK = 0xfe;
const TRACE_RESERVED_OFFSET = 25;
const TRACE_RESERVED_SIZE = 7;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ExtensionCodecErrorCode =
  | "malformed_frame"
  | "unsupported_extension"
  | "message_too_large";

export type ExtensionCodecErrorReason =
  | "wrong_input_type"
  | "area_too_large"
  | "area_alignment"
  | "truncated_header"
  | "truncated_value"
  | "truncated_padding"
  | "nonzero_padding"
  | "reserved_flag_bits"
  | "order_violation"
  | "duplicate_type"
  | "fixed_length_mismatch"
  | "reserved_nonzero"
  | "unknown_critical"
  | "extra_key"
  | "missing_key"
  | "wrong_type"
  | "range_violation"
  | "codec_failure";

export class ExtensionCodecError extends Error {
  readonly code: ExtensionCodecErrorCode;
  readonly reason: ExtensionCodecErrorReason;
  /** Offset relative to the start of the extension area. */
  readonly offset: number;

  constructor(
    code: ExtensionCodecErrorCode,
    reason: ExtensionCodecErrorReason,
    offset: number,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionCodecError";
    this.code = code;
    this.reason = reason;
    this.offset = offset;
  }
}

function fail(
  code: ExtensionCodecErrorCode,
  reason: ExtensionCodecErrorReason,
  offset: number,
  message: string,
): never {
  throw new ExtensionCodecError(code, reason, offset, message);
}

function wrapNative(e: unknown, offset: number): never {
  if (e instanceof ExtensionCodecError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  fail("malformed_frame", "codec_failure", offset, `extension codec failure: ${msg}`);
}

// ---------------------------------------------------------------------------
// Semantic record
// ---------------------------------------------------------------------------

/**
 * Raw extension semantic record.
 * Encoder may include unknown types for outbound experimental/reserved TLVs.
 * Decoder returns only assigned types 1 (TRACE_CONTEXT) and 2 (OPERATION_ID);
 * unknown noncritical TLVs are skipped after structural validation.
 */
export type R2wpExtension = {
  type: number;
  critical: boolean;
  value: Uint8Array;
};

const EXTENSION_KEYS = ["type", "critical", "value"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Uint8Array)
  );
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function writeU16BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function isAssignedType(type: number): boolean {
  return type === TRACE_CONTEXT_EXTENSION_TYPE || type === OPERATION_ID_EXTENSION_TYPE;
}

function fixedValueLen(type: number): number | undefined {
  if (type === TRACE_CONTEXT_EXTENSION_TYPE) return TRACE_CONTEXT_VALUE_LENGTH;
  if (type === OPERATION_ID_EXTENSION_TYPE) return OPERATION_ID_VALUE_LENGTH;
  return undefined;
}

function assertClosedOwnKeys(obj: object, required: readonly string[]): void {
  const allowed = new Set(required);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail("malformed_frame", "extra_key", 0, `unknown extension field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      fail("malformed_frame", "missing_key", 0, `missing required extension field ${key}`);
    }
  }
}

function assertTraceReservedZero(value: Uint8Array, baseOffset: number): void {
  for (let i = 0; i < TRACE_RESERVED_SIZE; i++) {
    const b = value[TRACE_RESERVED_OFFSET + i]!;
    if (b !== 0) {
      fail(
        "malformed_frame",
        "reserved_nonzero",
        baseOffset + TRACE_RESERVED_OFFSET + i,
        `TRACE_CONTEXT reserved byte at +${TRACE_RESERVED_OFFSET + i} must be 0`,
      );
    }
  }
}

function validateAssignedValue(
  type: number,
  value: Uint8Array,
  valueOffset: number,
): void {
  const expected = fixedValueLen(type);
  if (expected === undefined) return;
  if (value.length !== expected) {
    fail(
      "malformed_frame",
      "fixed_length_mismatch",
      valueOffset,
      `extension type ${type} value_len must be ${expected}; got ${value.length}`,
    );
  }
  if (type === TRACE_CONTEXT_EXTENSION_TYPE) {
    assertTraceReservedZero(value, valueOffset);
  }
}

function tlvPaddedSize(valueLen: number): number {
  // checked: header + value, then align
  if (!Number.isSafeInteger(valueLen) || valueLen < 0 || valueLen > 0xffff) {
    fail("malformed_frame", "range_violation", 0, `value_len out of u16 range: ${valueLen}`);
  }
  const content = TLV_HEADER_LEN + valueLen;
  if (content > Number.MAX_SAFE_INTEGER - 3) {
    fail("malformed_frame", "range_violation", 0, "TLV size arithmetic overflow");
  }
  return align4(content);
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function normalizeExtension(raw: unknown, index: number): R2wpExtension {
  if (!isPlainObject(raw)) {
    fail(
      "malformed_frame",
      "wrong_type",
      0,
      `extensions[${index}] must be a plain object`,
    );
  }
  assertClosedOwnKeys(raw, EXTENSION_KEYS);

  const type = raw.type;
  if (typeof type !== "number" || !Number.isSafeInteger(type) || type < 0 || type > 255) {
    fail(
      "malformed_frame",
      "range_violation",
      0,
      `extensions[${index}].type must be uint8`,
    );
  }
  if (typeof raw.critical !== "boolean") {
    fail(
      "malformed_frame",
      "wrong_type",
      0,
      `extensions[${index}].critical must be boolean`,
    );
  }
  if (!(raw.value instanceof Uint8Array)) {
    fail(
      "malformed_frame",
      "wrong_type",
      0,
      `extensions[${index}].value must be Uint8Array`,
    );
  }
  if (raw.value.length > 0xffff) {
    fail(
      "malformed_frame",
      "range_violation",
      0,
      `extensions[${index}].value exceeds u16 value_len`,
    );
  }

  validateAssignedValue(type, raw.value, 0);

  return {
    type,
    critical: raw.critical,
    value: raw.value,
  };
}

/**
 * Encode extension TLVs into a new extension-area buffer.
 * Canonical order is strictly ascending numeric type; duplicates rejected.
 * Unknown types are allowed for outbound experimental/reserved TLVs.
 */
export function encodeExtensionArea(extensions: readonly R2wpExtension[]): Uint8Array {
  try {
    if (!Array.isArray(extensions)) {
      fail(
        "malformed_frame",
        "wrong_input_type",
        0,
        "encodeExtensionArea requires an array of R2wpExtension",
      );
    }

    const normalized: R2wpExtension[] = [];
    for (let i = 0; i < extensions.length; i++) {
      normalized.push(normalizeExtension(extensions[i], i));
    }

    // Canonical sort by numeric type (stable for equal is unnecessary: duplicates fail).
    const sorted = normalized.slice().sort((a, b) => a.type - b.type);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.type === sorted[i - 1]!.type) {
        fail(
          "malformed_frame",
          "duplicate_type",
          0,
          `duplicate extension type ${sorted[i]!.type}`,
        );
      }
    }

    let total = 0;
    const sizes: number[] = [];
    for (const ext of sorted) {
      const padded = tlvPaddedSize(ext.value.length);
      if (total > EXTENSION_AREA_MAX_BYTES - padded) {
        fail(
          "message_too_large",
          "area_too_large",
          0,
          `extension area would exceed ${EXTENSION_AREA_MAX_BYTES} bytes`,
        );
      }
      total += padded;
      sizes.push(padded);
    }

    if (total > EXTENSION_AREA_MAX_BYTES) {
      fail(
        "message_too_large",
        "area_too_large",
        0,
        `extension area length ${total} exceeds ${EXTENSION_AREA_MAX_BYTES}`,
      );
    }
    if (total % EXTENSION_ALIGNMENT !== 0) {
      // Defensive: per-TLV padding keeps the area aligned.
      fail("malformed_frame", "area_alignment", 0, "encoded extension area is not 4-byte aligned");
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < sorted.length; i++) {
      const ext = sorted[i]!;
      const valueLen = ext.value.length;
      out[offset] = ext.type;
      out[offset + 1] = ext.critical ? FLAG_CRITICAL : 0;
      writeU16BE(out, offset + 2, valueLen);
      out.set(ext.value, offset + TLV_HEADER_LEN);
      // remaining bytes in padded region are already 0
      offset += sizes[i]!;
    }
    return out;
  } catch (e) {
    if (e instanceof ExtensionCodecError) throw e;
    wrapNative(e, 0);
  }
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

type ParsedTlv = {
  type: number;
  critical: boolean;
  value: Uint8Array;
  assigned: boolean;
};

/**
 * Decode a complete extension area.
 *
 * Validation order for this surface:
 * 1. area length ≤ 4096 (message_too_large) and multiple of 4
 * 2. structural TLV walk (step 13): bounds, zero padding, flags, fixed lengths,
 *    reserved zeros for TRACE_CONTEXT, strictly ascending types, no duplicates
 * 3. unknown critical (step 14) only after the full structural pass succeeds
 *
 * Returns only assigned types 1 and 2; unknown noncritical TLVs are skipped.
 * All returned value buffers are copies.
 */
export function decodeExtensionArea(bytes: Uint8Array): R2wpExtension[] {
  try {
    if (!(bytes instanceof Uint8Array)) {
      fail(
        "malformed_frame",
        "wrong_input_type",
        0,
        "decodeExtensionArea requires a Uint8Array",
      );
    }

    const len = bytes.length;
    if (len > EXTENSION_AREA_MAX_BYTES) {
      fail(
        "message_too_large",
        "area_too_large",
        0,
        `extension area length ${len} exceeds ${EXTENSION_AREA_MAX_BYTES}`,
      );
    }
    if (len % EXTENSION_ALIGNMENT !== 0) {
      fail(
        "malformed_frame",
        "area_alignment",
        0,
        `extension area length ${len} is not a multiple of ${EXTENSION_ALIGNMENT}`,
      );
    }

    const parsed: ParsedTlv[] = [];
    let offset = 0;
    let prevType: number | undefined;
    // Collect first unknown-critical after full structural success.
    let firstUnknownCriticalOffset: number | undefined;

    while (offset < len) {
      const remaining = len - offset;
      if (remaining < TLV_HEADER_LEN) {
        fail(
          "malformed_frame",
          "truncated_header",
          offset,
          `need ${TLV_HEADER_LEN} header bytes, have ${remaining}`,
        );
      }

      const type = bytes[offset]!;
      const flags = bytes[offset + 1]!;
      const valueLen = readU16BE(bytes, offset + 2);

      if ((flags & FLAG_RESERVED_MASK) !== 0) {
        fail(
          "malformed_frame",
          "reserved_flag_bits",
          offset + 1,
          `extension flags reserved bits must be 0; got 0x${flags.toString(16)}`,
        );
      }
      const critical = (flags & FLAG_CRITICAL) !== 0;
      const assigned = isAssignedType(type);

      // Assigned fixed value_len is structural and checked before bounds/padding
      // so a wrong declared length is fixed_length_mismatch, not a padding artifact.
      const expectedLen = fixedValueLen(type);
      if (expectedLen !== undefined && valueLen !== expectedLen) {
        fail(
          "malformed_frame",
          "fixed_length_mismatch",
          offset + 2,
          `extension type ${type} value_len must be ${expectedLen}; got ${valueLen}`,
        );
      }

      // checked content end
      const contentLen = TLV_HEADER_LEN + valueLen;
      if (contentLen < TLV_HEADER_LEN || offset > len - contentLen) {
        fail(
          "malformed_frame",
          "truncated_value",
          offset + TLV_HEADER_LEN,
          `TLV type ${type} value truncated: need ${valueLen} bytes`,
        );
      }

      const padded = align4(contentLen);
      if (offset > len - padded) {
        fail(
          "malformed_frame",
          "truncated_padding",
          offset + contentLen,
          `TLV type ${type} padding truncated`,
        );
      }

      // zero padding
      for (let p = contentLen; p < padded; p++) {
        if (bytes[offset + p] !== 0) {
          fail(
            "malformed_frame",
            "nonzero_padding",
            offset + p,
            `TLV type ${type} padding byte must be 0`,
          );
        }
      }

      const valueOffset = offset + TLV_HEADER_LEN;
      // Copy value so callers cannot mutate the input area.
      const value = bytes.slice(valueOffset, valueOffset + valueLen);

      if (assigned) {
        // Reserved zeros and any remaining assigned-value rules (length already checked).
        if (type === TRACE_CONTEXT_EXTENSION_TYPE) {
          assertTraceReservedZero(value, valueOffset);
        }
      }

      if (prevType !== undefined) {
        if (type === prevType) {
          fail(
            "malformed_frame",
            "duplicate_type",
            offset,
            `duplicate extension type ${type}`,
          );
        }
        if (type < prevType) {
          fail(
            "malformed_frame",
            "order_violation",
            offset,
            `extension types must be strictly ascending; ${type} follows ${prevType}`,
          );
        }
      }
      prevType = type;

      if (!assigned && critical && firstUnknownCriticalOffset === undefined) {
        firstUnknownCriticalOffset = offset;
      }

      parsed.push({
        type,
        critical,
        value,
        assigned,
      });

      offset += padded;
    }

    // Step 14: unknown critical only after full structural validation.
    if (firstUnknownCriticalOffset !== undefined) {
      fail(
        "unsupported_extension",
        "unknown_critical",
        firstUnknownCriticalOffset,
        "unknown critical extension type",
      );
    }

    // Return assigned types only (unknown noncritical already structurally validated).
    const out: R2wpExtension[] = [];
    for (const tlv of parsed) {
      if (!tlv.assigned) continue;
      out.push({
        type: tlv.type,
        critical: tlv.critical,
        value: new Uint8Array(tlv.value), // defensive second copy ownership
      });
    }
    return out;
  } catch (e) {
    if (e instanceof ExtensionCodecError) throw e;
    wrapNative(e, 0);
  }
}
