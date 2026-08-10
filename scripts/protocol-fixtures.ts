#!/usr/bin/env bun
/**
 * R2WP v0 valid/boundary fixture generator and checker (M0-03d).
 *
 * --write  regenerates protocol/testdata/manifest.json and valid/*.bin
 * --check  reconstructs every fixture and verifies committed artifacts
 *
 * Deterministic: no timestamps, host paths, or locale-dependent ordering.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  type BootstrapRecord,
  encodeBootstrapRecord,
  decodeBootstrapRecord,
} from "../sdk/typescript/src/protocol/bootstrap.ts";
import {
  CONTROL_KIND_SCHEMA_ADVERTISE,
  CONTROL_KIND_SCHEMA_REQUEST,
  CONTROL_KIND_SESSION_READY,
  CONTROL_PAYLOAD_MAX_BYTES,
  type ControlMessage,
} from "../sdk/typescript/src/protocol/control.ts";
import {
  type CborValue,
  encodeDeterministicCbor,
} from "../sdk/typescript/src/protocol/cbor.ts";
import {
  type R2wpExtension,
  TRACE_CONTEXT_EXTENSION_TYPE,
  TRACE_CONTEXT_VALUE_LENGTH,
  OPERATION_ID_EXTENSION_TYPE,
  OPERATION_ID_VALUE_LENGTH,
  EXTENSION_AREA_MAX_BYTES,
} from "../sdk/typescript/src/protocol/extension.ts";
import {
  CLOCK_NONE,
  CLOCK_SIMULATION,
  CLOCK_SYSTEM,
  FLAG_KEYFRAME,
  FLAG_RETAINED,
  FLAG_ROS_RELIABLE,
  FLAG_TRACE_PRESENT,
  FRAME_HEADER_LENGTH,
  FRAME_PAYLOAD_MAX_BYTES,
  OPCODE_CONTROL_CBOR,
  OPCODE_MEDIA_CHUNK,
  OPCODE_ROS_SAMPLE,
  OPCODE_SERVICE_REQUEST,
  PRIORITY_BULK,
  PRIORITY_CONTROL,
  PRIORITY_DEFAULT,
  type FrameEncodeInput,
  decodeFrame,
  encodeFrame,
} from "../sdk/typescript/src/protocol/frame.ts";

// ---------------------------------------------------------------------------
// Paths / constants
// ---------------------------------------------------------------------------

export const FIXTURES_DIR_REL = "protocol/testdata";
export const MANIFEST_REL = "protocol/testdata/manifest.json";
export const VALID_DIR_REL = "protocol/testdata/valid";
export const GENERATED_BY = "scripts/protocol-fixtures.ts";
export const SCHEMA_VERSION = 1;
export const PROTOCOL_ID = "r2wp-v0";
/** Soft bound for committed manifest size after recipe compaction. */
export const MANIFEST_SIZE_SOFT_MAX = 100 * 1024;
/** Maximum pattern_fill recipe length (matches largest application payload). */
export const RECIPE_LENGTH_MAX = FRAME_PAYLOAD_MAX_BYTES;
/** Maximum pattern_fill pattern size in bytes (hex is 2× this). */
export const RECIPE_PATTERN_MAX_BYTES = 4096;

const FRAME_OPTS = {
  selectedVersion: 0,
  experimentalOpcodesEnabled: false,
  availableClockIds: [0, 1, 2, 3, 4] as const,
};

const PHASE_ONE = [
  { row: "H-FT", distro: "humble", rmw: "rmw_fastrtps_cpp" },
  { row: "H-CY", distro: "humble", rmw: "rmw_cyclonedds_cpp" },
  { row: "J-FT", distro: "jazzy", rmw: "rmw_fastrtps_cpp" },
  { row: "J-CY", distro: "jazzy", rmw: "rmw_cyclonedds_cpp" },
] as const;

/** SchemaAdvertise description length that yields CONTROL payload length 1048576. */
export const CONTROL_1MIB_DESC_LEN = 1_048_452;

const MANIFEST_KEYS = [
  "schema_version",
  "protocol",
  "byte_order",
  "generated_by",
  "fixtures",
] as const;

const FIXTURE_KEYS_REQUIRED = [
  "id",
  "kind",
  "path",
  "representation",
  "byte_length",
  "sha256",
  "expected",
  "coverage",
  "source",
] as const;

const EXPECTED_KEYS = ["status", "roundtrip"] as const;

