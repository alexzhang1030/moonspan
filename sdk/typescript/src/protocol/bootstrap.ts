/**
 * R2WP v0 bootstrap record codec (M0-03d slice 1).
 *
 * Normative sources:
 * - protocol/r2wp-v0.md Bootstrap framing / validation order
 * - protocol/schema/control-v0.cddl bootstrap payload shapes
 * - protocol/registry/r2wp-v0.json bootstrap layout, limits, field keys
 */

import {
  CborDecodeError,
  CborEncodeError,
  type CborValue,
  decodeDeterministicCbor,
  encodeDeterministicCbor,
} from "./cbor.ts";

/** Fixed v0 contract: bootstrap.prefix_len */
export const BOOTSTRAP_PREFIX_LENGTH = 12;

/** Fixed v0 contract: absolute_limits.bootstrap_payload_max_bytes */
export const BOOTSTRAP_PAYLOAD_MAX_BYTES = 65535;

const MAGIC = new Uint8Array([0x52, 0x32, 0x57, 0x50]); // "R2WP"
const BOOTSTRAP_VERSION = 0;
const UINT32_MAX = 0xffff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8_TEXT_MAX_BYTES = 4096;
const WIRE_VERSIONS_MAX = 16;
const CAPABILITY_IDS_MAX = 64;
const CAPABILITY_ID_MIN = 1;
const CAPABILITY_ID_MAX = 65535;

const KIND_CLIENT_HELLO = 1;
const KIND_SERVER_HELLO = 2;
const KIND_BOOTSTRAP_ERROR = 3;

const EFFECTIVE_MAX_CHANNELS = 65535;
const EFFECTIVE_MAX_SESSION_BYTES = 4294967296;
const EFFECTIVE_MAX_MESSAGE_BYTES = 67108864;
const EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES = 1048576;

const BOOTSTRAP_ERROR_CODES = new Set([1, 2, 4, 16, 24, 25]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BootstrapCodecErrorCode =
  | "malformed_bootstrap"
  | "unsupported_version"
  | "message_too_large";

export type BootstrapCodecErrorReason =
  | "wrong_input_type"
  | "truncated_prefix"
  | "bad_magic"
  | "unsupported_bootstrap_version"
  | "nonzero_flags"
  | "unassigned_kind"
  | "payload_too_large"
  | "exact_total_mismatch"
  | "cbor_profile"
  | "kind_shape_mismatch"
  | "missing_key"
  | "unknown_key"
  | "extra_key"
  | "wrong_type"
  | "range_violation"
  | "unique_violation"
  | "order_violation"
  | "text_too_long"
  | "codec_failure";

export class BootstrapCodecError extends Error {
  readonly code: BootstrapCodecErrorCode;
  readonly reason: BootstrapCodecErrorReason;
  /** Absolute offset into the full bootstrap record (prefix + payload). */
  readonly offset: number;

  constructor(
    code: BootstrapCodecErrorCode,
    reason: BootstrapCodecErrorReason,
    offset: number,
    message: string,
  ) {
    super(message);
    this.name = "BootstrapCodecError";
    this.code = code;
    this.reason = reason;
    this.offset = offset;
  }
}

function fail(
  code: BootstrapCodecErrorCode,
  reason: BootstrapCodecErrorReason,
  offset: number,
  message: string,
): never {
  throw new BootstrapCodecError(code, reason, offset, message);
}

// ---------------------------------------------------------------------------
// Semantic records (camelCase)
// ---------------------------------------------------------------------------

export type TransportCapabilities = {
  webtransportHttp3: boolean;
  binaryWss: boolean;
  maxDatagramSize?: number;
};

export type BufferCapabilities = {
  transferableArraybuffer: boolean;
  sharedArraybuffer: boolean;
};

/** ClientHello requested_limits: required map; four members each optional. */
export type RequestedLimits = {
  maxChannels?: number;
  maxSessionBytes?: number | bigint;
  maxMessageBytes?: number;
  maxControlPayloadBytes?: number;
};

/** ServerHello effective_limits: four required members with registry ceilings. */
export type EffectiveLimits = {
  maxChannels: number;
  maxSessionBytes: number | bigint;
  maxMessageBytes: number;
  maxControlPayloadBytes: number;
};

export type BootstrapErrorCode = 1 | 2 | 4 | 16 | 24 | 25;

export type ClientHelloRecord = {
  kind: "client_hello";
  wireVersions: readonly number[];
  transportCapabilities: TransportCapabilities;
  bufferCapabilities: BufferCapabilities;
  requestedLimits: RequestedLimits;
  extensionCapabilities: readonly number[];
};

export type ServerHelloRecord = {
  kind: "server_hello";
  selectedWireVersion: 0;
  transportCapabilities: TransportCapabilities;
  bufferCapabilities: BufferCapabilities;
  effectiveLimits: EffectiveLimits;
  extensionCapabilities: readonly number[];
};

export type BootstrapErrorRecord = {
  kind: "bootstrap_error";
  code: BootstrapErrorCode;
  message?: string;
  detail?: string;
};

export type BootstrapRecord =
  | ClientHelloRecord
  | ServerHelloRecord
  | BootstrapErrorRecord;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Map);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function writeU16BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function writeU32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function asCborMap(value: CborValue, offset: number): Map<number | bigint, CborValue> {
  if (!(value instanceof Map)) {
    fail("malformed_bootstrap", "wrong_type", offset, "bootstrap payload must be a CBOR map");
  }
  return value as Map<number | bigint, CborValue>;
}

