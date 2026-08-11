/**
 * R2WP v0 CONTROL_CBOR codec + static CDDL shape validation (M0-03d slice 3).
 *
 * Normative sources:
 * - protocol/schema/control-v0.cddl control-message and recursive dependencies
 * - protocol/registry/r2wp-v0.json control_kinds, control_field_keys, enums,
 *   collection_rules, schema_identity_schemes, absolute_limits
 * - protocol/r2wp-v0.md control plane; selected-frame validation step 16
 *
 * Bootstrap payloads are owned by bootstrap.ts. This module accepts only the
 * 15 assigned control-message kinds. Stateful/direction/generation/Error-scope
 * context checks belong to later frame validation steps.
 */

import {
  CborDecodeError,
  CborEncodeError,
  type CborValue,
  decodeDeterministicCbor,
  encodeDeterministicCbor,
} from "./cbor.ts";

/** Fixed v0 contract: absolute_limits.control_payload_max_bytes */
export const CONTROL_PAYLOAD_MAX_BYTES = 1048576;

// Assigned control kinds (registry control_kinds.assigned)
export const CONTROL_KIND_AUTHENTICATE = 1;
export const CONTROL_KIND_SESSION_READY = 2;
export const CONTROL_KIND_GRAPH_SNAPSHOT = 3;
export const CONTROL_KIND_GRAPH_DELTA = 4;
export const CONTROL_KIND_SCHEMA_REQUEST = 5;
export const CONTROL_KIND_SCHEMA_ADVERTISE = 6;
export const CONTROL_KIND_SCHEMA_RESPONSE = 7;
export const CONTROL_KIND_OPEN_CHANNEL = 8;
export const CONTROL_KIND_CHANNEL_READY = 9;
export const CONTROL_KIND_CLOSE_CHANNEL = 10;
export const CONTROL_KIND_CLOCK_SYNC = 11;
export const CONTROL_KIND_HEARTBEAT = 12;
export const CONTROL_KIND_SESSION_RESUME = 13;
export const CONTROL_KIND_SESSION_RESUME_RESULT = 14;
export const CONTROL_KIND_ERROR = 15;

/** Frozen kind id → name map for the 15 assigned control kinds. */
export const CONTROL_KINDS = {
  [CONTROL_KIND_AUTHENTICATE]: "Authenticate",
  [CONTROL_KIND_SESSION_READY]: "SessionReady",
  [CONTROL_KIND_GRAPH_SNAPSHOT]: "GraphSnapshot",
  [CONTROL_KIND_GRAPH_DELTA]: "GraphDelta",
  [CONTROL_KIND_SCHEMA_REQUEST]: "SchemaRequest",
  [CONTROL_KIND_SCHEMA_ADVERTISE]: "SchemaAdvertise",
  [CONTROL_KIND_SCHEMA_RESPONSE]: "SchemaResponse",
  [CONTROL_KIND_OPEN_CHANNEL]: "OpenChannel",
  [CONTROL_KIND_CHANNEL_READY]: "ChannelReady",
  [CONTROL_KIND_CLOSE_CHANNEL]: "CloseChannel",
  [CONTROL_KIND_CLOCK_SYNC]: "ClockSync",
  [CONTROL_KIND_HEARTBEAT]: "Heartbeat",
  [CONTROL_KIND_SESSION_RESUME]: "SessionResume",
  [CONTROL_KIND_SESSION_RESUME_RESULT]: "SessionResumeResult",
  [CONTROL_KIND_ERROR]: "Error",
} as const;

export type ControlKindId = keyof typeof CONTROL_KINDS;

/** Raw uint-key semantic map (language-neutral CONTROL_CBOR value). */
export type ControlMessage = Map<number | bigint, CborValue>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ControlCodecErrorReason =
  | "wrong_input_type"
  | "payload_too_large"
  | "cbor_profile"
  | "wrong_type"
  | "missing_key"
  | "unknown_key"
  | "range_violation"
  | "enum_violation"
  | "unique_violation"
  | "order_violation"
  | "array_bound"
  | "text_length"
  | "bytes_length"
  | "schema_identity"
  | "support_row_mismatch"
  | "unassigned_kind"
  | "union_mismatch"
  | "codec_failure";

export class ControlCodecError extends Error {
  readonly code = "invalid_control" as const;
  readonly reason: ControlCodecErrorReason;
  /** Payload-relative byte offset (0 for pure shape failures). */
  readonly offset: number;
  /** Semantic path, e.g. "/1" or "/22/0/55". */
  readonly path: string;

  constructor(
    reason: ControlCodecErrorReason,
    offset: number,
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlCodecError";
    this.reason = reason;
    this.offset = offset;
    this.path = path;
  }
}

function fail(
  reason: ControlCodecErrorReason,
  path: string,
  message: string,
  offset = 0,
): never {
  throw new ControlCodecError(reason, offset, path, message);
}

function wrapNative(e: unknown, offset: number, path: string): never {
  if (e instanceof ControlCodecError) throw e;
  if (e instanceof CborDecodeError) {
    fail("cbor_profile", path, `deterministic CBOR decode failed: ${e.reason}`, offset + e.offset);
  }
  if (e instanceof CborEncodeError) {
    fail("cbor_profile", path, `deterministic CBOR encode failed: ${e.reason}`, offset);
  }
  const msg = e instanceof Error ? e.message : String(e);
  fail("codec_failure", path, `control codec failure: ${msg}`, offset);
}

// ---------------------------------------------------------------------------
// Limits / atoms
// ---------------------------------------------------------------------------

const UINT32_MAX = 0xffff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const INT64_MIN = -0x8000_0000_0000_0000n;
const INT64_MAX = 0x7fff_ffff_ffff_ffffn;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8_TEXT_MAX = 4096;
const DOMAIN_ID_MAX = 232;
const DOMAIN_IDS_MAX = 233;
const CAP_ID_MAX = 65535;
const CAP_IDS_MAX = 64;
const GRAPH_NODES_MAX = 65535;
const GRAPH_ENDPOINTS_MAX = 65535;
const GRAPH_DELTA_OPS_MAX = 1024;
const SOURCE_BUNDLE_MAX = 4096;
const ALIVE_CHANNELS_MAX = 65535;
const CHANNEL_ACKS_MAX = 65535;
const CHANNEL_RESULTS_MAX = 65535;
const CRED_MAX = 65535;
const DESC_MAX = 1048576;
const CONTENT_MAX = 1048576;