const REQUIRED_COVERAGE = [
  "application_payload_64mib",
  "bootstrap_error",
  "channel_id_u32_max",
  "client_hello",
  "clock_simulation",
  "control_payload_1mib",
  "effective_limits_ceilings",
  "extension_area_4096",
  "flag_keyframe",
  "flag_retained",
  "flag_ros_reliable",
  "media_chunk",
  "operation_id",
  "priority_bulk",
  "ros_sample",
  "schema_identity_moonspan_v1",
  "schema_identity_rep2011_rihs",
  "schema_request",
  "segment_recipe",
  "sequence_u64_max",
  "server_hello",
  "session_ready",
  "source_time_ns_i64_max",
  "source_time_ns_i64_min",
  "support_row_H-CY",
  "support_row_H-FT",
  "support_row_J-CY",
  "support_row_J-FT",
  "trace_context",
  "unknown_noncritical_tlv",
  "utf8_text_4096",
  "wire_versions_16",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JsonBytes = { $type: "bytes"; hex: string };
export type JsonBigInt = { $type: "bigint"; value: string };
export type JsonMap = { $type: "map"; entries: Array<[number, unknown]> };
export type JsonRecipe = {
  $type: "recipe";
  kind: "pattern_fill";
  pattern_hex: string;
  length: number;
};

export type RoundtripMode = "decode-reencode" | "source-reencode";
export type FixtureKind = "bootstrap" | "frame";

export type FixtureEntry = {
  id: string;
  kind: FixtureKind;
  path: string | null;
  representation: "binary" | "segment_recipe";
  byte_length: number;
  sha256: string;
  payload_length?: number;
  expected: { status: "success"; roundtrip: RoundtripMode };
  coverage: string[];
  source: unknown;
};

export type Manifest = {
  schema_version: number;
  protocol: string;
  byte_order: "network";
  generated_by: string;
  fixtures: FixtureEntry[];
};

// ---------------------------------------------------------------------------
// ASCII / code-unit comparator (locale-independent)
// ---------------------------------------------------------------------------

/** Code-unit / UTF-16 code unit lexicographic compare. */
export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortAscii(strings: string[]): string[] {
  return [...strings].sort(asciiCompare);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd hex length ${hex.length}`);
  if (!/^[0-9a-f]*$/.test(hex)) throw new Error("hex must be lowercase [0-9a-f]");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesTag(bytes: Uint8Array): JsonBytes {
  return { $type: "bytes", hex: toHex(bytes) };
}

export function bigintTag(n: bigint | number): JsonBigInt {
  return { $type: "bigint", value: BigInt(n).toString(10) };
}

export function mapTag(entries: Array<[number, unknown]>): JsonMap {
  return { $type: "map", entries };
}

export function recipeTag(patternHex: string, length: number): JsonRecipe {
  return { $type: "recipe", kind: "pattern_fill", pattern_hex: patternHex, length };
}

export function materializeRecipe(recipe: JsonRecipe): Uint8Array {
  if (recipe.$type !== "recipe" || recipe.kind !== "pattern_fill") {
    throw new Error(`unsupported recipe`);
  }
  if (!Number.isSafeInteger(recipe.length) || recipe.length < 0) {
    throw new Error(`invalid recipe length`);
  }
  if (recipe.length > RECIPE_LENGTH_MAX) {
    throw new Error(`recipe length exceeds ${RECIPE_LENGTH_MAX}`);
  }
  if (typeof recipe.pattern_hex !== "string" || recipe.pattern_hex.length === 0) {
    throw new Error("empty recipe pattern");
  }
  if (recipe.pattern_hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(recipe.pattern_hex)) {
    throw new Error("recipe pattern_hex must be lowercase even-length hex");
  }
  const patternByteLen = recipe.pattern_hex.length / 2;
  if (patternByteLen === 0 || patternByteLen > RECIPE_PATTERN_MAX_BYTES) {
    throw new Error(`recipe pattern length must be 1..${RECIPE_PATTERN_MAX_BYTES} bytes`);
  }
  const pattern = fromHex(recipe.pattern_hex);
  const out = new Uint8Array(recipe.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = pattern[i % pattern.length]!;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Uint8Array);
}

function exactKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, diags: string[]): void {
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!allowed.includes(k)) {
      diags.push(`${path}: unknown key "${k}"`);
    }
  }
}

function requireKeys(obj: Record<string, unknown>, required: readonly string[], path: string, diags: string[]): void {
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) {
      diags.push(`${path}: missing key "${k}"`);
    }
  }
}

/** Decode tagged JSON into runtime values for codec encode inputs. */
export function decodeTagged(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Map) return value;
  if (Array.isArray(value)) {
    return value.map(decodeTagged);
  }
  if (typeof value !== "object") {
    throw new Error(`unsupported tagged value type ${typeof value}`);
  }
  const o = value as Record<string, unknown>;
  if (o.$type === "bytes") {
    if (typeof o.hex !== "string") throw new Error("bytes tag requires hex string");
    return fromHex(o.hex);
  }
  if (o.$type === "bigint") {
    if (typeof o.value !== "string" || !/^-?[0-9]+$/.test(o.value)) {
      throw new Error("bigint tag requires decimal value string");
    }
    return BigInt(o.value);
  }
  if (o.$type === "map") {
    if (!Array.isArray(o.entries)) throw new Error("map tag requires entries array");
    const m = new Map<number | bigint, CborValue>();
    const seen = new Set<number>();
    for (const ent of o.entries) {
      if (!Array.isArray(ent) || ent.length !== 2) throw new Error("map entry must be [key,value]");
      const [k, v] = ent;
      if (typeof k !== "number" || !Number.isSafeInteger(k)) {
        throw new Error("map key must be safe integer");
      }
      if (seen.has(k)) throw new Error(`duplicate map key ${k}`);
      seen.add(k);
      m.set(k, decodeTagged(v) as CborValue);
    }
    return m;
  }
  if (o.$type === "recipe") {
    return materializeRecipe(o as unknown as JsonRecipe);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "$type") continue;
    out[k] = decodeTagged(v);
  }
  if (typeof o.$type === "string") out.$type = o.$type;
  return out;
}

// ---------------------------------------------------------------------------
// Closed structural validation of tagged sources
// ---------------------------------------------------------------------------

function validateTaggedValue(value: unknown, path: string, diags: string[]): void {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => validateTaggedValue(v, `${path}/${i}`, diags));
    return;
  }
  if (!isPlainObject(value)) {
    diags.push(`${path}: expected plain JSON value`);
    return;
  }
  const t = value.$type;
  if (t === "bytes") {
    exactKeys(value, ["$type", "hex"], path, diags);
    requireKeys(value, ["$type", "hex"], path, diags);
    if (typeof value.hex !== "string" || !/^[0-9a-f]*$/.test(value.hex) || value.hex.length % 2 !== 0) {
      diags.push(`${path}: bytes.hex must be lowercase even-length hex`);
    }
    return;
  }
  if (t === "bigint") {
    exactKeys(value, ["$type", "value"], path, diags);
    requireKeys(value, ["$type", "value"], path, diags);
    if (typeof value.value !== "string" || !/^-?[0-9]+$/.test(value.value)) {
      diags.push(`${path}: bigint.value must be decimal string`);
    }
    return;
  }
  if (t === "map") {
    exactKeys(value, ["$type", "entries"], path, diags);
    requireKeys(value, ["$type", "entries"], path, diags);
    if (!Array.isArray(value.entries)) {
      diags.push(`${path}: map.entries must be array`);
      return;
    }
    const seen = new Set<number>();
    value.entries.forEach((ent, i) => {
      const ep = `${path}/entries/${i}`;
      if (!Array.isArray(ent) || ent.length !== 2) {
        diags.push(`${ep}: must be [key, value]`);
        return;
      }
      const [k, v] = ent as [unknown, unknown];
      if (typeof k !== "number" || !Number.isSafeInteger(k)) {
        diags.push(`${ep}: key must be safe integer`);
      } else if (seen.has(k)) {
        diags.push(`${ep}: duplicate map key ${k}`);
      } else {
        seen.add(k);
      }
      validateTaggedValue(v, `${ep}/1`, diags);
    });
    return;
  }
  if (t === "recipe") {
    exactKeys(value, ["$type", "kind", "pattern_hex", "length"], path, diags);
    requireKeys(value, ["$type", "kind", "pattern_hex", "length"], path, diags);
    if (value.kind !== "pattern_fill") {
      diags.push(`${path}: recipe.kind must be pattern_fill`);
    }
    if (
      typeof value.pattern_hex !== "string" ||
      value.pattern_hex.length === 0 ||
      !/^[0-9a-f]*$/.test(value.pattern_hex) ||
      value.pattern_hex.length % 2 !== 0
    ) {
      diags.push(`${path}: recipe.pattern_hex must be nonempty lowercase even-length hex`);
    } else {
      const patternBytes = value.pattern_hex.length / 2;
      if (patternBytes > RECIPE_PATTERN_MAX_BYTES) {
        diags.push(
          `${path}: recipe pattern length ${patternBytes} exceeds max ${RECIPE_PATTERN_MAX_BYTES} bytes`,
        );
      }
    }
    if (typeof value.length !== "number" || !Number.isSafeInteger(value.length) || value.length < 0) {
      diags.push(`${path}: recipe.length must be non-negative safe integer`);
    } else if (value.length > RECIPE_LENGTH_MAX) {
      diags.push(`${path}: recipe.length ${value.length} exceeds max ${RECIPE_LENGTH_MAX}`);
    }
    return;
  }
  if (t === "bootstrap") {
    validateBootstrapSource(value, path, diags);
    return;
  }
  if (t === "frame") {
    validateFrameSource(value, path, diags);
    return;
  }
  if (t !== undefined) {
    diags.push(`${path}: unknown tag $type ${JSON.stringify(t)}`);
    return;
  }
  // Untagged plain object (e.g. nested transportCapabilities): closed recursion on values only.
  for (const [k, v] of Object.entries(value)) {
    validateTaggedValue(v, `${path}/${k}`, diags);
  }
}

const CLIENT_HELLO_KEYS = [
  "$type",
  "kind",
  "wireVersions",
  "transportCapabilities",
  "bufferCapabilities",
  "requestedLimits",
  "extensionCapabilities",
] as const;
const SERVER_HELLO_KEYS = [
  "$type",
  "kind",
  "selectedWireVersion",
  "transportCapabilities",
  "bufferCapabilities",
  "effectiveLimits",
  "extensionCapabilities",
] as const;
const BOOTSTRAP_ERROR_KEYS = ["$type", "kind", "code", "message", "detail"] as const;

function validateBootstrapSource(value: Record<string, unknown>, path: string, diags: string[]): void {
  const kind = value.kind;
  if (kind === "client_hello") {
    exactKeys(value, CLIENT_HELLO_KEYS, path, diags);
    requireKeys(value, CLIENT_HELLO_KEYS, path, diags);
  } else if (kind === "server_hello") {
    exactKeys(value, SERVER_HELLO_KEYS, path, diags);
    requireKeys(value, SERVER_HELLO_KEYS, path, diags);
  } else if (kind === "bootstrap_error") {
    // message/detail optional
    exactKeys(value, BOOTSTRAP_ERROR_KEYS, path, diags);
    requireKeys(value, ["$type", "kind", "code"], path, diags);
  } else {
    diags.push(`${path}: bootstrap.kind must be client_hello|server_hello|bootstrap_error`);
    exactKeys(value, ["$type", "kind"], path, diags);
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "$type" || k === "kind") continue;
    validateTaggedValue(v, `${path}/${k}`, diags);
  }
}

const FRAME_KEYS = [
  "$type",
  "version",
  "opcode",
  "flags",
  "channelId",
  "sequence",
  "sourceTimeNs",
  "priority",
  "clockId",
  "extensions",
  "payload",
] as const;
const FRAME_REQUIRED = ["$type", "opcode", "channelId", "sequence", "priority", "clockId", "payload"] as const;
const EXT_KEYS = ["type", "critical", "value"] as const;

function validateFrameSource(value: Record<string, unknown>, path: string, diags: string[]): void {
  exactKeys(value, FRAME_KEYS, path, diags);
  requireKeys(value, FRAME_REQUIRED, path, diags);
  if (value.extensions !== undefined) {
    if (!Array.isArray(value.extensions)) {
      diags.push(`${path}/extensions: must be array`);
    } else {
      value.extensions.forEach((ext, i) => {
        const ep = `${path}/extensions/${i}`;
        if (!isPlainObject(ext)) {
          diags.push(`${ep}: must be object`);
          return;
        }
        exactKeys(ext, EXT_KEYS, ep, diags);
        requireKeys(ext, EXT_KEYS, ep, diags);
        validateTaggedValue(ext.value, `${ep}/value`, diags);
      });
    }
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "$type" || k === "extensions") continue;
    validateTaggedValue(v, `${path}/${k}`, diags);
  }
}

function validateFixtureSource(source: unknown, kind: string, path: string, diags: string[]): void {
  if (!isPlainObject(source)) {
    diags.push(`${path}: source must be object`);
    return;
  }
  if (kind === "bootstrap") {
    if (source.$type !== "bootstrap") {
      diags.push(`${path}: source.$type must be bootstrap`);
    }
    validateBootstrapSource(source, path, diags);
    return;
  }
  if (kind === "frame") {
    if (source.$type !== "frame") {
      diags.push(`${path}: source.$type must be frame`);
    }
    validateFrameSource(source, path, diags);
    return;
  }
  diags.push(`${path}: cannot validate source for kind ${kind}`);
}

// ---------------------------------------------------------------------------
// Encode from tagged source
// ---------------------------------------------------------------------------

function corr(seed: number): Uint8Array {
  const b = new Uint8Array(16);
  b[0] = seed & 0xff;
  b[1] = (seed >>> 8) & 0xff;
  return b;
}

function sessionId(seed: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = seed & 0xff;
  return b;
}

function traceValue(): Uint8Array {
  const v = new Uint8Array(TRACE_CONTEXT_VALUE_LENGTH);
  for (let i = 0; i < 16; i++) v[i] = i + 1;
  for (let i = 0; i < 8; i++) v[16 + i] = 0xa0 + i;
  v[24] = 0x01;
  return v;
}

function opIdValue(): Uint8Array {
  const v = new Uint8Array(OPERATION_ID_VALUE_LENGTH);
  for (let i = 0; i < v.length; i++) v[i] = 0x10 + i;
  return v;
}

function negotiatedCaps(): unknown {
  return mapTag([
    [1, mapTag([[1, true], [2, true], [3, 1200]])],
    [2, mapTag([[1, true], [2, false]])],
    [3, [1, 2]],
  ]);
}

function budgets(): unknown {
  return mapTag([
    [1, 64],
    [3, 65536],
  ]);
}

function schemaRihs(): unknown {
  return mapTag([
    [1, "rep2011-rihs"],
    [2, "RIHS01_" + "cd".repeat(32)],
  ]);
}

function schemaMoon(): unknown {
  return mapTag([
    [1, "moonspan-schema-v1"],
    [2, "ab".repeat(32)],
  ]);
}

function encodeBootstrapSource(source: unknown): Uint8Array {
  const s = decodeTagged(source) as Record<string, unknown>;
  if (s.$type !== "bootstrap") throw new Error("bootstrap source requires $type bootstrap");
  const rec = { ...s };
  delete rec.$type;
  return encodeBootstrapRecord(rec as unknown as BootstrapRecord);
}

function encodeExtensions(exts: unknown): R2wpExtension[] | undefined {
  if (exts === undefined) return undefined;
  if (!Array.isArray(exts)) throw new Error("extensions must be an array");
  return exts.map((e) => {
    const o = decodeTagged(e) as Record<string, unknown>;
    return {
      type: o.type as number,
      critical: o.critical as boolean,
      value: o.value as Uint8Array,
    };
  });
}

function encodeFrameSource(source: unknown): Uint8Array {
  const s = decodeTagged(source) as Record<string, unknown>;
  if (s.$type !== "frame") throw new Error("frame source requires $type frame");
  let payload: Uint8Array | ControlMessage;
  const p = s.payload;
  if (p instanceof Uint8Array) {
    payload = p;
  } else if (p instanceof Map) {
    payload = p as ControlMessage;
  } else {
    throw new Error("frame payload must be bytes, recipe, or control map");
  }
  const input: FrameEncodeInput = {
    version: (s.version as number | undefined) ?? 0,
    opcode: s.opcode as number,
    flags: (s.flags as number | undefined) ?? 0,
    channelId: s.channelId as number,
    sequence: s.sequence as number | bigint,
    sourceTimeNs: (s.sourceTimeNs as number | bigint | undefined) ?? 0,
    priority: s.priority as number,
    clockId: s.clockId as number,
    extensions: encodeExtensions(s.extensions),
    payload,
  };
  return encodeFrame(input, {
    selectedVersion: FRAME_OPTS.selectedVersion,
    experimentalOpcodesEnabled: FRAME_OPTS.experimentalOpcodesEnabled,
    availableClockIds: [...FRAME_OPTS.availableClockIds],
  });
}

export function encodeFixtureSource(kind: FixtureKind, source: unknown): Uint8Array {
  if (kind === "bootstrap") return encodeBootstrapSource(source);
  if (kind === "frame") return encodeFrameSource(source);
  throw new Error(`unknown kind ${kind}`);
}

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------

function defineFixtures(): Array<
  Omit<FixtureEntry, "byte_length" | "sha256" | "payload_length"> & { payload_length?: number }
> {
  const fixtures: Array<
    Omit<FixtureEntry, "byte_length" | "sha256" | "payload_length"> & { payload_length?: number }
  > = [];

  fixtures.push({
    id: "bootstrap-client-hello-maxima",
    kind: "bootstrap",
    path: "valid/bootstrap-client-hello-maxima.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: [
      "client_hello",
      "extension_capabilities_64",
      "requested_limits_u32_u64_max",
      "wire_versions_16",
    ],
    source: {
      $type: "bootstrap",
      kind: "client_hello",
      wireVersions: Array.from({ length: 16 }, (_, i) => i),
      transportCapabilities: {
        webtransportHttp3: true,
        binaryWss: true,
        maxDatagramSize: 0xffff_ffff,
      },
      bufferCapabilities: {
        transferableArraybuffer: true,
        sharedArraybuffer: true,
      },
      requestedLimits: {
        maxChannels: 0xffff_ffff,
        maxSessionBytes: bigintTag(0xffff_ffff_ffff_ffffn),
        maxMessageBytes: 0xffff_ffff,
        maxControlPayloadBytes: 0xffff_ffff,
      },
      extensionCapabilities: Array.from({ length: 64 }, (_, i) => i + 1),
    },
  });

  fixtures.push({
    id: "bootstrap-server-hello-ceilings",
    kind: "bootstrap",
    path: "valid/bootstrap-server-hello-ceilings.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: ["effective_limits_ceilings", "server_hello"],
    source: {
      $type: "bootstrap",
      kind: "server_hello",
      selectedWireVersion: 0,
      transportCapabilities: {
        webtransportHttp3: true,
        binaryWss: true,
        maxDatagramSize: 65535,
      },
      bufferCapabilities: {
        transferableArraybuffer: true,
        sharedArraybuffer: false,
      },
      effectiveLimits: {
        maxChannels: 65535,
        maxSessionBytes: 4294967296,
        maxMessageBytes: 67108864,
        maxControlPayloadBytes: 1048576,
      },
      extensionCapabilities: [1, 2, 3],
    },
  });

  fixtures.push({
    id: "bootstrap-error-text-4096",
    kind: "bootstrap",
    path: "valid/bootstrap-error-text-4096.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: ["bootstrap_error", "utf8_text_4096"],
    source: {
      $type: "bootstrap",
      kind: "bootstrap_error",
      code: 1,
      message: "a".repeat(4096),
      detail: "b".repeat(4096),
    },
  });

  for (let ri = 0; ri < PHASE_ONE.length; ri++) {
    const row = PHASE_ONE[ri]!;
    const withTrace = row.row === "H-FT";
    const id = withTrace ? "frame-session-ready-H-FT-trace" : `frame-session-ready-${row.row}`;
    const controlMap = mapTag([
      [1, CONTROL_KIND_SESSION_READY],
      [2, bytesTag(corr(0x20 + ri))],
      [7, "gateway-1"],
      [8, row.row],
      [10, [0, 1]],
      [13, "policy-v1"],
      [12, budgets()],
      [18, row.distro],
      [19, row.rmw],
      [20, "adapter-1"],
      [21, "1.0.0"],
      [53, bytesTag(sessionId(0x30 + ri))],
      [54, negotiatedCaps()],
    ]);
    const source: Record<string, unknown> = {
      $type: "frame",
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      sequence: 0,
      sourceTimeNs: 0,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      payload: controlMap,
    };
    if (withTrace) {
      source.flags = FLAG_TRACE_PRESENT;
      source.extensions = [
        {
          type: TRACE_CONTEXT_EXTENSION_TYPE,
          critical: false,
          value: bytesTag(traceValue()),
        },
      ];
    }
    fixtures.push({
      id,
      kind: "frame",
      path: `valid/${id}.bin`,
      representation: "binary",
      expected: { status: "success", roundtrip: "decode-reencode" },
      coverage: sortAscii([
        "session_ready",
        `support_row_${row.row}`,
        `ros_distro_${row.distro}`,
        `rmw_${row.rmw}`,
        ...(withTrace ? ["trace_context", "trace_present"] : []),
      ]),
      source,
    });
  }

  for (const [idSuffix, schemeTag, cov] of [
    ["rep2011-rihs", schemaRihs(), "schema_identity_rep2011_rihs"],
    ["moonspan-schema-v1", schemaMoon(), "schema_identity_moonspan_v1"],
  ] as const) {
    const id = `frame-schema-request-${idSuffix}`;
    fixtures.push({
      id,
      kind: "frame",
      path: `valid/${id}.bin`,
      representation: "binary",
      expected: { status: "success", roundtrip: "decode-reencode" },
      coverage: sortAscii(["schema_request", cov]),
      source: {
        $type: "frame",
        opcode: OPCODE_CONTROL_CBOR,
        channelId: 0,
        sequence: 1,
        priority: PRIORITY_CONTROL,
        clockId: CLOCK_NONE,
        payload: mapTag([
          [1, CONTROL_KIND_SCHEMA_REQUEST],
          [2, bytesTag(corr(0x40))],
          [4, "std_msgs/msg/String"],
          [3, schemeTag],
        ]),
      },
    });
  }

  fixtures.push({
    id: "frame-ros-sample-channel-u32-max",
    kind: "frame",
    path: "valid/frame-ros-sample-channel-u32-max.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["channel_id_u32_max", "ros_sample"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 0xffff_ffff,
      sequence: 0,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      payload: bytesTag(new Uint8Array([0x01])),
    },
  });

  fixtures.push({
    id: "frame-ros-sample-sequence-u64-max",
    kind: "frame",
    path: "valid/frame-ros-sample-sequence-u64-max.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["ros_sample", "sequence_u64_max"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: bigintTag(0xffff_ffff_ffff_ffffn),
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      payload: bytesTag(new Uint8Array([0x02])),
    },
  });

  fixtures.push({
    id: "frame-ros-sample-time-i64-max",
    kind: "frame",
    path: "valid/frame-ros-sample-time-i64-max.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["ros_sample", "source_time_ns_i64_max"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      sourceTimeNs: bigintTag(0x7fff_ffff_ffff_ffffn),
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_SYSTEM,
      payload: bytesTag(new Uint8Array([0x03])),
    },
  });

  fixtures.push({
    id: "frame-ros-sample-time-i64-min",
    kind: "frame",
    path: "valid/frame-ros-sample-time-i64-min.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["ros_sample", "source_time_ns_i64_min"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      sourceTimeNs: bigintTag(-0x8000_0000_0000_0000n),
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_SYSTEM,
      payload: bytesTag(new Uint8Array([0x04])),
    },
  });

  fixtures.push({
    id: "frame-ros-sample-flags-reliable-retained",
    kind: "frame",
    path: "valid/frame-ros-sample-flags-reliable-retained.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["flag_retained", "flag_ros_reliable", "ros_sample"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      flags: FLAG_ROS_RELIABLE | FLAG_RETAINED,
      channelId: 2,
      sequence: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      payload: bytesTag(new Uint8Array([0x05])),
    },
  });

  fixtures.push({
    id: "frame-ros-sample-priority4-clock4",
    kind: "frame",
    path: "valid/frame-ros-sample-priority4-clock4.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["clock_simulation", "priority_bulk", "ros_sample"]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 3,
      sequence: 2,
      sourceTimeNs: 1000,
      priority: PRIORITY_BULK,
      clockId: CLOCK_SIMULATION,
      payload: bytesTag(new Uint8Array([0x06])),
    },
  });

  const mediaMap = new Map<number, CborValue>([
    [1, 0],
    [2, 0],
    [3, false],
    [4, 3],
    [5, new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
  ]);
  fixtures.push({
    id: "frame-media-chunk-keyframe",
    kind: "frame",
    path: "valid/frame-media-chunk-keyframe.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["flag_keyframe", "media_chunk", "media_cbor_payload"]),
    source: {
      $type: "frame",
      opcode: OPCODE_MEDIA_CHUNK,
      flags: FLAG_KEYFRAME,
      channelId: 10,
      sequence: 0,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      payload: bytesTag(encodeDeterministicCbor(mediaMap)),
    },
  });

  fixtures.push({
    id: "frame-service-request-trace-opid",
    kind: "frame",
    path: "valid/frame-service-request-trace-opid.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii(["operation_id", "service_request", "trace_context"]),
    source: {
      $type: "frame",
      opcode: OPCODE_SERVICE_REQUEST,
      flags: FLAG_TRACE_PRESENT,
      channelId: 11,
      sequence: 0,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extensions: [
        {
          type: TRACE_CONTEXT_EXTENSION_TYPE,
          critical: false,
          value: bytesTag(traceValue()),
        },
        {
          type: OPERATION_ID_EXTENSION_TYPE,
          critical: false,
          value: bytesTag(opIdValue()),
        },
      ],
      payload: bytesTag(new Uint8Array([0x10, 0x20])),
    },
  });

  // Extension area 4096: nested recipe for 4092-byte value (wire remains binary).
  fixtures.push({
    id: "frame-extension-area-4096-unknown-noncritical",
    kind: "frame",
    path: "valid/frame-extension-area-4096-unknown-noncritical.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "source-reencode" },
    coverage: sortAscii([
      "extension_area_4096",
      "source_reencode",
      "unknown_noncritical_tlv",
    ]),
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 12,
      sequence: 0,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extensions: [
        {
          type: 128,
          critical: false,
          value: recipeTag("5a", EXTENSION_AREA_MAX_BYTES - 4),
        },
      ],
      payload: bytesTag(new Uint8Array([0x99])),
    },
  });

  // CONTROL 1 MiB: nested recipe for description bytes (wire remains binary).
  fixtures.push({
    id: "frame-control-payload-1mib",
    kind: "frame",
    path: "valid/frame-control-payload-1mib.bin",
    representation: "binary",
    expected: { status: "success", roundtrip: "decode-reencode" },
    coverage: sortAscii([
      "control_payload_1mib",
      "exact_payload_length",
      "schema_advertise",
    ]),
    payload_length: CONTROL_PAYLOAD_MAX_BYTES,
    source: {
      $type: "frame",
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      sequence: 0,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      payload: mapTag([
        [1, CONTROL_KIND_SCHEMA_ADVERTISE],
        [2, bytesTag(corr(0x50))],
        [4, "t"],
        [3, schemaMoon()],
        [5, 1],
        [6, 0],
        [26, recipeTag("42", CONTROL_1MIB_DESC_LEN)],
      ]),
    },
  });

  fixtures.push({
    id: "frame-app-payload-64mib-recipe",
    kind: "frame",
    path: null,
    representation: "segment_recipe",
    expected: { status: "success", roundtrip: "source-reencode" },
    coverage: sortAscii([
      "application_payload_64mib",
      "exact_payload_length",
      "segment_recipe",
    ]),
    payload_length: FRAME_PAYLOAD_MAX_BYTES,
    source: {
      $type: "frame",
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 13,
      sequence: 0,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      payload: recipeTag("a55a", FRAME_PAYLOAD_MAX_BYTES),
    },
  });

  fixtures.sort((a, b) => asciiCompare(a.id, b.id));
  for (const f of fixtures) {
    f.coverage = sortAscii(f.coverage);
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildManifest(): { manifest: Manifest; binaries: Map<string, Uint8Array> } {
  const defs = defineFixtures();
  const binaries = new Map<string, Uint8Array>();
  const fixtures: FixtureEntry[] = [];

  for (const def of defs) {
    const bytes = encodeFixtureSource(def.kind, def.source);
    const entry: FixtureEntry = {
      id: def.id,
      kind: def.kind,
      path: def.path,
      representation: def.representation,
      byte_length: bytes.length,
      sha256: sha256Hex(bytes),
      expected: def.expected,
      coverage: sortAscii([...def.coverage]),
      source: def.source,
    };
    if (def.payload_length !== undefined) {
      entry.payload_length = def.payload_length;
      if (def.kind === "frame" && bytes.length >= FRAME_HEADER_LENGTH) {
        const plen =
          ((bytes[24]! << 24) | (bytes[25]! << 16) | (bytes[26]! << 8) | bytes[27]!) >>> 0;
        if (plen !== def.payload_length) {
          throw new Error(
            `${def.id}: payload_length claim ${def.payload_length} != header payload_len ${plen}`,
          );
        }
      }
    }
    fixtures.push(entry);
    if (def.path !== null) {
      binaries.set(def.path, bytes);
    }
  }

  fixtures.sort((a, b) => asciiCompare(a.id, b.id));
  const manifest: Manifest = {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    byte_order: "network",
    generated_by: GENERATED_BY,
    fixtures,
  };
  return { manifest, binaries };
}

export function stableManifestJson(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Check (total / closed / no native leaks)
// ---------------------------------------------------------------------------

function pushDiag(diags: string[], msg: string): void {
  diags.push(msg);
}

function finish(diags: string[]): { ok: boolean; diagnostics: string[] } {
  const diagnostics = sortAscii(diags);
  return { ok: diagnostics.length === 0, diagnostics };
}

function isSafePosixRelPath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  return true;
}

const FIXTURE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Canonical binary entry eligible for disk IO: representation binary, valid id,
 * path exactly valid/<id>.bin, safe POSIX relative, and resolved under testdata/valid.
 */
export function isCanonicalBinaryEntry(
  raw: Record<string, unknown>,
  root: string,
): { ok: true; relPath: string; absPath: string } | { ok: false } {
  if (raw.representation !== "binary") return { ok: false };
  if (typeof raw.id !== "string" || !FIXTURE_ID_RE.test(raw.id)) return { ok: false };
  if (typeof raw.path !== "string") return { ok: false };
  const relPath = raw.path;
  if (relPath !== `valid/${raw.id}.bin`) return { ok: false };
  if (!isSafePosixRelPath(relPath)) return { ok: false };
  const testdataRoot = path.resolve(root, FIXTURES_DIR_REL);
  const validRoot = path.resolve(root, VALID_DIR_REL);
  const absPath = path.resolve(testdataRoot, relPath);
  const relToValid = path.relative(validRoot, absPath);
  if (
    relToValid.startsWith("..") ||
    path.isAbsolute(relToValid) ||
    relToValid.includes("..")
  ) {
    return { ok: false };
  }
  // Must be a direct file under valid/ (no nested dirs beyond valid/<id>.bin)
  if (path.dirname(absPath) !== validRoot) return { ok: false };
  return { ok: true, relPath, absPath };
}

/**
 * Pure structural + semantic diagnostics over an arbitrary JSON value.
 * Never throws for repository-controlled content.
 */
export function diagnoseManifestValue(
  value: unknown,
  options?: {
    rawText?: string;
    checkCanonical?: boolean;
  },
): string[] {
  const diags: string[] = [];
  const checkCanonical = options?.checkCanonical !== false;

  try {
    if (!isPlainObject(value)) {
      pushDiag(diags, "manifest: root must be a plain object");
      return sortAscii(diags);
    }
    const manifest = value;
    exactKeys(manifest, MANIFEST_KEYS, "manifest", diags);
    requireKeys(manifest, MANIFEST_KEYS, "manifest", diags);

    if (manifest.schema_version !== SCHEMA_VERSION) {
      pushDiag(diags, `manifest: schema_version must be ${SCHEMA_VERSION}`);
    }
    if (manifest.protocol !== PROTOCOL_ID) {
      pushDiag(diags, `manifest: protocol must be ${PROTOCOL_ID}`);
    }
    if (manifest.byte_order !== "network") {
      pushDiag(diags, "manifest: byte_order must be network");
    }
    if (manifest.generated_by !== GENERATED_BY) {
      pushDiag(diags, `manifest: generated_by must be ${GENERATED_BY}`);
    }
    if (!Array.isArray(manifest.fixtures)) {
      pushDiag(diags, "manifest: fixtures must be an array");
      return sortAscii(diags);
    }

    let expected: Manifest | null = null;
    if (checkCanonical) {
      try {
        const built = buildManifest();
        expected = built.manifest;
        if (options?.rawText !== undefined) {
          const expectedJson = stableManifestJson(expected);
          if (options.rawText !== expectedJson) {
            pushDiag(
              diags,
              "manifest: committed JSON is not byte-identical to regenerated canonical form",
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushDiag(diags, `manifest: canonical rebuild failed: ${msg}`);
      }
    }

    const ids: string[] = [];
    const allCoverage = new Set<string>();

    for (let i = 0; i < manifest.fixtures.length; i++) {
      const raw = manifest.fixtures[i];
      const base = `fixture[${i}]`;
      if (!isPlainObject(raw)) {
        pushDiag(diags, `${base}: must be object`);
        continue;
      }

      const allowedKeys = [...FIXTURE_KEYS_REQUIRED, "payload_length"];
      exactKeys(raw, allowedKeys, base, diags);
      requireKeys(raw, FIXTURE_KEYS_REQUIRED, base, diags);

      const id = raw.id;
      if (typeof id !== "string" || id.length === 0 || !FIXTURE_ID_RE.test(id)) {
        pushDiag(diags, `${base}: id must be nonempty [A-Za-z0-9][A-Za-z0-9._-]*`);
      } else {
        ids.push(id);
      }
      const label = typeof id === "string" && id ? `fixture[${id}]` : base;

      if (raw.kind !== "bootstrap" && raw.kind !== "frame") {
        pushDiag(diags, `${label}: kind must be bootstrap|frame`);
      }
      if (raw.representation !== "binary" && raw.representation !== "segment_recipe") {
        pushDiag(diags, `${label}: representation must be binary|segment_recipe`);
      }

      if (raw.representation === "binary") {
        if (typeof raw.path !== "string") {
          pushDiag(diags, `${label}: binary representation requires string path`);
        } else {
          if (!isSafePosixRelPath(raw.path)) {
            pushDiag(diags, `${label}: path must be safe relative POSIX path`);
          }
          if (typeof id === "string" && raw.path !== `valid/${id}.bin`) {
            pushDiag(diags, `${label}: binary path must be valid/<id>.bin`);
          }
        }
      } else if (raw.representation === "segment_recipe") {
        if (raw.path !== null) {
          pushDiag(diags, `${label}: segment_recipe representation requires path null`);
        }
      }

      if (typeof raw.byte_length !== "number" || !Number.isSafeInteger(raw.byte_length) || raw.byte_length < 0) {
        pushDiag(diags, `${label}: byte_length must be non-negative safe integer`);
      }
      if (Object.prototype.hasOwnProperty.call(raw, "payload_length")) {
        if (raw.kind !== "frame") {
          pushDiag(diags, `${label}: payload_length is frame-only`);
        } else if (
          typeof raw.payload_length !== "number" ||
          !Number.isSafeInteger(raw.payload_length) ||
          raw.payload_length < 0
        ) {
          pushDiag(diags, `${label}: payload_length must be non-negative safe integer`);
        }
      }
      if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
        pushDiag(diags, `${label}: sha256 must be 64 lowercase hex chars`);
      }

      if (!isPlainObject(raw.expected)) {
        pushDiag(diags, `${label}: expected must be object`);
      } else {
        exactKeys(raw.expected, EXPECTED_KEYS, `${label}/expected`, diags);
        requireKeys(raw.expected, EXPECTED_KEYS, `${label}/expected`, diags);
        if (raw.expected.status !== "success") {
          pushDiag(diags, `${label}: expected.status must be success`);
        }
        if (
          raw.expected.roundtrip !== "decode-reencode" &&
          raw.expected.roundtrip !== "source-reencode"
        ) {
          pushDiag(diags, `${label}: expected.roundtrip must be decode-reencode|source-reencode`);
        }
      }

      if (!Array.isArray(raw.coverage)) {
        pushDiag(diags, `${label}: coverage must be array`);
      } else {
        if (raw.coverage.length === 0) {
          pushDiag(diags, `${label}: coverage must be nonempty`);
        }
        const cov = raw.coverage;
        for (let c = 0; c < cov.length; c++) {
          if (typeof cov[c] !== "string" || (cov[c] as string).length === 0) {
            pushDiag(diags, `${label}: coverage[${c}] must be nonempty string`);
          } else {
            allCoverage.add(cov[c] as string);
          }
          if (c > 0 && typeof cov[c] === "string" && typeof cov[c - 1] === "string") {
            if (asciiCompare(cov[c - 1] as string, cov[c] as string) >= 0) {
              pushDiag(diags, `${label}: coverage must be sorted unique ascending`);
              break;
            }
          }
        }
        const strCov = cov.filter((x): x is string => typeof x === "string");
        if (new Set(strCov).size !== strCov.length) {
          pushDiag(diags, `${label}: coverage must be unique`);
        }
      }

      if (typeof raw.kind === "string") {
        validateFixtureSource(raw.source, raw.kind, `${label}/source`, diags);
      }

      const kindOk = raw.kind === "bootstrap" || raw.kind === "frame";
      if (!kindOk) continue;

      let bytes: Uint8Array;
      try {
        bytes = encodeFixtureSource(raw.kind, raw.source);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushDiag(diags, `${label}: source encode failed: ${msg}`);
        continue;
      }

      if (typeof raw.byte_length === "number" && bytes.length !== raw.byte_length) {
        pushDiag(
          diags,
          `${label}: reconstructed length ${bytes.length} != manifest byte_length ${raw.byte_length}`,
        );
      }
      const hash = sha256Hex(bytes);
      if (typeof raw.sha256 === "string" && hash !== raw.sha256) {
        pushDiag(diags, `${label}: reconstructed sha256 ${hash} != manifest ${raw.sha256}`);
      }

      if (
        Object.prototype.hasOwnProperty.call(raw, "payload_length") &&
        typeof raw.payload_length === "number" &&
        raw.kind === "frame" &&
        bytes.length >= FRAME_HEADER_LENGTH
      ) {
        const plen =
          ((bytes[24]! << 24) | (bytes[25]! << 16) | (bytes[26]! << 8) | bytes[27]!) >>> 0;
        if (plen !== raw.payload_length) {
          pushDiag(
            diags,
            `${label}: header payload_len ${plen} != manifest payload_length ${raw.payload_length}`,
          );
        }
      }

      try {
        const roundtrip = isPlainObject(raw.expected) ? raw.expected.roundtrip : null;
        if (raw.kind === "bootstrap") {
          const decoded = decodeBootstrapRecord(bytes);
          if (roundtrip === "decode-reencode") {
            const again = encodeBootstrapRecord(decoded);
            if (again.length !== bytes.length || !again.every((b, i) => b === bytes[i])) {
              pushDiag(diags, `${label}: decode-reencode byte mismatch`);
            }
          } else if (roundtrip === "source-reencode") {
            const fromSource = encodeFixtureSource(raw.kind, raw.source);
            if (fromSource.length !== bytes.length || !fromSource.every((b, i) => b === bytes[i])) {
              pushDiag(diags, `${label}: source-reencode byte mismatch`);
            }
          }
        } else {
          const decoded = decodeFrame(bytes, {
            selectedVersion: 0,
            experimentalOpcodesEnabled: false,
            availableClockIds: [0, 1, 2, 3, 4],
          });
          if (roundtrip === "decode-reencode") {
            const again = encodeFrame(
              {
                version: decoded.version,
                opcode: decoded.opcode,
                flags: decoded.flags,
                channelId: decoded.channelId,
                sequence: decoded.sequence,
                sourceTimeNs: decoded.sourceTimeNs,
                priority: decoded.priority,
                clockId: decoded.clockId,
                extensions: decoded.extensions,
                payload: decoded.payload,
              },
              {
                selectedVersion: 0,
                experimentalOpcodesEnabled: false,
                availableClockIds: [0, 1, 2, 3, 4],
              },
            );
            if (again.length !== bytes.length || !again.every((b, i) => b === bytes[i])) {
              pushDiag(diags, `${label}: decode-reencode byte mismatch`);
            }
          } else if (roundtrip === "source-reencode") {
            const fromSource = encodeFixtureSource(raw.kind, raw.source);
            if (fromSource.length !== bytes.length || !fromSource.every((b, i) => b === bytes[i])) {
              pushDiag(diags, `${label}: source-reencode byte mismatch`);
            }
          }
          void decoded;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushDiag(diags, `${label}: decode/roundtrip failed: ${msg}`);
      }
    }

    for (let i = 1; i < ids.length; i++) {
      if (asciiCompare(ids[i - 1]!, ids[i]!) >= 0) {
        pushDiag(diags, `manifest: fixture ids must be sorted unique; order break at ${ids[i]}`);
        break;
      }
    }
    if (new Set(ids).size !== ids.length) {
      pushDiag(diags, "manifest: fixture ids must be unique");
    }

    for (const c of REQUIRED_COVERAGE) {
      if (!allCoverage.has(c)) {
        pushDiag(diags, `manifest: missing required coverage token "${c}"`);
      }
    }

    if (expected) {
      const expIds = expected.fixtures.map((f) => f.id);
      if (ids.length !== expIds.length || ids.some((id, i) => id !== expIds[i])) {
        pushDiag(
          diags,
          `manifest: fixture id set/order diverges from generator (expected ${expIds.length} fixtures)`,
        );
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushDiag(diags, `manifest: unexpected failure: ${msg}`);
  }

  return sortAscii(diags);
}

/**
 * Full repository check: closed manifest validation + disk equality.
 * Never throws for repository-controlled manifest content.
 */
export async function checkFixtures(root: string): Promise<{ ok: boolean; diagnostics: string[] }> {
  const diags: string[] = [];
  try {
    const manifestPath = path.join(root, MANIFEST_REL);
    let rawText: string;
    try {
      rawText = await readFile(manifestPath, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return finish([`manifest: failed to read ${MANIFEST_REL}: ${msg}`]);
    }

    let value: unknown;
    try {
      value = JSON.parse(rawText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return finish([`manifest: malformed JSON: ${msg}`]);
    }

    // Structural + encode/decode without disk first
    diags.push(
      ...diagnoseManifestValue(value, {
        rawText,
        checkCanonical: true,
      }),
    );

    // Disk checks (async): only for canonical binary entries (gates path traversal).
    if (isPlainObject(value) && Array.isArray(value.fixtures)) {
      let expectedBins: Map<string, Uint8Array> | null = null;
      try {
        expectedBins = buildManifest().binaries;
      } catch {
        // already reported via diagnose
      }

      const expectedPaths = new Set<string>();
      for (const raw of value.fixtures) {
        if (!isPlainObject(raw)) continue;
        const canon = isCanonicalBinaryEntry(raw, root);
        if (!canon.ok) {
          // Structural diagnostics already cover unsafe/mismatched paths; never join/read them.
          continue;
        }
        expectedPaths.add(path.posix.basename(canon.relPath));
        if (raw.kind !== "bootstrap" && raw.kind !== "frame") continue;

        const label = `fixture[${raw.id as string}]`;
        let bytes: Uint8Array;
        try {
          bytes = encodeFixtureSource(raw.kind, raw.source);
        } catch {
          continue;
        }
        try {
          const disk = new Uint8Array(await readFile(canon.absPath));
          if (disk.length !== bytes.length || !disk.every((b, i) => b === bytes[i])) {
            pushDiag(diags, `${label}: committed file ${canon.relPath} != reconstructed bytes`);
          }
          if (expectedBins && expectedBins.has(canon.relPath)) {
            const exp = expectedBins.get(canon.relPath)!;
            if (exp.length !== disk.length || !exp.every((b, i) => b === disk[i])) {
              pushDiag(
                diags,
                `${label}: committed file ${canon.relPath} != canonical generator output`,
              );
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pushDiag(diags, `${label}: failed to read ${canon.relPath}: ${msg}`);
        }
      }

      try {
        const diskFiles = sortAscii(
          (await readdir(path.join(root, VALID_DIR_REL))).filter((n) => n.endsWith(".bin")),
        );
        for (const f of diskFiles) {
          if (!expectedPaths.has(f)) {
            pushDiag(diags, `valid/: unexpected file ${f}`);
          }
        }
      } catch {
        pushDiag(diags, `valid/: failed to read ${VALID_DIR_REL}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushDiag(diags, `manifest: unexpected failure: ${msg}`);
  }
  return finish(diags);
}