function normalizeMapKeys(
  map: Map<number | bigint, CborValue>,
  offset: number,
): Map<number, CborValue> {
  const out = new Map<number, CborValue>();
  for (const [k, v] of map.entries()) {
    let n: number;
    if (typeof k === "number") {
      if (!Number.isSafeInteger(k) || k < 0) {
        fail("malformed_bootstrap", "wrong_type", offset, `invalid map key ${String(k)}`);
      }
      n = k;
    } else if (typeof k === "bigint") {
      if (k < 0n || k > MAX_SAFE) {
        fail("malformed_bootstrap", "unknown_key", offset, `map key out of supported range: ${k}`);
      }
      n = Number(k);
    } else {
      fail("malformed_bootstrap", "wrong_type", offset, "map key must be unsigned integer");
    }
    if (out.has(n)) {
      fail("malformed_bootstrap", "unique_violation", offset, `duplicate map key ${n}`);
    }
    out.set(n, v);
  }
  return out;
}

function requireExactKeys(
  map: Map<number, CborValue>,
  required: readonly number[],
  optional: readonly number[],
  offset: number,
): void {
  const allowed = new Set<number>([...required, ...optional]);
  for (const key of map.keys()) {
    if (!allowed.has(key)) {
      fail("malformed_bootstrap", "unknown_key", offset, `unknown map key ${key}`);
    }
  }
  for (const key of required) {
    if (!map.has(key)) {
      fail("malformed_bootstrap", "missing_key", offset, `missing required map key ${key}`);
    }
  }
}

function asBool(value: CborValue, offset: number, label: string): boolean {
  if (typeof value !== "boolean") {
    fail("malformed_bootstrap", "wrong_type", offset, `${label} must be boolean`);
  }
  return value;
}

function asUint(
  value: CborValue,
  offset: number,
  label: string,
  min: bigint,
  max: bigint,
): number | bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("malformed_bootstrap", "wrong_type", offset, `${label} must be an integer`);
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("malformed_bootstrap", "wrong_type", offset, `${label} must be an unsigned integer`);
  }
  if (n < min || n > max) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      offset,
      `${label} ${n} out of range ${min}..${max}`,
    );
  }
  if (n <= MAX_SAFE) return Number(n);
  return n;
}

function asUint32(value: CborValue, offset: number, label: string): number {
  return asUint(value, offset, label, 0n, BigInt(UINT32_MAX)) as number;
}

function asUint8(value: CborValue, offset: number, label: string): number {
  return asUint(value, offset, label, 0n, 255n) as number;
}

function asText(value: CborValue, offset: number, label: string): string {
  if (typeof value !== "string") {
    fail("malformed_bootstrap", "wrong_type", offset, `${label} must be text`);
  }
  const len = utf8ByteLength(value);
  if (len > UTF8_TEXT_MAX_BYTES) {
    fail(
      "malformed_bootstrap",
      "text_too_long",
      offset,
      `${label} UTF-8 length ${len} exceeds ${UTF8_TEXT_MAX_BYTES}`,
    );
  }
  return value;
}