const LOWER_HEX = /^[0-9a-f]+$/;

// ---------------------------------------------------------------------------
// Deep copy / map helpers
// ---------------------------------------------------------------------------

function deepCopyValue(value: CborValue): CborValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepCopyValue(v as CborValue));
  }
  if (value instanceof Map) {
    const out = new Map<number | bigint, CborValue>();
    for (const [k, v] of value.entries()) {
      out.set(k as number | bigint, deepCopyValue(v as CborValue));
    }
    return out;
  }
  return value;
}

function asMap(value: CborValue, path: string): Map<number | bigint, CborValue> {
  if (!(value instanceof Map)) {
    fail("wrong_type", path, "expected CBOR map");
  }
  return value as Map<number | bigint, CborValue>;
}

function normalizeKey(key: number | bigint, path: string): number {
  if (typeof key === "number") {
    if (!Number.isSafeInteger(key) || key < 0) {
      fail("wrong_type", path, `map key must be unsigned integer; got ${key}`);
    }
    return key;
  }
  if (typeof key === "bigint") {
    if (key < 0n || key > MAX_SAFE) {
      fail("range_violation", path, `map key out of supported range: ${key}`);
    }
    return Number(key);
  }
  fail("wrong_type", path, "map key must be number or bigint");
}

function mapToNumberKeys(
  map: Map<number | bigint, CborValue>,
  path: string,
): Map<number, CborValue> {
  const out = new Map<number, CborValue>();
  for (const [k, v] of map.entries()) {
    const n = normalizeKey(k, path);
    if (out.has(n)) {
      fail("unique_violation", path, `duplicate map key ${n}`);
    }
    out.set(n, v);
  }
  return out;
}

function utf8Len(text: string): number {
  return new TextEncoder().encode(text).length;
}

function asUint(
  value: CborValue,
  path: string,
  min: bigint,
  max: bigint,
): number | bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("wrong_type", path, "expected integer");
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("wrong_type", path, "expected unsigned integer");
  }
  if (n < min || n > max) {
    fail("range_violation", path, `integer ${n} out of range ${min}..${max}`);
  }
  return n <= MAX_SAFE ? Number(n) : n;
}

function asInt64(value: CborValue, path: string): number | bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("wrong_type", path, "expected integer");
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("wrong_type", path, "expected integer");
  }
  if (n < INT64_MIN || n > INT64_MAX) {
    fail("range_violation", path, `int64 out of range: ${n}`);
  }
  return n <= MAX_SAFE && n >= -MAX_SAFE ? Number(n) : n;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Declarative schema engine
// ---------------------------------------------------------------------------

type FieldSpec = { required: boolean; schema: Schema };

type Schema =
  | { t: "bool" }
  | { t: "uint"; min: bigint; max: bigint }
  | { t: "int64" }
  | { t: "text"; minBytes: number; maxBytes: number; oneOf?: readonly string[] }
  | { t: "bytes"; min: number; max: number }
  | { t: "const"; value: number | boolean | string }
  | { t: "array"; min: number; max: number; items: Schema; rule?: ArrayRule }
  | { t: "map"; fields: ReadonlyMap<number, FieldSpec> }
  | { t: "union"; variants: readonly Schema[] }
  | { t: "schema_identity" }
  | { t: "qos" }
  | { t: "effective_qos" }
  | { t: "effective_service_qos" }
  | { t: "action_qos" }
  | { t: "effective_action_qos" };

type ArrayRule =
  | "unique_ascending_uint"
  | "unique_ascending_bytes"
  | "unique_ascending_channel_id" // map elements with key 1 = channel id
  | "graph_nodes_sorted"
  | "graph_endpoints_sorted";

function field(required: boolean, schema: Schema): FieldSpec {
  return { required, schema };
}

function req(schema: Schema): FieldSpec {
  return field(true, schema);
}

function opt(schema: Schema): FieldSpec {
  return field(false, schema);
}

function mapOf(entries: Array<[number, FieldSpec]>): Schema {
  return { t: "map", fields: new Map(entries) };
}

function unionOf(...variants: Schema[]): Schema {
  return { t: "union", variants };
}

function u(min: number | bigint, max: number | bigint): Schema {
  return { t: "uint", min: BigInt(min), max: BigInt(max) };
}

function text(minBytes: number, maxBytes: number, oneOf?: readonly string[]): Schema {
  return { t: "text", minBytes, maxBytes, oneOf };
}

function bytes(min: number, max: number): Schema {
  return { t: "bytes", min, max };
}

function arr(min: number, max: number, items: Schema, rule?: ArrayRule): Schema {
  return { t: "array", min, max, items, rule };
}

function c(value: number | boolean | string): Schema {
  return { t: "const", value };
}

// Atom aliases matching CDDL
const uint32 = u(0, UINT32_MAX);
const uint64 = u(0n, UINT64_MAX);
const appChannelId = u(1, UINT32_MAX);
const domainId = u(0, DOMAIN_ID_MAX);
const capabilityId = u(1, CAP_ID_MAX);
const text4k = text(0, UTF8_TEXT_MAX);
const textNonempty = text(1, UTF8_TEXT_MAX);
const bytes16 = bytes(16, 16);
const bytes32 = bytes(32, 32);
const bytesCred = bytes(1, CRED_MAX);
const bytesDesc = bytes(1, DESC_MAX);
const bytesContent = bytes(0, CONTENT_MAX);
const wireErrorCode = u(1, 28); // narrowed in validator to exclude 20
const retryClass = u(0, 3);
const closeReason = u(1, 6);
const priorityId = u(0, 4);
const clockId = u(0, 4);
const positiveDepth = u(1, UINT32_MAX);
const supportRowId = text(1, UTF8_TEXT_MAX, [
  "H-FT",
  "H-CY",
  "H-ZN",
  "J-FT",
  "J-CY",
  "J-ZN",
]);
const rosDistro = text(1, UTF8_TEXT_MAX, ["humble", "jazzy"]);
const rmwIdentifier = text(1, UTF8_TEXT_MAX, [
  "rmw_fastrtps_cpp",
  "rmw_cyclonedds_cpp",
  "rmw_zenoh_cpp",
]);
const payloadEncodingCdr = u(1, 2);
const sourceEntryEncoding = u(1, 5);
const reliability = u(0, 2);
const durability = u(0, 2);
const liveliness = u(0, 2);