/** Diagnose an in-memory manifest JSON value (no disk). Never throws. */
export function diagnoseManifest(value: unknown): { ok: boolean; diagnostics: string[] } {
  try {
    const diagnostics = diagnoseManifestValue(value, {
      checkCanonical: false,
    });
    return { ok: diagnostics.length === 0, diagnostics };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish([`manifest: unexpected failure: ${msg}`]);
  }
}

export async function writeFixtures(root: string): Promise<void> {
  const { manifest, binaries } = buildManifest();
  const testdata = path.join(root, FIXTURES_DIR_REL);
  const validDir = path.join(root, VALID_DIR_REL);
  await mkdir(validDir, { recursive: true });

  try {
    const existing = await readdir(validDir);
    const keep = new Set([...binaries.keys()].map((p) => path.posix.basename(p)));
    for (const name of existing) {
      if (name.endsWith(".bin") && !keep.has(name)) {
        await unlink(path.join(validDir, name));
      }
    }
  } catch {
    // ignore
  }

  const sortedPaths = [...binaries.keys()].sort(asciiCompare);
  for (const rel of sortedPaths) {
    await writeFile(path.join(testdata, rel), binaries.get(rel)!);
  }
  await writeFile(path.join(root, MANIFEST_REL), stableManifestJson(manifest));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseCliMode(argv: string[]): { mode: "write" | "check" } | { error: string } {
  const write = argv.filter((a) => a === "--write").length;
  const check = argv.filter((a) => a === "--check").length;
  const unknown = argv.filter((a) => a !== "--write" && a !== "--check");
  if (unknown.length > 0 || write + check !== 1) {
    return { error: "usage: bun run scripts/protocol-fixtures.ts --write|--check" };
  }
  return { mode: write === 1 ? "write" : "check" };
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseCliMode(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const root = process.cwd();
  if (parsed.mode === "write") {
    await writeFixtures(root);
    const { manifest } = buildManifest();
    console.log(
      `status=ok mode=write fixtures=${manifest.fixtures.length} manifest=${MANIFEST_REL}`,
    );
    return 0;
  }
  const result = await checkFixtures(root);
  if (!result.ok) {
    for (const d of result.diagnostics) console.error(d);
    console.error(`status=fail diagnostics=${result.diagnostics.length}`);
    return 1;
  }
  const { manifest } = buildManifest();
  console.log(
    `status=ok mode=check fixtures=${manifest.fixtures.length} schema_version=${SCHEMA_VERSION}`,
  );
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