function asArray(value: CborValue, offset: number, label: string): readonly CborValue[] {
  if (!Array.isArray(value)) {
    fail("malformed_bootstrap", "wrong_type", offset, `${label} must be an array`);
  }
  return value;
}

function decodeTransportCapabilities(
  value: CborValue,
  offset: number,
): TransportCapabilities {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1, 2], [3], offset);
  const out: TransportCapabilities = {
    webtransportHttp3: asBool(map.get(1)!, offset, "webtransport_http3"),
    binaryWss: asBool(map.get(2)!, offset, "binary_wss"),
  };
  if (map.has(3)) {
    out.maxDatagramSize = asUint32(map.get(3)!, offset, "max_datagram_size");
  }
  return out;
}

function decodeBufferCapabilities(value: CborValue, offset: number): BufferCapabilities {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1, 2], [], offset);
  return {
    transferableArraybuffer: asBool(map.get(1)!, offset, "transferable_arraybuffer"),
    sharedArraybuffer: asBool(map.get(2)!, offset, "shared_arraybuffer"),
  };
}

function decodeWireVersions(value: CborValue, offset: number): number[] {
  const arr = asArray(value, offset, "wire_versions");
  if (arr.length < 1 || arr.length > WIRE_VERSIONS_MAX) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      offset,
      `wire_versions length ${arr.length} must be 1..${WIRE_VERSIONS_MAX}`,
    );
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (const el of arr) {
    const v = asUint8(el, offset, "wire_versions element");
    if (seen.has(v)) {
      fail("malformed_bootstrap", "unique_violation", offset, `duplicate wire version ${v}`);
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

function decodeExtensionCapabilities(value: CborValue, offset: number): number[] {
  const arr = asArray(value, offset, "extension_capabilities");
  if (arr.length > CAPABILITY_IDS_MAX) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      offset,
      `extension_capabilities length ${arr.length} exceeds ${CAPABILITY_IDS_MAX}`,
    );
  }
  const out: number[] = [];
  let prev: number | undefined;
  for (const el of arr) {
    const id = asUint(el, offset, "capability id", BigInt(CAPABILITY_ID_MIN), BigInt(CAPABILITY_ID_MAX)) as number;
    if (prev !== undefined) {
      if (id === prev) {
        fail("malformed_bootstrap", "unique_violation", offset, `duplicate capability id ${id}`);
      }
      if (id < prev) {
        fail(
          "malformed_bootstrap",
          "order_violation",
          offset,
          `capability ids must be strictly ascending; ${id} follows ${prev}`,
        );
      }
    }
    prev = id;
    out.push(id);
  }
  return out;
}

function decodeRequestedLimits(value: CborValue, offset: number): RequestedLimits {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [], [1, 2, 3, 4], offset);
  const out: RequestedLimits = {};
  if (map.has(1)) out.maxChannels = asUint32(map.get(1)!, offset, "max_channels");
  if (map.has(2)) {
    out.maxSessionBytes = asUint(map.get(2)!, offset, "max_session_bytes", 0n, UINT64_MAX);
  }
  if (map.has(3)) out.maxMessageBytes = asUint32(map.get(3)!, offset, "max_message_bytes");
  if (map.has(4)) {
    out.maxControlPayloadBytes = asUint32(map.get(4)!, offset, "max_control_payload_bytes");
  }
  return out;
}

function decodeEffectiveLimits(value: CborValue, offset: number): EffectiveLimits {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1, 2, 3, 4], [], offset);
  return {
    maxChannels: asUint(map.get(1)!, offset, "max_channels", 0n, BigInt(EFFECTIVE_MAX_CHANNELS)) as number,
    maxSessionBytes: asUint(
      map.get(2)!,
      offset,
      "max_session_bytes",
      0n,
      BigInt(EFFECTIVE_MAX_SESSION_BYTES),
    ),
    maxMessageBytes: asUint(
      map.get(3)!,
      offset,
      "max_message_bytes",
      0n,
      BigInt(EFFECTIVE_MAX_MESSAGE_BYTES),
    ) as number,
    maxControlPayloadBytes: asUint(
      map.get(4)!,
      offset,
      "max_control_payload_bytes",
      0n,
      BigInt(EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES),
    ) as number,
  };
}