function validateSchema(value: CborValue, schema: Schema, path: string): CborValue {
  switch (schema.t) {
    case "bool": {
      if (typeof value !== "boolean") fail("wrong_type", path, "expected boolean");
      return value;
    }
    case "const": {
      if (value !== schema.value) {
        fail("enum_violation", path, `expected constant ${String(schema.value)}; got ${String(value)}`);
      }
      return value;
    }
    case "uint": {
      const n = asUint(value, path, schema.min, schema.max);
      // wire-error-code excludes 20 (adapter_profile_mismatch is out-of-band only)
      if (schema === wireErrorCode && Number(n) === 20) {
        fail("enum_violation", path, "wire-error-code excludes 20 (adapter_profile_mismatch)");
      }
      return n;
    }
    case "int64":
      return asInt64(value, path);
    case "text": {
      if (typeof value !== "string") fail("wrong_type", path, "expected text");
      const len = utf8Len(value);
      if (len < schema.minBytes || len > schema.maxBytes) {
        fail("text_length", path, `text UTF-8 length ${len} not in ${schema.minBytes}..${schema.maxBytes}`);
      }
      if (schema.oneOf && !schema.oneOf.includes(value)) {
        fail("enum_violation", path, `text not in allowed set: ${value}`);
      }
      return value;
    }
    case "bytes": {
      if (!(value instanceof Uint8Array)) fail("wrong_type", path, "expected bstr");
      if (value.length < schema.min || value.length > schema.max) {
        fail(
          "bytes_length",
          path,
          `bstr length ${value.length} not in ${schema.min}..${schema.max}`,
        );
      }
      return new Uint8Array(value);
    }
    case "array": {
      if (!Array.isArray(value)) fail("wrong_type", path, "expected array");
      if (value.length < schema.min || value.length > schema.max) {
        fail(
          "array_bound",
          path,
          `array length ${value.length} not in ${schema.min}..${schema.max}`,
        );
      }
      const out: CborValue[] = [];
      for (let i = 0; i < value.length; i++) {
        out.push(validateSchema(value[i] as CborValue, schema.items, `${path}/${i}`));
      }
      applyArrayRule(out, schema.rule, path);
      return out;
    }
    case "map":
      return validateMap(value, schema.fields, path);
    case "union": {
      let last: ControlCodecError | undefined;
      for (const variant of schema.variants) {
        try {
          return validateSchema(value, variant, path);
        } catch (e) {
          if (e instanceof ControlCodecError) last = e;
          else throw e;
        }
      }
      if (last) throw last;
      fail("union_mismatch", path, "value matched no union variant");
    }
    case "schema_identity":
      return validateSchemaIdentity(value, path);
    case "qos":
      return validateQosDiscriminated(value, path);
    case "effective_qos":
      return validateEffectiveQosDiscriminated(value, path);
    case "effective_service_qos":
      return validateEffectiveServiceQosDiscriminated(value, path);
    case "action_qos":
      return validateSchema(value, ACTION_QOS_SCHEMA, path);
    case "effective_action_qos":
      return validateSchema(value, EFFECTIVE_ACTION_QOS_SCHEMA, path);
    default: {
      const _exhaustive: never = schema;
      fail("codec_failure", path, `unknown schema ${( _exhaustive as Schema).t}`);
    }
  }
}

function validateMap(
  value: CborValue,
  fields: ReadonlyMap<number, FieldSpec>,
  path: string,
): Map<number, CborValue> {
  const raw = mapToNumberKeys(asMap(value, path), path);
  for (const key of raw.keys()) {
    if (!fields.has(key)) {
      fail("unknown_key", `${path}/${key}`, `unknown map key ${key}`);
    }
  }
  const out = new Map<number, CborValue>();
  for (const [key, spec] of fields.entries()) {
    if (!raw.has(key)) {
      if (spec.required) fail("missing_key", `${path}/${key}`, `missing required key ${key}`);
      continue;
    }
    out.set(key, validateSchema(raw.get(key)!, spec.schema, `${path}/${key}`));
  }
  return out;
}

function historyKind(value: CborValue, path: string): number {
  const raw = mapToNumberKeys(asMap(value, path), path);
  if (!raw.has(3)) fail("missing_key", `${path}/3`, "missing history kind key 3");
  const h = asUint(raw.get(3)!, `${path}/3`, 0n, 2n);
  return Number(h);
}

function validateQosDiscriminated(value: CborValue, path: string): CborValue {
  const h = historyKind(value, path);
  if (h === 1) return validateSchema(value, QOS_KEEP_LAST, path);
  if (h === 0 || h === 2) return validateSchema(value, QOS_NO_DEPTH, path);
  fail("enum_violation", `${path}/3`, `invalid history kind ${h}`);
}

function validateEffectiveQosDiscriminated(value: CborValue, path: string): CborValue {
  const h = historyKind(value, path);
  if (h === 1) return validateSchema(value, EFFECTIVE_QOS_KEEP_LAST, path);
  if (h === 2) return validateSchema(value, EFFECTIVE_QOS_KEEP_ALL, path);
  fail("enum_violation", `${path}/3`, `effective history kind must be 1 or 2; got ${h}`);
}

function validateEffectiveServiceQosDiscriminated(value: CborValue, path: string): CborValue {
  const h = historyKind(value, path);
  if (h === 1) return validateSchema(value, EFFECTIVE_SERVICE_QOS_KEEP_LAST, path);
  if (h === 2) return validateSchema(value, EFFECTIVE_SERVICE_QOS_KEEP_ALL, path);
  fail("enum_violation", `${path}/3`, `effective service history kind must be 1 or 2; got ${h}`);
}