function decodeClientHelloPayload(value: CborValue, offset: number): ClientHelloRecord {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1, 2, 3, 4, 6], [], offset);
  return {
    kind: "client_hello",
    wireVersions: decodeWireVersions(map.get(1)!, offset),
    transportCapabilities: decodeTransportCapabilities(map.get(2)!, offset),
    bufferCapabilities: decodeBufferCapabilities(map.get(3)!, offset),
    requestedLimits: decodeRequestedLimits(map.get(4)!, offset),
    extensionCapabilities: decodeExtensionCapabilities(map.get(6)!, offset),
  };
}

function decodeServerHelloPayload(value: CborValue, offset: number): ServerHelloRecord {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1, 2, 3, 4, 6], [], offset);
  const selected = asUint8(map.get(1)!, offset, "selected_wire_version");
  if (selected !== 0) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      offset,
      `selected_wire_version must be 0 for wire version 0 contract; got ${selected}`,
    );
  }
  return {
    kind: "server_hello",
    selectedWireVersion: 0,
    transportCapabilities: decodeTransportCapabilities(map.get(2)!, offset),
    bufferCapabilities: decodeBufferCapabilities(map.get(3)!, offset),
    effectiveLimits: decodeEffectiveLimits(map.get(4)!, offset),
    extensionCapabilities: decodeExtensionCapabilities(map.get(6)!, offset),
  };
}

function decodeBootstrapErrorPayload(value: CborValue, offset: number): BootstrapErrorRecord {
  const map = normalizeMapKeys(asCborMap(value, offset), offset);
  requireExactKeys(map, [1], [2, 3], offset);
  const codeNum = asUint(map.get(1)!, offset, "bootstrap error code", 0n, 255n) as number;
  if (!BOOTSTRAP_ERROR_CODES.has(codeNum)) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      offset,
      `bootstrap error code ${codeNum} is not in {1,2,4,16,24,25}`,
    );
  }
  const out: BootstrapErrorRecord = {
    kind: "bootstrap_error",
    code: codeNum as BootstrapErrorCode,
  };
  if (map.has(2)) out.message = asText(map.get(2)!, offset, "message");
  if (map.has(3)) out.detail = asText(map.get(3)!, offset, "detail");
  return out;
}

function decodePayloadByKind(kind: number, value: CborValue, offset: number): BootstrapRecord {
  try {
    if (kind === KIND_CLIENT_HELLO) return decodeClientHelloPayload(value, offset);
    if (kind === KIND_SERVER_HELLO) return decodeServerHelloPayload(value, offset);
    if (kind === KIND_BOOTSTRAP_ERROR) return decodeBootstrapErrorPayload(value, offset);
  } catch (e) {
    if (e instanceof BootstrapCodecError) {
      // Re-tag pure shape mismatches that used structural reasons as kind_shape when needed.
      throw e;
    }
    throw e;
  }
  fail("malformed_bootstrap", "unassigned_kind", 5, `unassigned bootstrap kind ${kind}`);
}

// ---------------------------------------------------------------------------
// Encode path: semantic → CBOR map
// ---------------------------------------------------------------------------

function encodeUint32Value(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `${label} must be uint32; got ${String(value)}`,
    );
  }
  return value;
}

function encodeUint64Value(value: number | bigint, label: string): number | bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("malformed_bootstrap", "range_violation", 0, `${label} must be a non-negative safe integer or bigint`);
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("malformed_bootstrap", "wrong_type", 0, `${label} must be number or bigint`);
  }
  if (n < 0n || n > UINT64_MAX) {
    fail("malformed_bootstrap", "range_violation", 0, `${label} out of uint64 range`);
  }
  return n <= MAX_SAFE ? Number(n) : n;
}

function encodeTextValue(text: string, label: string): string {
  if (typeof text !== "string") {
    fail("malformed_bootstrap", "wrong_type", 0, `${label} must be string`);
  }
  // Reject unpaired surrogates via CBOR encoder; also enforce UTF-8 byte length.
  const len = utf8ByteLength(text);
  if (len > UTF8_TEXT_MAX_BYTES) {
    fail(
      "malformed_bootstrap",
      "text_too_long",
      0,
      `${label} UTF-8 length ${len} exceeds ${UTF8_TEXT_MAX_BYTES}`,
    );
  }
  return text;
}

function encodeTransportMap(t: TransportCapabilities): Map<number, CborValue> {
  if (!isPlainObject(t)) {
    fail("malformed_bootstrap", "wrong_type", 0, "transportCapabilities must be an object");
  }
  if (typeof t.webtransportHttp3 !== "boolean" || typeof t.binaryWss !== "boolean") {
    fail("malformed_bootstrap", "wrong_type", 0, "transport booleans required");
  }
  const m = new Map<number, CborValue>([
    [1, t.webtransportHttp3],
    [2, t.binaryWss],
  ]);
  if (t.maxDatagramSize !== undefined) {
    m.set(3, encodeUint32Value(t.maxDatagramSize, "maxDatagramSize"));
  }
  // Reject unknown own keys for exactness of nested shape on encode.
  for (const key of Object.keys(t)) {
    if (
      key !== "webtransportHttp3" &&
      key !== "binaryWss" &&
      key !== "maxDatagramSize"
    ) {
      fail("malformed_bootstrap", "extra_key", 0, `unknown transportCapabilities field ${key}`);
    }
  }
  return m;
}

function encodeBufferMap(b: BufferCapabilities): Map<number, CborValue> {
  if (!isPlainObject(b)) {
    fail("malformed_bootstrap", "wrong_type", 0, "bufferCapabilities must be an object");
  }
  if (typeof b.transferableArraybuffer !== "boolean" || typeof b.sharedArraybuffer !== "boolean") {
    fail("malformed_bootstrap", "wrong_type", 0, "buffer booleans required");
  }
  for (const key of Object.keys(b)) {
    if (key !== "transferableArraybuffer" && key !== "sharedArraybuffer") {
      fail("malformed_bootstrap", "extra_key", 0, `unknown bufferCapabilities field ${key}`);
    }
  }
  return new Map<number, CborValue>([
    [1, b.transferableArraybuffer],
    [2, b.sharedArraybuffer],
  ]);
}

function encodeWireVersions(versions: readonly number[]): number[] {
  if (!Array.isArray(versions)) {
    fail("malformed_bootstrap", "wrong_type", 0, "wireVersions must be an array");
  }
  if (versions.length < 1 || versions.length > WIRE_VERSIONS_MAX) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `wireVersions length ${versions.length} must be 1..${WIRE_VERSIONS_MAX}`,
    );
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of versions) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 255) {
      fail("malformed_bootstrap", "range_violation", 0, `wire version out of uint8 range: ${String(v)}`);
    }
    if (seen.has(v)) {
      fail("malformed_bootstrap", "unique_violation", 0, `duplicate wire version ${v}`);
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

function encodeExtensionCapabilities(caps: readonly number[]): number[] {
  if (!Array.isArray(caps)) {
    fail("malformed_bootstrap", "wrong_type", 0, "extensionCapabilities must be an array");
  }
  if (caps.length > CAPABILITY_IDS_MAX) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `extensionCapabilities length ${caps.length} exceeds ${CAPABILITY_IDS_MAX}`,
    );
  }
  const out: number[] = [];
  let prev: number | undefined;
  for (const id of caps) {
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id < CAPABILITY_ID_MIN ||
      id > CAPABILITY_ID_MAX
    ) {
      fail("malformed_bootstrap", "range_violation", 0, `capability id out of 1..65535: ${String(id)}`);
    }
    if (prev !== undefined) {
      if (id === prev) {
        fail("malformed_bootstrap", "unique_violation", 0, `duplicate capability id ${id}`);
      }
      if (id < prev) {
        fail("malformed_bootstrap", "order_violation", 0, `capability ids must be strictly ascending`);
      }
    }
    prev = id;
    out.push(id);
  }
  return out;
}