function validateSchemaIdentity(value: CborValue, path: string): Map<number, CborValue> {
  const m = mapToNumberKeys(asMap(value, path), path);
  if (m.size !== 2 || !m.has(1) || !m.has(2)) {
    // exact keys 1 and 2
    for (const k of m.keys()) {
      if (k !== 1 && k !== 2) fail("unknown_key", `${path}/${k}`, `unknown schema_identity key ${k}`);
    }
    if (!m.has(1)) fail("missing_key", `${path}/1`, "missing schema scheme");
    if (!m.has(2)) fail("missing_key", `${path}/2`, "missing schema value");
  }
  const scheme = m.get(1);
  const val = m.get(2);
  if (typeof scheme !== "string") fail("wrong_type", `${path}/1`, "scheme must be text");
  if (typeof val !== "string") fail("wrong_type", `${path}/2`, "value must be text");
  if (scheme === "rep2011-rihs") {
    if (utf8Len(val) !== 71) {
      fail("schema_identity", `${path}/2`, "rep2011-rihs value must be 71 UTF-8 bytes");
    }
    if (!val.startsWith("RIHS01_") || val.length !== 71) {
      fail("schema_identity", `${path}/2`, "rep2011-rihs value must be RIHS01_ + 64 lowercase hex");
    }
    const hex = val.slice(7);
    if (hex.length !== 64 || !LOWER_HEX.test(hex)) {
      fail("schema_identity", `${path}/2`, "rep2011-rihs hex must be 64 lowercase hex chars");
    }
  } else if (scheme === "moonspan-schema-v1") {
    if (utf8Len(val) !== 64 || val.length !== 64 || !LOWER_HEX.test(val)) {
      fail("schema_identity", `${path}/2`, "moonspan-schema-v1 value must be 64 lowercase hex");
    }
  } else {
    fail("schema_identity", `${path}/1`, `unknown schema scheme ${scheme}`);
  }
  return new Map<number, CborValue>([
    [1, scheme],
    [2, val],
  ]);
}

function applyArrayRule(items: CborValue[], rule: ArrayRule | undefined, path: string): void {
  if (!rule || items.length === 0) return;
  if (rule === "unique_ascending_uint") {
    let prev: number | undefined;
    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      if (typeof v !== "number" && typeof v !== "bigint") {
        fail("wrong_type", `${path}/${i}`, "expected uint element");
      }
      const n = typeof v === "bigint" ? Number(v) : v;
      if (prev !== undefined) {
        if (n === prev) fail("unique_violation", `${path}/${i}`, `duplicate value ${n}`);
        if (n < prev) fail("order_violation", `${path}/${i}`, `values must be unique ascending`);
      }
      prev = n;
    }
    return;
  }
  if (rule === "unique_ascending_bytes") {
    let prev: Uint8Array | undefined;
    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      if (!(v instanceof Uint8Array)) fail("wrong_type", `${path}/${i}`, "expected bstr element");
      if (prev !== undefined) {
        const cmp = compareBytes(prev, v);
        if (cmp === 0) fail("unique_violation", `${path}/${i}`, "duplicate byte id");
        if (cmp > 0) fail("order_violation", `${path}/${i}`, "byte ids must be ascending");
      }
      prev = v;
    }
    return;
  }
  if (rule === "unique_ascending_channel_id") {
    let prev: number | undefined;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (!(el instanceof Map)) fail("wrong_type", `${path}/${i}`, "expected map element");
      const id = (el as Map<number, CborValue>).get(1);
      if (typeof id !== "number" && typeof id !== "bigint") {
        fail("wrong_type", `${path}/${i}/1`, "channel_id required");
      }
      const n = typeof id === "bigint" ? Number(id) : id;
      if (prev !== undefined) {
        if (n === prev) fail("unique_violation", `${path}/${i}`, `duplicate channel_id ${n}`);
        if (n < prev) fail("order_violation", `${path}/${i}`, "channel_id must be unique ascending");
      }
      prev = n;
    }
    return;
  }
  if (rule === "graph_nodes_sorted") {
    // unique + bytewise ascending by key 55 node_id
    let prev: Uint8Array | undefined;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (!(el instanceof Map)) fail("wrong_type", `${path}/${i}`, "expected graph-node map");
      const id = (el as Map<number, CborValue>).get(55);
      if (!(id instanceof Uint8Array)) fail("wrong_type", `${path}/${i}/55`, "node_id required");
      if (prev !== undefined) {
        const cmp = compareBytes(prev, id);
        if (cmp === 0) fail("unique_violation", `${path}/${i}`, "duplicate node_id");
        if (cmp > 0) fail("order_violation", `${path}/${i}`, "node_id must be bytewise ascending");
      }
      prev = id;
    }
    return;
  }
  if (rule === "graph_endpoints_sorted") {
    let prev: Uint8Array | undefined;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (!(el instanceof Map)) fail("wrong_type", `${path}/${i}`, "expected graph-endpoint map");
      const id = (el as Map<number, CborValue>).get(56);
      if (!(id instanceof Uint8Array)) fail("wrong_type", `${path}/${i}/56`, "endpoint_id required");
      if (prev !== undefined) {
        const cmp = compareBytes(prev, id);
        if (cmp === 0) fail("unique_violation", `${path}/${i}`, "duplicate endpoint_id");
        if (cmp > 0) fail("order_violation", `${path}/${i}`, "endpoint_id must be bytewise ascending");
      }
      prev = id;
    }
  }
}

// ---------------------------------------------------------------------------
// Nested schemas (QoS, capabilities, graph, resume, errors)
// ---------------------------------------------------------------------------

const QOS_KEEP_LAST: Schema = mapOf([
  [1, req(reliability)],
  [2, req(durability)],
  [3, req(c(1))],
  [4, req(positiveDepth)],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, opt(liveliness)],
  [8, opt(uint64)],
]);

const QOS_NO_DEPTH: Schema = mapOf([
  [1, req(reliability)],
  [2, req(durability)],
  [3, req(unionOf(c(0), c(2)))],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, opt(liveliness)],
  [8, opt(uint64)],
]);

const EFFECTIVE_QOS_KEEP_LAST: Schema = mapOf([
  [1, req(unionOf(c(1), c(2)))],
  [2, req(unionOf(c(1), c(2)))],
  [3, req(c(1))],
  [4, req(positiveDepth)],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, req(unionOf(c(1), c(2)))],
  [8, opt(uint64)],
]);

const EFFECTIVE_QOS_KEEP_ALL: Schema = mapOf([
  [1, req(unionOf(c(1), c(2)))],
  [2, req(unionOf(c(1), c(2)))],
  [3, req(c(2))],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, req(unionOf(c(1), c(2)))],
  [8, opt(uint64)],
]);

const EFFECTIVE_SERVICE_QOS_KEEP_LAST: Schema = mapOf([
  [1, req(c(1))],
  [2, req(c(2))],
  [3, req(c(1))],
  [4, req(positiveDepth)],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, req(unionOf(c(1), c(2)))],
  [8, opt(uint64)],
]);