function encodeRequestedLimits(limits: RequestedLimits): Map<number, CborValue> {
  if (!isPlainObject(limits)) {
    fail("malformed_bootstrap", "wrong_type", 0, "requestedLimits must be an object");
  }
  for (const key of Object.keys(limits)) {
    if (
      key !== "maxChannels" &&
      key !== "maxSessionBytes" &&
      key !== "maxMessageBytes" &&
      key !== "maxControlPayloadBytes"
    ) {
      fail("malformed_bootstrap", "extra_key", 0, `unknown requestedLimits field ${key}`);
    }
  }
  const m = new Map<number, CborValue>();
  if (limits.maxChannels !== undefined) {
    m.set(1, encodeUint32Value(limits.maxChannels, "maxChannels"));
  }
  if (limits.maxSessionBytes !== undefined) {
    m.set(2, encodeUint64Value(limits.maxSessionBytes, "maxSessionBytes"));
  }
  if (limits.maxMessageBytes !== undefined) {
    m.set(3, encodeUint32Value(limits.maxMessageBytes, "maxMessageBytes"));
  }
  if (limits.maxControlPayloadBytes !== undefined) {
    m.set(4, encodeUint32Value(limits.maxControlPayloadBytes, "maxControlPayloadBytes"));
  }
  return m;
}

function encodeEffectiveLimits(limits: EffectiveLimits): Map<number, CborValue> {
  if (!isPlainObject(limits)) {
    fail("malformed_bootstrap", "wrong_type", 0, "effectiveLimits must be an object");
  }
  for (const key of Object.keys(limits)) {
    if (
      key !== "maxChannels" &&
      key !== "maxSessionBytes" &&
      key !== "maxMessageBytes" &&
      key !== "maxControlPayloadBytes"
    ) {
      fail("malformed_bootstrap", "extra_key", 0, `unknown effectiveLimits field ${key}`);
    }
  }
  const maxChannels = encodeUint32Value(limits.maxChannels, "maxChannels");
  if (maxChannels > EFFECTIVE_MAX_CHANNELS) {
    fail("malformed_bootstrap", "range_violation", 0, `maxChannels exceeds ceiling ${EFFECTIVE_MAX_CHANNELS}`);
  }
  const maxSessionBytes = encodeUint64Value(limits.maxSessionBytes, "maxSessionBytes");
  const sessionBig = typeof maxSessionBytes === "bigint" ? maxSessionBytes : BigInt(maxSessionBytes);
  if (sessionBig > BigInt(EFFECTIVE_MAX_SESSION_BYTES)) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `maxSessionBytes exceeds ceiling ${EFFECTIVE_MAX_SESSION_BYTES}`,
    );
  }
  const maxMessageBytes = encodeUint32Value(limits.maxMessageBytes, "maxMessageBytes");
  if (maxMessageBytes > EFFECTIVE_MAX_MESSAGE_BYTES) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `maxMessageBytes exceeds ceiling ${EFFECTIVE_MAX_MESSAGE_BYTES}`,
    );
  }
  const maxControl = encodeUint32Value(limits.maxControlPayloadBytes, "maxControlPayloadBytes");
  if (maxControl > EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `maxControlPayloadBytes exceeds ceiling ${EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES}`,
    );
  }
  return new Map<number, CborValue>([
    [1, maxChannels],
    [2, maxSessionBytes],
    [3, maxMessageBytes],
    [4, maxControl],
  ]);
}

/**
 * Closed-set check over own enumerable string keys of a top-level or nested
 * semantic object. Extra keys → extra_key; missing required → missing_key.
 */