const EFFECTIVE_SERVICE_QOS_KEEP_ALL: Schema = mapOf([
  [1, req(c(1))],
  [2, req(c(2))],
  [3, req(c(2))],
  [5, opt(uint64)],
  [6, opt(uint64)],
  [7, req(unionOf(c(1), c(2)))],
  [8, opt(uint64)],
]);

const ACTION_QOS_SCHEMA: Schema = mapOf([
  [1, req({ t: "qos" })],
  [2, req({ t: "qos" })],
  [3, req({ t: "qos" })],
  [4, req({ t: "qos" })],
  [5, req({ t: "qos" })],
]);

const EFFECTIVE_ACTION_QOS_SCHEMA: Schema = mapOf([
  [1, req({ t: "effective_service_qos" })],
  [2, req({ t: "effective_service_qos" })],
  [3, req({ t: "effective_service_qos" })],
  [4, req({ t: "effective_qos" })],
  [5, req({ t: "effective_qos" })],
]);

const BUDGETS: Schema = mapOf([
  [1, opt(uint32)],
  [2, opt(uint64)],
  [3, opt(uint32)],
  [4, opt(uint64)],
  [5, opt(uint32)],
  [6, opt(uint64)],
]);

const ERROR_BODY_SESSION: Schema = mapOf([
  [48, req(wireErrorCode)],
  [49, req(c(0))],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const ERROR_BODY_CHANNEL: Schema = mapOf([
  [48, req(wireErrorCode)],
  [49, req(c(1))],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const TRANSPORT_CAPS: Schema = mapOf([
  [1, req({ t: "bool" })],
  [2, req({ t: "bool" })],
  [3, opt(uint32)],
]);

const BUFFER_CAPS: Schema = mapOf([
  [1, req({ t: "bool" })],
  [2, req({ t: "bool" })],
]);

const CAPABILITY_ID_LIST: Schema = arr(0, CAP_IDS_MAX, capabilityId, "unique_ascending_uint");

const NEGOTIATED_CAPS: Schema = mapOf([
  [1, req(TRANSPORT_CAPS)],
  [2, req(BUFFER_CAPS)],
  [3, req(CAPABILITY_ID_LIST)],
]);

const SOURCE_BUNDLE_ENTRY: Schema = mapOf([
  [1, req(textNonempty)],
  [2, req(sourceEntryEncoding)],
  [3, req(bytesContent)],
]);

const GRAPH_NODE: Schema = mapOf([
  [55, req(bytes16)],
  [1, req(textNonempty)],
  [2, opt(text4k)],
  [9, req(domainId)],
]);

const GRAPH_ENDPOINT_TOPIC_SERVICE: Schema = mapOf([
  [56, req(bytes16)],
  [55, req(bytes16)],
  [1, req(textNonempty)],
  [2, req(u(0, 3))],
  [3, req(textNonempty)],
  [4, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [7, req({ t: "qos" })],
  [9, req(domainId)],
  [8, opt(supportRowId)],
]);

const GRAPH_ENDPOINT_ACTION: Schema = mapOf([
  [56, req(bytes16)],
  [55, req(bytes16)],
  [1, req(textNonempty)],
  [2, req(unionOf(c(4), c(5)))],
  [3, req(textNonempty)],
  [4, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [58, req({ t: "action_qos" })],
  [9, req(domainId)],
  [8, opt(supportRowId)],
]);

const GRAPH_ENDPOINT: Schema = unionOf(GRAPH_ENDPOINT_TOPIC_SERVICE, GRAPH_ENDPOINT_ACTION);

const GRAPH_DELTA_OP: Schema = unionOf(
  mapOf([
    [1, req(c(0))],
    [2, req(GRAPH_NODE)],
  ]),
  mapOf([
    [1, req(c(1))],
    [55, req(bytes16)],
  ]),
  mapOf([
    [1, req(c(2))],
    [3, req(GRAPH_ENDPOINT)],
  ]),
  mapOf([
    [1, req(c(3))],
    [56, req(bytes16)],
  ]),
);

const CHANNEL_ACK: Schema = mapOf([
  [1, req(appChannelId)],
  [2, req(uint64)],
]);

const CHANNEL_RESUME_RESULT: Schema = unionOf(
  mapOf([
    [1, req(appChannelId)],
    [2, req(c(0))],
    [3, req(uint64)],
  ]),
  mapOf([
    [1, req(appChannelId)],
    [2, req(c(1))],
    [3, req(c(0))],
  ]),
  mapOf([
    [1, req(appChannelId)],
    [2, req(c(1))],
  ]),
  mapOf([
    [1, req(appChannelId)],
    [2, req(c(2))],
  ]),
  mapOf([
    [1, req(appChannelId)],
    [2, req(c(3))],
    [15, req(ERROR_BODY_CHANNEL)],
  ]),
);

// ---------------------------------------------------------------------------
// Control message kind schemas
// ---------------------------------------------------------------------------

const AUTHENTICATE: Schema = mapOf([
  [1, req(c(CONTROL_KIND_AUTHENTICATE))],
  [2, req(bytes16)],
  [16, req(textNonempty)],
  [17, req(bytesCred)],
]);

const SESSION_READY: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SESSION_READY))],
  [2, req(bytes16)],
  [7, req(textNonempty)],
  [8, req(supportRowId)],
  [10, req(arr(1, DOMAIN_IDS_MAX, domainId, "unique_ascending_uint"))],
  [13, req(textNonempty)],
  [12, req(BUDGETS)],
  [18, req(rosDistro)],
  [19, req(rmwIdentifier)],
  [20, req(textNonempty)],
  [21, req(textNonempty)],
  [53, req(bytes32)],
  [54, req(NEGOTIATED_CAPS)],
]);

/**
 * Phase-one support rows: exact (support_row_id, ros_distro, rmw_identifier) triples.
 * protocol/r2wp-v0.md Phase-one support rows; registry support_row_profiles.
 */
const SESSION_READY_SUPPORT_ROW_TRIPLES: ReadonlyMap<
  string,
  { readonly rosDistro: string; readonly rmwIdentifier: string }
> = new Map([
  ["H-FT", { rosDistro: "humble", rmwIdentifier: "rmw_fastrtps_cpp" }],
  ["H-CY", { rosDistro: "humble", rmwIdentifier: "rmw_cyclonedds_cpp" }],
  ["H-ZN", { rosDistro: "humble", rmwIdentifier: "rmw_zenoh_cpp" }],
  ["J-FT", { rosDistro: "jazzy", rmwIdentifier: "rmw_fastrtps_cpp" }],
  ["J-CY", { rosDistro: "jazzy", rmwIdentifier: "rmw_cyclonedds_cpp" }],
  ["J-ZN", { rosDistro: "jazzy", rmwIdentifier: "rmw_zenoh_cpp" }],
]);

/**
 * Cross-field static check: SessionReady keys 8/18/19 must form an exact phase-one triple.
 * Call only after per-field schema validation has accepted the three keys.
 */
function assertSessionReadySupportRowTriple(map: Map<number, CborValue>, path: string): void {
  const row = map.get(8);
  const distro = map.get(18);
  const rmw = map.get(19);
  if (typeof row !== "string" || typeof distro !== "string" || typeof rmw !== "string") {
    // Per-field schema already enforces text enums; this is defensive.
    fail("wrong_type", `${path}/8`, "SessionReady support-row fields must be text after shape validation");
  }
  const expected = SESSION_READY_SUPPORT_ROW_TRIPLES.get(row);
  if (!expected) {
    fail("enum_violation", `${path}/8`, `unsupported support_row_id ${row}`);
  }
  if (distro !== expected.rosDistro) {
    fail(
      "support_row_mismatch",
      `${path}/18`,
      `SessionReady ros_distro "${distro}" does not match support_row_id "${row}" (expected "${expected.rosDistro}")`,
    );
  }
  if (rmw !== expected.rmwIdentifier) {
    fail(
      "support_row_mismatch",
      `${path}/19`,
      `SessionReady rmw_identifier "${rmw}" does not match support_row_id "${row}" (expected "${expected.rmwIdentifier}")`,
    );
  }
}

const GRAPH_SNAPSHOT: Schema = mapOf([
  [1, req(c(CONTROL_KIND_GRAPH_SNAPSHOT))],
  [2, req(bytes16)],
  [14, req(uint64)],
  [7, req(textNonempty)],
  [8, req(supportRowId)],
  [22, req(arr(0, GRAPH_NODES_MAX, GRAPH_NODE, "graph_nodes_sorted"))],
  [23, req(arr(0, GRAPH_ENDPOINTS_MAX, GRAPH_ENDPOINT, "graph_endpoints_sorted"))],
]);

const GRAPH_DELTA: Schema = mapOf([
  [1, req(c(CONTROL_KIND_GRAPH_DELTA))],
  [2, req(bytes16)],
  [14, req(uint64)],
  [24, req(uint64)],
  [7, req(textNonempty)],
  [8, req(supportRowId)],
  // Preserve semantic order — no sort rule on ops.
  [25, req(arr(1, GRAPH_DELTA_OPS_MAX, GRAPH_DELTA_OP))],
]);

const SCHEMA_REQUEST: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SCHEMA_REQUEST))],
  [2, req(bytes16)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
]);

const SCHEMA_ADVERTISE: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SCHEMA_ADVERTISE))],
  [2, req(bytes16)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [26, req(bytesDesc)],
  [27, opt(arr(0, SOURCE_BUNDLE_MAX, SOURCE_BUNDLE_ENTRY))],
  [28, opt(uint64)],
  [8, opt(supportRowId)],
]);

const SCHEMA_RESPONSE_SUCCESS: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SCHEMA_RESPONSE))],
  [2, req(bytes16)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [26, req(bytesDesc)],
  [27, opt(arr(0, SOURCE_BUNDLE_MAX, SOURCE_BUNDLE_ENTRY))],
  [28, opt(uint64)],
  [8, opt(supportRowId)],
]);

const SCHEMA_RESPONSE_ERROR: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SCHEMA_RESPONSE))],
  [2, req(bytes16)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [15, req(ERROR_BODY_SESSION)],
]);

const SCHEMA_RESPONSE: Schema = unionOf(SCHEMA_RESPONSE_SUCCESS, SCHEMA_RESPONSE_ERROR);

const OPEN_CHANNEL_TOPIC: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(unionOf(c(0), c(1)))],
  [31, req(textNonempty)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [11, req({ t: "qos" })],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
  [9, req(domainId)],
  [8, req(supportRowId)],
]);

const OPEN_CHANNEL_SERVICE: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(unionOf(c(2), c(3)))],
  [31, req(textNonempty)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [11, req({ t: "qos" })],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
  [9, req(domainId)],
  [8, req(supportRowId)],
]);

const OPEN_CHANNEL_ACTION: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(unionOf(c(4), c(5)))],
  [31, req(textNonempty)],
  [4, req(textNonempty)],
  [3, req({ t: "schema_identity" })],
  [5, req(payloadEncodingCdr)],
  [6, req(uint64)],
  [58, req({ t: "action_qos" })],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
  [9, req(domainId)],
  [8, req(supportRowId)],
]);

const OPEN_CHANNEL_MEDIA: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(c(6))],
  [31, req(textNonempty)],
  [5, req(unionOf(c(3), c(4)))],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
  [9, opt(domainId)],
  [8, opt(supportRowId)],
]);

const OPEN_CHANNEL_RECORDING: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(c(7))],
  [31, req(textNonempty)],
  [5, req(unionOf(c(5), c(6)))],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
]);

const OPEN_CHANNEL_ASSET: Schema = mapOf([
  [1, req(c(CONTROL_KIND_OPEN_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [30, req(c(8))],
  [31, req(textNonempty)],
  [5, req(c(6))],
  [32, req(priorityId)],
  [12, req(BUDGETS)],
]);

// Discriminated by key 30 (channel class) for stable errors.
const OPEN_CHANNEL: Schema = {
  t: "union",
  variants: [
    OPEN_CHANNEL_TOPIC,
    OPEN_CHANNEL_SERVICE,
    OPEN_CHANNEL_ACTION,
    OPEN_CHANNEL_MEDIA,
    OPEN_CHANNEL_RECORDING,
    OPEN_CHANNEL_ASSET,
  ],
};

function validateOpenChannel(value: CborValue, path: string): CborValue {
  const raw = mapToNumberKeys(asMap(value, path), path);
  if (!raw.has(30)) fail("missing_key", `${path}/30`, "missing open-channel class key 30");
  const cls = Number(asUint(raw.get(30)!, `${path}/30`, 0n, 8n));
  if (cls === 0 || cls === 1) return validateSchema(value, OPEN_CHANNEL_TOPIC, path);
  if (cls === 2 || cls === 3) return validateSchema(value, OPEN_CHANNEL_SERVICE, path);
  if (cls === 4 || cls === 5) return validateSchema(value, OPEN_CHANNEL_ACTION, path);
  if (cls === 6) return validateSchema(value, OPEN_CHANNEL_MEDIA, path);
  if (cls === 7) return validateSchema(value, OPEN_CHANNEL_RECORDING, path);
  if (cls === 8) return validateSchema(value, OPEN_CHANNEL_ASSET, path);
  fail("enum_violation", `${path}/30`, `unassigned open-channel class ${cls}`);
}

const CHANNEL_READY_TOPIC: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CHANNEL_READY))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [33, req(unionOf(c(0), c(2)))],
  [12, req(BUDGETS)],
  [59, req(priorityId)],
  [57, req({ t: "effective_qos" })],
  [6, opt(uint64)],
  [14, opt(uint64)],
  [9, opt(domainId)],
  [8, opt(supportRowId)],
]);