function assertClosedOwnKeys(
  obj: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail("malformed_bootstrap", "extra_key", 0, `unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      fail("malformed_bootstrap", "missing_key", 0, `missing required field ${key}`);
    }
  }
}

const CLIENT_HELLO_KEYS = [
  "kind",
  "wireVersions",
  "transportCapabilities",
  "bufferCapabilities",
  "requestedLimits",
  "extensionCapabilities",
] as const;

const SERVER_HELLO_KEYS = [
  "kind",
  "selectedWireVersion",
  "transportCapabilities",
  "bufferCapabilities",
  "effectiveLimits",
  "extensionCapabilities",
] as const;

const BOOTSTRAP_ERROR_REQUIRED = ["kind", "code"] as const;
const BOOTSTRAP_ERROR_OPTIONAL = ["message", "detail"] as const;

function encodeClientHelloPayload(record: ClientHelloRecord): Map<number, CborValue> {
  assertClosedOwnKeys(record, CLIENT_HELLO_KEYS);
  return new Map<number, CborValue>([
    [1, encodeWireVersions(record.wireVersions)],
    [2, encodeTransportMap(record.transportCapabilities)],
    [3, encodeBufferMap(record.bufferCapabilities)],
    [4, encodeRequestedLimits(record.requestedLimits)],
    [6, encodeExtensionCapabilities(record.extensionCapabilities)],
  ]);
}

function encodeServerHelloPayload(record: ServerHelloRecord): Map<number, CborValue> {
  assertClosedOwnKeys(record, SERVER_HELLO_KEYS);
  if (record.selectedWireVersion !== 0) {
    fail("malformed_bootstrap", "range_violation", 0, "selectedWireVersion must be 0");
  }
  return new Map<number, CborValue>([
    [1, 0],
    [2, encodeTransportMap(record.transportCapabilities)],
    [3, encodeBufferMap(record.bufferCapabilities)],
    [4, encodeEffectiveLimits(record.effectiveLimits)],
    [6, encodeExtensionCapabilities(record.extensionCapabilities)],
  ]);
}

function encodeBootstrapErrorPayload(record: BootstrapErrorRecord): Map<number, CborValue> {
  assertClosedOwnKeys(record, BOOTSTRAP_ERROR_REQUIRED, BOOTSTRAP_ERROR_OPTIONAL);
  if (!BOOTSTRAP_ERROR_CODES.has(record.code)) {
    fail(
      "malformed_bootstrap",
      "range_violation",
      0,
      `bootstrap error code ${String(record.code)} is not allowed`,
    );
  }
  const m = new Map<number, CborValue>([[1, record.code]]);
  if (record.message !== undefined) m.set(2, encodeTextValue(record.message, "message"));
  if (record.detail !== undefined) m.set(3, encodeTextValue(record.detail, "detail"));
  return m;
}

function kindByte(record: BootstrapRecord): number {
  if (record.kind === "client_hello") return KIND_CLIENT_HELLO;
  if (record.kind === "server_hello") return KIND_SERVER_HELLO;
  if (record.kind === "bootstrap_error") return KIND_BOOTSTRAP_ERROR;
  fail("malformed_bootstrap", "kind_shape_mismatch", 0, `unknown record kind`);
}

function encodePayloadMap(record: BootstrapRecord): Map<number, CborValue> {
  if (record.kind === "client_hello") return encodeClientHelloPayload(record);
  if (record.kind === "server_hello") return encodeServerHelloPayload(record);
  if (record.kind === "bootstrap_error") return encodeBootstrapErrorPayload(record);
  fail("malformed_bootstrap", "kind_shape_mismatch", 0, "unknown record kind");
}

function wrapNativeOrCbor(e: unknown, payloadBase: number): never {
  if (e instanceof BootstrapCodecError) throw e;
  if (e instanceof CborDecodeError) {
    fail(
      "malformed_bootstrap",
      "cbor_profile",
      payloadBase + e.offset,
      `deterministic CBOR decode failed: ${e.reason}`,
    );
  }
  if (e instanceof CborEncodeError) {
    fail(
      "malformed_bootstrap",
      "cbor_profile",
      payloadBase,
      `deterministic CBOR encode failed: ${e.reason}`,
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  fail("malformed_bootstrap", "codec_failure", payloadBase, `bootstrap codec failure: ${msg}`);
}

/**
 * Encode a bootstrap semantic record to a new Uint8Array (12-byte prefix + CBOR).
 */
export function encodeBootstrapRecord(record: BootstrapRecord): Uint8Array {
  try {
    if (!isPlainObject(record) || typeof record.kind !== "string") {
      fail("malformed_bootstrap", "wrong_input_type", 0, "encodeBootstrapRecord requires a BootstrapRecord");
    }
    const kind = kindByte(record);
    const payloadMap = encodePayloadMap(record);
    let payload: Uint8Array;
    try {
      payload = encodeDeterministicCbor(payloadMap);
    } catch (e) {
      wrapNativeOrCbor(e, BOOTSTRAP_PREFIX_LENGTH);
    }
    if (payload.length > BOOTSTRAP_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "payload_too_large",
        8,
        `bootstrap payload length ${payload.length} exceeds ${BOOTSTRAP_PAYLOAD_MAX_BYTES}`,
      );
    }
    // checked total = 12 + payload_len (payload_len fits u32 and absolute limit)
    const total = BOOTSTRAP_PREFIX_LENGTH + payload.length;
    if (total > BOOTSTRAP_PREFIX_LENGTH + BOOTSTRAP_PAYLOAD_MAX_BYTES) {
      fail("message_too_large", "payload_too_large", 8, "bootstrap record total length overflow");
    }
    const out = new Uint8Array(total);
    out.set(MAGIC, 0);
    out[4] = BOOTSTRAP_VERSION;
    out[5] = kind;
    writeU16BE(out, 6, 0);
    writeU32BE(out, 8, payload.length);
    out.set(payload, BOOTSTRAP_PREFIX_LENGTH);
    return out;
  } catch (e) {
    if (e instanceof BootstrapCodecError) throw e;
    wrapNativeOrCbor(e, 0);
  }
}

/**
 * Decode a complete bootstrap record. Atomic whole-value return.
 * Validation order matches protocol/registry validation_order.bootstrap steps 1–9.
 * (Steps 10–11 are session-state checks outside this codec.)
 */
export function decodeBootstrapRecord(bytes: Uint8Array): BootstrapRecord {
  try {
    if (!(bytes instanceof Uint8Array)) {
      fail(
        "malformed_bootstrap",
        "wrong_input_type",
        0,
        "decodeBootstrapRecord requires a Uint8Array",
      );
    }

    // 1. minimum length 12
    if (bytes.length < BOOTSTRAP_PREFIX_LENGTH) {
      fail(
        "malformed_bootstrap",
        "truncated_prefix",
        0,
        `bootstrap record shorter than ${BOOTSTRAP_PREFIX_LENGTH} bytes`,
      );
    }

    // 2. magic R2WP
    if (
      bytes[0] !== MAGIC[0] ||
      bytes[1] !== MAGIC[1] ||
      bytes[2] !== MAGIC[2] ||
      bytes[3] !== MAGIC[3]
    ) {
      fail("malformed_bootstrap", "bad_magic", 0, "bootstrap magic must be ASCII R2WP");
    }

    // 3. bootstrap_version 0
    if (bytes[4] !== BOOTSTRAP_VERSION) {
      fail(
        "unsupported_version",
        "unsupported_bootstrap_version",
        4,
        `bootstrap_version ${bytes[4]} is not supported; expected 0`,
      );
    }

    // 4. flags zero
    const flags = readU16BE(bytes, 6);
    if (flags !== 0) {
      fail("malformed_bootstrap", "nonzero_flags", 6, `bootstrap flags must be 0; got ${flags}`);
    }

    // 5. kind assigned
    const kind = bytes[5]!;
    if (kind !== KIND_CLIENT_HELLO && kind !== KIND_SERVER_HELLO && kind !== KIND_BOOTSTRAP_ERROR) {
      fail("malformed_bootstrap", "unassigned_kind", 5, `unassigned bootstrap kind ${kind}`);
    }

    // 6. payload_len absolute limit
    const payloadLen = readU32BE(bytes, 8);
    if (payloadLen > BOOTSTRAP_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "payload_too_large",
        8,
        `payload_len ${payloadLen} exceeds ${BOOTSTRAP_PAYLOAD_MAX_BYTES}`,
      );
    }

    // 7. exact total length 12 + payload_len (checked addition)
    const expectedTotal = BOOTSTRAP_PREFIX_LENGTH + payloadLen;
    if (expectedTotal < BOOTSTRAP_PREFIX_LENGTH) {
      // unreachable for u32 payloadLen but keep checked arithmetic posture
      fail("malformed_bootstrap", "exact_total_mismatch", 0, "payload length addition overflow");
    }
    if (bytes.length !== expectedTotal) {
      fail(
        "malformed_bootstrap",
        "exact_total_mismatch",
        0,
        `record length ${bytes.length} != 12 + payload_len ${payloadLen}`,
      );
    }

    // Copy payload so CBOR decode cannot expose input buffer aliasing.
    const payload = bytes.slice(BOOTSTRAP_PREFIX_LENGTH, expectedTotal);

    // 8. deterministic CBOR profile
    let cborValue: CborValue;
    try {
      cborValue = decodeDeterministicCbor(payload);
    } catch (e) {
      wrapNativeOrCbor(e, BOOTSTRAP_PREFIX_LENGTH);
    }

    // 9. CDDL / kind shape match
    return decodePayloadByKind(kind, cborValue, BOOTSTRAP_PREFIX_LENGTH);
  } catch (e) {
    if (e instanceof BootstrapCodecError) throw e;
    wrapNativeOrCbor(e, 0);
  }
}