const CHANNEL_READY_SERVICE: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CHANNEL_READY))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [33, req(unionOf(c(0), c(2)))],
  [12, req(BUDGETS)],
  [59, req(priorityId)],
  [60, req({ t: "effective_service_qos" })],
  [6, opt(uint64)],
  [14, opt(uint64)],
  [9, opt(domainId)],
  [8, opt(supportRowId)],
]);

const CHANNEL_READY_ACTION: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CHANNEL_READY))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [33, req(unionOf(c(0), c(2)))],
  [12, req(BUDGETS)],
  [59, req(priorityId)],
  [58, req({ t: "effective_action_qos" })],
  [6, opt(uint64)],
  [14, opt(uint64)],
  [9, opt(domainId)],
  [8, opt(supportRowId)],
]);

const CHANNEL_READY_MEDIA: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CHANNEL_READY))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [33, req(unionOf(c(0), c(2)))],
  [12, req(BUDGETS)],
  [59, req(priorityId)],
  [6, opt(uint64)],
  [14, opt(uint64)],
  [9, opt(domainId)],
  [8, opt(supportRowId)],
]);

const CHANNEL_READY_FAILURE: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CHANNEL_READY))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [33, req(unionOf(c(1), c(3)))],
  [15, req(ERROR_BODY_CHANNEL)],
]);

const CHANNEL_READY: Schema = unionOf(
  CHANNEL_READY_TOPIC,
  CHANNEL_READY_SERVICE,
  CHANNEL_READY_ACTION,
  CHANNEL_READY_MEDIA,
  CHANNEL_READY_FAILURE,
);

const CLOSE_CHANNEL: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CLOSE_CHANNEL))],
  [2, req(bytes16)],
  [29, req(appChannelId)],
  [34, req(closeReason)],
  [35, opt(uint64)],
]);

const CLOCK_SYNC: Schema = mapOf([
  [1, req(c(CONTROL_KIND_CLOCK_SYNC))],
  [2, req(bytes16)],
  [36, req(clockId)],
  [37, req({ t: "int64" })],
  [38, opt(uint64)],
  [39, opt({ t: "int64" })],
]);

const HEARTBEAT: Schema = mapOf([
  [1, req(c(CONTROL_KIND_HEARTBEAT))],
  [2, req(bytes16)],
  [40, req(uint64)],
  [41, opt(arr(0, ALIVE_CHANNELS_MAX, appChannelId, "unique_ascending_uint"))],
]);

const SESSION_RESUME: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SESSION_RESUME))],
  [2, req(bytes16)],
  [42, req(bytes32)],
  [43, req(c(0))],
  [44, req(NEGOTIATED_CAPS)],
  [7, req(textNonempty)],
  [8, req(supportRowId)],
  [14, req(uint64)],
  [6, req(uint64)],
  [13, req(textNonempty)],
  [45, req(arr(0, CHANNEL_ACKS_MAX, CHANNEL_ACK, "unique_ascending_channel_id"))],
  [16, req(textNonempty)],
  [17, req(bytesCred)],
]);

const SESSION_RESUME_RESULT_ACCEPT: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SESSION_RESUME_RESULT))],
  [2, req(bytes16)],
  [46, req(c(true))],
  [47, req(arr(0, CHANNEL_RESULTS_MAX, CHANNEL_RESUME_RESULT, "unique_ascending_channel_id"))],
]);

const SESSION_RESUME_RESULT_REJECT: Schema = mapOf([
  [1, req(c(CONTROL_KIND_SESSION_RESUME_RESULT))],
  [2, req(bytes16)],
  [46, req(c(false))],
  [15, req(ERROR_BODY_SESSION)],
]);

const SESSION_RESUME_RESULT: Schema = unionOf(
  SESSION_RESUME_RESULT_ACCEPT,
  SESSION_RESUME_RESULT_REJECT,
);

const CONTROL_ERROR_SESSION: Schema = mapOf([
  [1, req(c(CONTROL_KIND_ERROR))],
  [2, req(bytes16)],
  [48, req(wireErrorCode)],
  [49, req(c(0))],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const CONTROL_ERROR_CHANNEL: Schema = mapOf([
  [1, req(c(CONTROL_KIND_ERROR))],
  [2, req(bytes16)],
  [48, req(wireErrorCode)],
  [49, req(c(1))],
  [29, req(appChannelId)],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const CONTROL_ERROR_OPERATION: Schema = mapOf([
  [1, req(c(CONTROL_KIND_ERROR))],
  [2, req(bytes16)],
  [48, req(wireErrorCode)],
  [49, req(c(2))],
  [29, req(appChannelId)],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const CONTROL_ERROR_TRANSPORT: Schema = mapOf([
  [1, req(c(CONTROL_KIND_ERROR))],
  [2, req(bytes16)],
  [48, req(wireErrorCode)],
  [49, req(c(3))],
  [50, opt(retryClass)],
  [51, opt(text4k)],
  [52, opt(text4k)],
]);

const CONTROL_ERROR: Schema = unionOf(
  CONTROL_ERROR_SESSION,
  CONTROL_ERROR_CHANNEL,
  CONTROL_ERROR_OPERATION,
  CONTROL_ERROR_TRANSPORT,
);

const KIND_SCHEMAS: ReadonlyMap<number, Schema> = new Map([
  [CONTROL_KIND_AUTHENTICATE, AUTHENTICATE],
  [CONTROL_KIND_SESSION_READY, SESSION_READY],
  [CONTROL_KIND_GRAPH_SNAPSHOT, GRAPH_SNAPSHOT],
  [CONTROL_KIND_GRAPH_DELTA, GRAPH_DELTA],
  [CONTROL_KIND_SCHEMA_REQUEST, SCHEMA_REQUEST],
  [CONTROL_KIND_SCHEMA_ADVERTISE, SCHEMA_ADVERTISE],
  [CONTROL_KIND_SCHEMA_RESPONSE, SCHEMA_RESPONSE],
  // open-channel uses custom discriminator (key 30); placeholder unused
  [CONTROL_KIND_OPEN_CHANNEL, OPEN_CHANNEL],
  [CONTROL_KIND_CHANNEL_READY, CHANNEL_READY],
  [CONTROL_KIND_CLOSE_CHANNEL, CLOSE_CHANNEL],
  [CONTROL_KIND_CLOCK_SYNC, CLOCK_SYNC],
  [CONTROL_KIND_HEARTBEAT, HEARTBEAT],
  [CONTROL_KIND_SESSION_RESUME, SESSION_RESUME],
  [CONTROL_KIND_SESSION_RESUME_RESULT, SESSION_RESUME_RESULT],
  [CONTROL_KIND_ERROR, CONTROL_ERROR],
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toControlMessage(map: Map<number, CborValue>): ControlMessage {
  const out: ControlMessage = new Map();
  for (const [k, v] of map.entries()) {
    out.set(k, deepCopyValue(v));
  }
  return out;
}

/**
 * Validate a decoded CBOR value as a control-message.
 * Returns an ownership-isolated ControlMessage map.
 */
export function validateControlMessage(value: unknown): ControlMessage {
  try {
    if (!(value instanceof Map)) {
      fail("wrong_input_type", "", "validateControlMessage requires a Map");
    }
    const raw = mapToNumberKeys(value as Map<number | bigint, CborValue>, "");
    if (!raw.has(1)) {
      fail("missing_key", "/1", "control message requires key 1 (kind)");
    }
    const kindVal = raw.get(1);
    const kind = asUint(kindVal as CborValue, "/1", 0n, 255n);
    if (typeof kind !== "number" || !KIND_SCHEMAS.has(kind)) {
      fail("unassigned_kind", "/1", `unassigned control kind ${String(kind)}`);
    }
    let validated: Map<number, CborValue>;
    if (kind === CONTROL_KIND_OPEN_CHANNEL) {
      validated = validateOpenChannel(raw as unknown as CborValue, "") as Map<number, CborValue>;
    } else {
      const schema = KIND_SCHEMAS.get(kind)!;
      validated = validateSchema(raw as unknown as CborValue, schema, "") as Map<number, CborValue>;
    }
    if (kind === CONTROL_KIND_SESSION_READY) {
      assertSessionReadySupportRowTriple(validated, "");
    }
    // Root must remain a map with number keys; re-box as ControlMessage.
    return toControlMessage(validated);
  } catch (e) {
    if (e instanceof ControlCodecError) throw e;
    wrapNative(e, 0, "");
  }
}

/**
 * Decode and fully shape-validate a CONTROL_CBOR payload.
 * Atomic whole-value return; all byte buffers are copies.
 */
export function decodeControlMessage(bytes: Uint8Array): ControlMessage {
  try {
    if (!(bytes instanceof Uint8Array)) {
      fail("wrong_input_type", "", "decodeControlMessage requires a Uint8Array");
    }
    if (bytes.length > CONTROL_PAYLOAD_MAX_BYTES) {
      fail(
        "payload_too_large",
        "",
        `control payload length ${bytes.length} exceeds ${CONTROL_PAYLOAD_MAX_BYTES}`,
      );
    }
    // Copy input so CBOR decode cannot alias caller buffer via internal slices
    // that escape; cbor decoder already copies bstr, but isolate at this boundary.
    const input = bytes.slice();
    let decoded: CborValue;
    try {
      decoded = decodeDeterministicCbor(input);
    } catch (e) {
      wrapNative(e, 0, "");
    }
    return validateControlMessage(decoded);
  } catch (e) {
    if (e instanceof ControlCodecError) throw e;
    wrapNative(e, 0, "");
  }
}

/**
 * Shape-validate then encode a control message to deterministic CBOR.
 * Returns a new Uint8Array; does not mutate the input map.
 */
export function encodeControlMessage(message: ControlMessage): Uint8Array {
  try {
    if (!(message instanceof Map)) {
      fail("wrong_input_type", "", "encodeControlMessage requires a Map");
    }
    // Reject non-uint keys early with stable reason.
    for (const k of message.keys()) {
      if (typeof k !== "number" && typeof k !== "bigint") {
        fail("wrong_type", "", "control map keys must be unsigned integers");
      }
      normalizeKey(k, "");
    }
    const validated = validateControlMessage(message);
    let encoded: Uint8Array;
    try {
      encoded = encodeDeterministicCbor(validated);
    } catch (e) {
      wrapNative(e, 0, "");
    }
    if (encoded.length > CONTROL_PAYLOAD_MAX_BYTES) {
      fail(
        "payload_too_large",
        "",
        `encoded control payload length ${encoded.length} exceeds ${CONTROL_PAYLOAD_MAX_BYTES}`,
      );
    }
    return encoded;
  } catch (e) {
    if (e instanceof ControlCodecError) throw e;
    wrapNative(e, 0, "");
  }
}

/** Exported for tests: CDDL rule surface names covered by the schema engine. */
export const CONTROL_CDDL_RULE_COVERAGE = [
  "authenticate",
  "session-ready",
  "graph-snapshot",
  "graph-delta",
  "schema-request",
  "schema-advertise",
  "schema-response",
  "open-channel",
  "channel-ready",
  "close-channel",
  "clock-sync",
  "heartbeat",
  "session-resume",
  "session-resume-result",
  "control-error",
  "schema-identity",
  "qos",
  "effective-qos",
  "effective-service-qos",
  "action-qos",
  "effective-action-qos",
  "budgets",
  "error-body-session",
  "error-body-channel",
  "transport-capabilities",
  "buffer-capabilities",
  "negotiated-capabilities",
  "source-bundle-entry",
  "graph-node",
  "graph-endpoint",
  "graph-delta-op",
  "channel-ack",
  "channel-resume-result",
  "wire-error-code",
] as const;
