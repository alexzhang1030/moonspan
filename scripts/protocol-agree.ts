#!/usr/bin/env bun
/**
 * R2WP v0 cross-language agreement expected corpus (M0-03h1).
 *
 * TypeScript projector plus canonical expected.json writer/checker.
 * Rust and MoonBit adapters arrive in later batches; the full three-language
 * gate remains active after this slice.
 *
 * --write-expected  regenerate protocol/testdata/agreement/expected.json
 * --check-expected  rebuild in memory and byte-compare the committed file
 *
 * Outputs are deterministic and free of wall-clock timestamps and host paths.
 * Large payload bodies are stored as length plus fnv1a64 digests.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  BootstrapCodecError,
  decodeBootstrapRecord,
  type BootstrapRecord,
} from "../sdk/typescript/src/protocol/bootstrap.ts";
import type { CborValue } from "../sdk/typescript/src/protocol/cbor.ts";
import type { ControlMessage } from "../sdk/typescript/src/protocol/control.ts";
import {
  FrameCodecError,
  FRAME_HEADER_LENGTH,
  decodeFrame,
  type DecodedFrame,
  type FrameCodecOptions,
} from "../sdk/typescript/src/protocol/frame.ts";
import {
  diagnoseManifestValue as diagnoseValidManifestValue,
  encodeFixtureSource,
  type FixtureKind,
} from "./protocol-fixtures.ts";
import {
  diagnoseManifest as diagnoseMalformedManifest,
  ensureRealDirectoryChain,
  loadRegistryIndex as loadMalformedRegistryIndex,
} from "./protocol-malformed-fixtures.ts";
import { diagnoseParityValue } from "./protocol-parity-fixtures.ts";
import { diagnoseManifestValue as diagnoseSequenceManifestValue } from "./protocol-sequence-fixtures.ts";

// ---------------------------------------------------------------------------
// Paths / constants
// ---------------------------------------------------------------------------

export const GENERATED_BY = "scripts/protocol-agree.ts";
export const PROTOCOL_ID = "r2wp-v0";
export const SCHEMA_VERSION = 1;
export const BATCH_ID = "M0-03h1";

export const VALID_MANIFEST_REL = "protocol/testdata/manifest.json";
export const MALFORMED_MANIFEST_REL = "protocol/testdata/malformed/manifest.json";
export const SEQUENCES_MANIFEST_REL = "protocol/testdata/sequences/manifest.json";
export const PARITY_REL = "protocol/testdata/parity.json";
export const REGISTRY_REL = "protocol/registry/r2wp-v0.json";
export const EXPECTED_REL = "protocol/testdata/agreement/expected.json";
export const AGREEMENT_DIR_REL = "protocol/testdata/agreement";
export const TESTDATA_REL = "protocol/testdata";
export const SEQUENCES_DIR_REL = "protocol/testdata/sequences";

export const OUTCOMES_TOTAL = 105;
export const VALID_TOTAL = 22;
export const SEQUENCES_TOTAL = 28;
export const MALFORMED_TOTAL = 55;
export const PARITY_SHARED_TOTAL = 50;
export const PARITY_RULES_TOTAL = 20;
export const PHASE_ONE_ROWS = ["H-FT", "H-CY", "H-ZN", "J-FT", "J-CY", "J-ZN"] as const;

export const PHASE_ONE_TRIPLES: ReadonlyArray<{
  support_row_id: string;
  ros_distro: string;
  rmw_identifier: string;
}> = [
  { support_row_id: "H-FT", ros_distro: "humble", rmw_identifier: "rmw_fastrtps_cpp" },
  { support_row_id: "H-CY", ros_distro: "humble", rmw_identifier: "rmw_cyclonedds_cpp" },
  { support_row_id: "H-ZN", ros_distro: "humble", rmw_identifier: "rmw_zenoh_cpp" },
  { support_row_id: "J-FT", ros_distro: "jazzy", rmw_identifier: "rmw_fastrtps_cpp" },
  { support_row_id: "J-CY", ros_distro: "jazzy", rmw_identifier: "rmw_cyclonedds_cpp" },
  { support_row_id: "J-ZN", ros_distro: "jazzy", rmw_identifier: "rmw_zenoh_cpp" },
];

export const RECIPE_ID = "frame-app-payload-64mib-recipe";
export const RECIPE_PAYLOAD_FNV1A64_HEX = "3a07afcfc8222325";
export const RECIPE_PAYLOAD_LENGTH = 67_108_864;
export const RECIPE_BYTE_LENGTH = 67_108_896;
export const HEAD_TAIL_HEX_BYTES = 8;
export const TEXT_INLINE_MAX_BYTES = 64;
export const BYTES_INLINE_MAX_BYTES = 32;
export const EMPTY_PAYLOAD_FNV1A64_HEX = "cbf29ce484222325";

/** Fixed v0 absolute ceilings used by closed diagnoseAgreeDocument. */
const FRAME_PAYLOAD_MAX_BYTES = 67_108_864;
const CONTROL_PAYLOAD_MAX_BYTES = 1_048_576;
const EXTENSION_AREA_MAX_BYTES = 4096;
const EXTENSION_ALIGNMENT = 4;
const UTF8_TEXT_MAX_BYTES = 4096;
const WIRE_VERSIONS_MAX = 16;
const CONTROL_MAP_ENTRIES_MAX = 4096;
const EFFECTIVE_MAX_CHANNELS = 65535;
const EFFECTIVE_MAX_SESSION_BYTES = 4_294_967_296n;
const EFFECTIVE_MAX_MESSAGE_BYTES = 67_108_864;
const EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES = 1_048_576;
const BOOTSTRAP_ERROR_CODES = new Set([1, 2, 4, 16, 24, 25]);
const OPCODE_CONTROL_CBOR = 1;
const OPCODE_ROS_SAMPLE = 2;
const OPCODE_MEDIA_CHUNK = 10;
const OPCODE_ASSIGNED_MIN = 1;
const OPCODE_ASSIGNED_MAX = 12;
const FLAG_ROS_RELIABLE = 0x0001;
const FLAG_KEYFRAME = 0x0002;
const FLAG_TRACE_PRESENT = 0x0004;
const FLAG_RETAINED = 0x0008;
const FLAG_FRAGMENT = 0x0010;
const FLAG_ASSIGNED_MASK = 0x001f;
const TRACE_CONTEXT_TYPE = 1;
const OPERATION_ID_TYPE = 2;
const TRACE_CONTEXT_VALUE_LEN = 32;
const OPERATION_ID_VALUE_LEN = 16;

export const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const REGISTRY_MAX_BYTES = 2 * 1024 * 1024;
export const PARITY_MAX_BYTES = 2 * 1024 * 1024;
export const EXPECTED_MAX_BYTES = 8 * 1024 * 1024;
export const BINARY_MAX_BYTES = 2 * 1024 * 1024;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FNV_HEX_PATTERN = /^[0-9a-f]{16}$/;
const ID_TOKEN = /^[A-Za-z0-9_.:-]{1,160}$/;
const SOURCE_ID_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_TOKEN = /^[a-z][a-z0-9_]{0,127}$/;
const CORPUS_SET = new Set(["valid_boundary", "sequences", "malformed"]);
const PARSER_SET = new Set(["bootstrap", "frame"]);
const REPR_SET = new Set(["binary", "segment_recipe"]);
const STATUS_SET = new Set(["success", "error"]);
const PLANE_SET = new Set(["bootstrap", "selected_frame"]);
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const INT64_MIN = -0x8000_0000_0000_0000n;
const INT64_MAX = 0x7fff_ffff_ffff_ffffn;

const CONTROL_KEY_KIND = 1;
const CONTROL_KEY_SUPPORT_ROW = 8;
const CONTROL_KEY_ROS_DISTRO = 18;
const CONTROL_KEY_RMW = 19;
const CONTROL_KIND_SESSION_READY = 2;

const SOURCE_PATH_CONSTANTS: Record<string, string> = {
  valid_manifest: VALID_MANIFEST_REL,
  malformed_manifest: MALFORMED_MANIFEST_REL,
  sequences_manifest: SEQUENCES_MANIFEST_REL,
  parity: PARITY_REL,
  registry: REGISTRY_REL,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgreeStatus = "success" | "error";
export type CorpusName = "valid_boundary" | "sequences" | "malformed";
export type ParserKind = "bootstrap" | "frame";

export type AgreeError = {
  code: number;
  name: string;
  reason: string;
  offset: number;
  plane: string;
  step: number;
};

export type TextDigest = {
  utf8_byte_length: number;
  fnv1a64_hex: string;
};

export type CborAgreeValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "uint"; v: string }
  | { t: "nint"; v: string }
  | {
      t: "text";
      utf8_byte_length: number;
      fnv1a64_hex: string;
      inline: string | null;
    }
  | {
      t: "bytes";
      byte_length: number;
      fnv1a64_hex: string;
      inline_hex: string | null;
    }
  | { t: "array"; items: CborAgreeValue[] }
  | { t: "map"; entries: Array<{ key: string; value: CborAgreeValue }> };

export type BootstrapAgreeRecord =
  | {
      variant: "client_hello";
      wire_versions: number[];
      transport_capabilities: {
        webtransport_http3: boolean;
        binary_wss: boolean;
        max_datagram_size: number | null;
      };
      buffer_capabilities: {
        transferable_arraybuffer: boolean;
        shared_arraybuffer: boolean;
      };
      requested_limits: {
        max_channels: number | null;
        max_session_bytes: string | null;
        max_message_bytes: number | null;
        max_control_payload_bytes: number | null;
      };
      extension_capabilities: number[];
    }
  | {
      variant: "server_hello";
      selected_wire_version: number;
      transport_capabilities: {
        webtransport_http3: boolean;
        binary_wss: boolean;
        max_datagram_size: number | null;
      };
      buffer_capabilities: {
        transferable_arraybuffer: boolean;
        shared_arraybuffer: boolean;
      };
      effective_limits: {
        max_channels: number;
        max_session_bytes: string;
        max_message_bytes: number;
        max_control_payload_bytes: number;
      };
      extension_capabilities: number[];
    }
  | {
      variant: "bootstrap_error";
      code: number;
      message: TextDigest | null;
      detail: TextDigest | null;
    };

export type ExtensionAgree = {
  type_id: number;
  critical: boolean;
  value_len: number;
  value_fnv1a64_hex: string;
};

export type PayloadAgree =
  | {
      form: "application";
      payload_len: number;
      payload_fnv1a64_hex: string;
      payload_head_hex: string;
      payload_tail_hex: string;
    }
  | {
      form: "control";
      payload_len: number;
      payload_fnv1a64_hex: string;
      control_kind: number;
      control_field_keys: number[];
      control_fields: CborAgreeValue;
    };

export type FrameAgreeRecord = {
  version: number;
  opcode: number;
  flags: number;
  channel_id: number;
  sequence: string;
  source_time_ns: string;
  payload_len: number;
  extension_len: number;
  priority: number;
  clock_id: number;
  extensions: ExtensionAgree[];
  payload: PayloadAgree;
};

export type AgreeOutcome = {
  id: string;
  corpus: CorpusName;
  source_id: string;
  parser_kind: ParserKind;
  representation: "binary" | "segment_recipe";
  byte_length: number;
  input_sha256: string;
  status: AgreeStatus;
  record: BootstrapAgreeRecord | FrameAgreeRecord | null;
  error: AgreeError | null;
};

export type TransportBinding = {
  id: string;
  source_corpus: string;
  source_id: string;
  byte_length: number;
  sha256: string;
  outcome_id: string;
  webtransport: {
    semantic_identity: string;
    byte_length: number;
    sha256: string;
  };
  binary_wss: {
    semantic_identity: string;
    byte_length: number;
    sha256: string;
  };
  equal_wt_wss: true;
};

export type SourceProvenance = {
  path: string;
  sha256: string;
};

export type AgreeDocument = {
  schema_version: number;
  protocol: string;
  generated_by: string;
  batch: string;
  counts: {
    outcomes_total: number;
    valid_boundary: number;
    sequences: number;
    malformed: number;
    parity_shared_artifacts: number;
    parity_transport_rules: number;
  };
  phase_one_rows: string[];
  phase_one_triples: Array<{
    support_row_id: string;
    ros_distro: string;
    rmw_identifier: string;
  }>;
  sources: {
    valid_manifest: SourceProvenance;
    malformed_manifest: SourceProvenance;
    sequences_manifest: SourceProvenance;
    parity: SourceProvenance;
    registry: SourceProvenance;
  };
  transport_bindings: TransportBinding[];
  outcomes: AgreeOutcome[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function repoRootFrom(importMetaDir: string): string {
  return path.resolve(importMetaDir, "..");
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fnv1a64Hex(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function intToDecimalString(value: number | bigint): string {
  if (typeof value === "bigint") return value.toString(10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`intToDecimalString requires a Number.isSafeInteger value or bigint`);
  }
  return String(value);
}

export function headTailHex(
  bytes: Uint8Array,
  n: number = HEAD_TAIL_HEX_BYTES,
): { head: string; tail: string } {
  if (bytes.length === 0) return { head: "", tail: "" };
  const h = bytes.subarray(0, Math.min(n, bytes.length));
  const t = bytes.length <= n ? bytes : bytes.subarray(bytes.length - n);
  return { head: toHex(h), tail: toHex(t) };
}

export function textDigest(text: string): TextDigest {
  const utf8 = new TextEncoder().encode(text);
  return { utf8_byte_length: utf8.length, fnv1a64_hex: fnv1a64Hex(utf8) };
}

export function corpusQualifiedId(corpus: CorpusName, sourceId: string): string {
  return `${corpus}:${sourceId}`;
}

export function parseCliMode(
  argv: string[],
): { mode: "write-expected" | "check-expected" } | { error: string } {
  if (argv.length !== 1) {
    return { error: "require exactly one of --write-expected or --check-expected" };
  }
  if (argv[0] === "--write-expected") return { mode: "write-expected" };
  if (argv[0] === "--check-expected") return { mode: "check-expected" };
  return { error: `unknown mode ${argv[0]}` };
}

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Uint8Array)
  );
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort(asciiCompare)) {
      out[k] = sortKeysDeep(value[k]);
    }
    return out;
  }
  return value;
}

/** Reviewable canonical JSON: recursive key sort, two-space indent, trailing newline. */
export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/** Compact one-line key-sorted JSON (available for later line-protocol hashing). */
export function stableJsonCompact(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function exactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  pathLabel: string,
  diags: string[],
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) diags.push(`${pathLabel}: unknown key "${k}"`);
  }
  for (const k of allowed) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) {
      diags.push(`${pathLabel}: missing key "${k}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// CBOR agreement projection
// ---------------------------------------------------------------------------

export function projectCborValue(value: CborValue, depth = 0): CborAgreeValue {
  if (depth > 16) throw new Error("cbor projection depth exceeds 16");
  if (value === null) return { t: "null" };
  if (typeof value === "boolean") return { t: "bool", v: value };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("cbor number requires a Number.isSafeInteger value");
    }
    if (value >= 0) return { t: "uint", v: String(value) };
    return { t: "nint", v: String(value) };
  }
  if (typeof value === "bigint") {
    if (value >= 0n) return { t: "uint", v: value.toString(10) };
    return { t: "nint", v: value.toString(10) };
  }
  if (typeof value === "string") {
    const utf8 = new TextEncoder().encode(value);
    return {
      t: "text",
      utf8_byte_length: utf8.length,
      fnv1a64_hex: fnv1a64Hex(utf8),
      inline: utf8.length <= TEXT_INLINE_MAX_BYTES ? value : null,
    };
  }
  if (value instanceof Uint8Array) {
    return {
      t: "bytes",
      byte_length: value.length,
      fnv1a64_hex: fnv1a64Hex(value),
      inline_hex: value.length <= BYTES_INLINE_MAX_BYTES ? toHex(value) : null,
    };
  }
  if (Array.isArray(value)) {
    return {
      t: "array",
      items: value.map((item) => projectCborValue(item as CborValue, depth + 1)),
    };
  }
  if (value instanceof Map) {
    const entries: Array<{ key: string; value: CborAgreeValue }> = [];
    for (const [k, v] of value.entries()) {
      const key =
        typeof k === "bigint"
          ? k.toString(10)
          : typeof k === "number"
            ? String(k)
            : (() => {
                throw new Error("cbor map key must be unsigned integer");
              })();
      entries.push({ key, value: projectCborValue(v as CborValue, depth + 1) });
    }
    entries.sort((a, b) => {
      const an = BigInt(a.key);
      const bn = BigInt(b.key);
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return { t: "map", entries };
  }
  throw new Error("unsupported cbor value shape");
}

// ---------------------------------------------------------------------------
// Projectors
// ---------------------------------------------------------------------------

export function projectBootstrap(record: BootstrapRecord): BootstrapAgreeRecord {
  if (record.kind === "client_hello") {
    return {
      variant: "client_hello",
      wire_versions: [...record.wireVersions],
      transport_capabilities: {
        webtransport_http3: record.transportCapabilities.webtransportHttp3,
        binary_wss: record.transportCapabilities.binaryWss,
        max_datagram_size:
          record.transportCapabilities.maxDatagramSize === undefined
            ? null
            : Number(record.transportCapabilities.maxDatagramSize),
      },
      buffer_capabilities: {
        transferable_arraybuffer: record.bufferCapabilities.transferableArraybuffer,
        shared_arraybuffer: record.bufferCapabilities.sharedArraybuffer,
      },
      requested_limits: {
        max_channels:
          record.requestedLimits.maxChannels === undefined
            ? null
            : Number(record.requestedLimits.maxChannels),
        max_session_bytes:
          record.requestedLimits.maxSessionBytes === undefined
            ? null
            : intToDecimalString(record.requestedLimits.maxSessionBytes),
        max_message_bytes:
          record.requestedLimits.maxMessageBytes === undefined
            ? null
            : Number(record.requestedLimits.maxMessageBytes),
        max_control_payload_bytes:
          record.requestedLimits.maxControlPayloadBytes === undefined
            ? null
            : Number(record.requestedLimits.maxControlPayloadBytes),
      },
      extension_capabilities: [...record.extensionCapabilities],
    };
  }
  if (record.kind === "server_hello") {
    return {
      variant: "server_hello",
      selected_wire_version: record.selectedWireVersion,
      transport_capabilities: {
        webtransport_http3: record.transportCapabilities.webtransportHttp3,
        binary_wss: record.transportCapabilities.binaryWss,
        max_datagram_size:
          record.transportCapabilities.maxDatagramSize === undefined
            ? null
            : Number(record.transportCapabilities.maxDatagramSize),
      },
      buffer_capabilities: {
        transferable_arraybuffer: record.bufferCapabilities.transferableArraybuffer,
        shared_arraybuffer: record.bufferCapabilities.sharedArraybuffer,
      },
      effective_limits: {
        max_channels: Number(record.effectiveLimits.maxChannels),
        max_session_bytes: intToDecimalString(record.effectiveLimits.maxSessionBytes),
        max_message_bytes: Number(record.effectiveLimits.maxMessageBytes),
        max_control_payload_bytes: Number(
          record.effectiveLimits.maxControlPayloadBytes,
        ),
      },
      extension_capabilities: [...record.extensionCapabilities],
    };
  }
  return {
    variant: "bootstrap_error",
    code: record.code,
    message: record.message === undefined ? null : textDigest(record.message),
    detail: record.detail === undefined ? null : textDigest(record.detail),
  };
}

function projectControlPayload(
  msg: ControlMessage,
  rawPayload: Uint8Array,
): PayloadAgree {
  const keys: number[] = [];
  for (const k of msg.keys()) {
    if (typeof k === "bigint") {
      if (k < 0n || k > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          `CONTROL map key requires a non-negative Number.isSafeInteger range: ${k.toString(10)}`,
        );
      }
      keys.push(Number(k));
    } else if (typeof k === "number") {
      if (!Number.isSafeInteger(k) || k < 0) {
        throw new Error(
          `CONTROL map key requires a non-negative Number.isSafeInteger value: ${String(k)}`,
        );
      }
      keys.push(k);
    } else {
      throw new Error("CONTROL map key must be an unsigned integer");
    }
  }
  keys.sort((a, b) => a - b);
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] === keys[i - 1]) {
      throw new Error(`CONTROL map has duplicate key ${keys[i]}`);
    }
  }
  const kindVal = msg.get(CONTROL_KEY_KIND);
  let controlKind = -1;
  if (typeof kindVal === "number" && Number.isSafeInteger(kindVal)) controlKind = kindVal;
  else if (typeof kindVal === "bigint") {
    if (kindVal < 0n || kindVal > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`CONTROL kind out of safe range`);
    }
    controlKind = Number(kindVal);
  }
  if (controlKind < 1 || controlKind > 15) {
    throw new Error(`CONTROL kind out of range: ${String(kindVal)}`);
  }
  return {
    form: "control",
    payload_len: rawPayload.length,
    payload_fnv1a64_hex: fnv1a64Hex(rawPayload),
    control_kind: controlKind,
    control_field_keys: keys,
    control_fields: projectCborValue(msg),
  };
}

export function projectFrame(
  frame: DecodedFrame,
  rawBytes: Uint8Array,
): FrameAgreeRecord {
  const payloadStart = FRAME_HEADER_LENGTH + frame.extensionLen;
  const payloadEnd = payloadStart + frame.payloadLen;
  if (payloadEnd > rawBytes.length) throw new Error("frame payload range exceeds input");
  const rawPayload = rawBytes.subarray(payloadStart, payloadEnd);

  const extensions: ExtensionAgree[] = frame.extensions.map((e) => ({
    type_id: e.type,
    critical: e.critical,
    value_len: e.value.length,
    value_fnv1a64_hex: fnv1a64Hex(e.value),
  }));

  let payload: PayloadAgree;
  if (frame.payload instanceof Uint8Array) {
    const ht = headTailHex(frame.payload);
    payload = {
      form: "application",
      payload_len: frame.payload.length,
      payload_fnv1a64_hex: fnv1a64Hex(frame.payload),
      payload_head_hex: ht.head,
      payload_tail_hex: ht.tail,
    };
  } else {
    payload = projectControlPayload(frame.payload, rawPayload);
  }

  return {
    version: frame.version,
    opcode: frame.opcode,
    flags: frame.flags,
    channel_id: frame.channelId >>> 0,
    sequence: intToDecimalString(frame.sequence),
    source_time_ns: intToDecimalString(frame.sourceTimeNs),
    payload_len: frame.payloadLen,
    extension_len: frame.extensionLen,
    priority: frame.priority,
    clock_id: frame.clockId,
    extensions,
    payload,
  };
}

export function frameOptionsFromContext(
  ctx: Record<string, unknown> | null | undefined,
): FrameCodecOptions {
  const opts: FrameCodecOptions = {
    selectedVersion: 0,
    experimentalOpcodesEnabled: false,
    availableClockIds: [0, 1, 2, 3, 4],
  };
  if (!ctx || !isPlainObject(ctx)) return opts;
  const keys = Object.keys(ctx).sort(asciiCompare);
  const allowed = [
    "selectedVersion",
    "experimentalOpcodesEnabled",
    "availableClockIds",
  ];
  for (const k of keys) {
    if (!allowed.includes(k)) throw new Error(`decoder_context unknown key ${k}`);
  }
  if (ctx.selectedVersion !== undefined) {
    if (
      typeof ctx.selectedVersion !== "number" ||
      !Number.isSafeInteger(ctx.selectedVersion) ||
      ctx.selectedVersion < 0 ||
      ctx.selectedVersion > 255
    ) {
      throw new Error("decoder_context.selectedVersion");
    }
    opts.selectedVersion = ctx.selectedVersion;
  }
  if (ctx.experimentalOpcodesEnabled !== undefined) {
    if (typeof ctx.experimentalOpcodesEnabled !== "boolean") {
      throw new Error("decoder_context.experimentalOpcodesEnabled");
    }
    opts.experimentalOpcodesEnabled = ctx.experimentalOpcodesEnabled;
  }
  if (ctx.availableClockIds !== undefined) {
    if (!Array.isArray(ctx.availableClockIds)) {
      throw new Error("decoder_context.availableClockIds");
    }
    const ids: number[] = [];
    for (const x of ctx.availableClockIds) {
      if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0 || x > 4) {
        throw new Error("decoder_context.availableClockIds element");
      }
      ids.push(x);
    }
    for (let i = 1; i < ids.length; i++) {
      if (ids[i]! <= ids[i - 1]!) {
        throw new Error("decoder_context.availableClockIds must be strictly ascending unique");
      }
    }
    opts.availableClockIds = ids;
  }
  return opts;
}

export function extractSessionReadyTriple(
  payload: PayloadAgree,
): { support_row_id: string; ros_distro: string; rmw_identifier: string } | null {
  if (payload.form !== "control" || payload.control_kind !== CONTROL_KIND_SESSION_READY) {
    return null;
  }
  if (payload.control_fields.t !== "map") return null;
  const getText = (keyNum: number): string | null => {
    const key = String(keyNum);
    const ent = payload.control_fields.entries.find((e) => e.key === key);
    if (!ent || ent.value.t !== "text") return null;
    return ent.value.inline ?? null;
  };
  const support_row_id = getText(CONTROL_KEY_SUPPORT_ROW);
  const ros_distro = getText(CONTROL_KEY_ROS_DISTRO);
  const rmw_identifier = getText(CONTROL_KEY_RMW);
  if (!support_row_id || !ros_distro || !rmw_identifier) return null;
  return { support_row_id, ros_distro, rmw_identifier };
}

// ---------------------------------------------------------------------------
// Path / I/O hardening
// ---------------------------------------------------------------------------

export function resolveUnderRoot(
  root: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (path.isAbsolute(rel)) return { ok: false, error: `absolute path rejected: ${rel}` };
  if (rel.includes("\0")) return { ok: false, error: "nul in path" };
  if (rel.includes("\\")) return { ok: false, error: "backslash path rejected" };
  if (rel.includes("//")) return { ok: false, error: `noncanonical relative path: ${rel}` };
  const segments = rel.split("/");
  if (segments.some((p) => p === "" || p === "." || p === "..")) {
    return { ok: false, error: "dot segment or empty segment path rejected" };
  }
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `path escapes root: ${rel}` };
  }
  return { ok: true, abs };
}

export async function ensureAncestorDirs(
  root: string,
  relFile: string,
  createMissing: boolean,
): Promise<void> {
  const parts = relFile.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("empty relative path");
  const dirParts = parts.slice(0, -1);
  await ensureRealDirectoryChain(root, dirParts, createMissing);
}

async function lstatRegularFile(
  absPath: string,
  maxBytes: number,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) return { ok: false, error: "symlink file rejected" };
    if (!st.isFile()) return { ok: false, error: "path must be a regular file" };
    if (st.size > maxBytes) {
      return { ok: false, error: `file size ${st.size} exceeds max ${maxBytes}` };
    }
    return { ok: true, size: st.size };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") return { ok: false, error: "ENOENT" };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readBoundedText(
  root: string,
  rel: string,
  maxBytes: number,
): Promise<{ ok: true; text: string; abs: string } | { ok: false; error: string }> {
  const resolved = resolveUnderRoot(root, rel);
  if (!resolved.ok) return resolved;
  try {
    await ensureAncestorDirs(root, rel, false);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const meta = await lstatRegularFile(resolved.abs, maxBytes);
  if (!meta.ok) return meta;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(resolved.abs, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > maxBytes) {
        return { ok: false, error: "opened handle must be a bounded regular file" };
      }
      const buf = await fh.readFile();
      if (buf.byteLength > maxBytes) {
        return { ok: false, error: `read size exceeds max ${maxBytes}` };
      }
      return { ok: true, text: buf.toString("utf8"), abs: resolved.abs };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readBoundedBytes(
  root: string,
  rel: string,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const resolved = resolveUnderRoot(root, rel);
  if (!resolved.ok) return resolved;
  try {
    await ensureAncestorDirs(root, rel, false);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const meta = await lstatRegularFile(resolved.abs, maxBytes);
  if (!meta.ok) return meta;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(resolved.abs, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > maxBytes) {
        return { ok: false, error: "opened handle invalid" };
      }
      const buf = await fh.readFile();
      if (buf.byteLength > maxBytes) {
        return { ok: false, error: `read size exceeds max ${maxBytes}` };
      }
      return { ok: true, bytes: new Uint8Array(buf) };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function writeBoundedTextAtomic(
  root: string,
  rel: string,
  text: string,
  maxBytes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `write size ${bytes.byteLength} exceeds max ${maxBytes}` };
  }
  const resolved = resolveUnderRoot(root, rel);
  if (!resolved.ok) return resolved;
  try {
    await ensureAncestorDirs(root, rel, true);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Write targets must be regular paths: reject symlinks; treat ENOENT as a creatable absence.
  try {
    const st = await lstat(resolved.abs);
    if (st.isSymbolicLink()) return { ok: false, error: "symlink write target rejected" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (!err || err.code !== "ENOENT") {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const tmpRel = `${rel}.tmp`;
  const tmpResolved = resolveUnderRoot(root, tmpRel);
  if (!tmpResolved.ok) return tmpResolved;
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(tmpResolved.abs, flags, 0o644);
    try {
      await fh.writeFile(bytes);
    } finally {
      await fh.close();
    }
    await rename(tmpResolved.abs, resolved.abs);
    return { ok: true };
  } catch (e) {
    try {
      await unlink(tmpResolved.abs);
    } catch {
      // ignore cleanup
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Source load + validate
// ---------------------------------------------------------------------------

type LoadedJson = { json: unknown; text: string; sha: string };

async function loadAndValidateJson(
  root: string,
  rel: string,
  maxBytes: number,
  validate: (json: unknown, text: string) => string[],
): Promise<LoadedJson> {
  const read = await readBoundedText(root, rel, maxBytes);
  if (!read.ok) throw new Error(`${rel}: ${read.error}`);
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch (e) {
    throw new Error(
      `${rel}: malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const diags = validate(json, read.text);
  if (diags.length > 0) {
    throw new Error(`${rel}: validation failed:\n${diags.join("\n")}`);
  }
  return { json, text: read.text, sha: sha256Hex(read.text) };
}

export async function loadValidatedSources(root: string): Promise<{
  valid: LoadedJson;
  malformed: LoadedJson;
  sequences: LoadedJson;
  parity: LoadedJson;
  registry: LoadedJson;
  registryIndex: ReturnType<typeof loadMalformedRegistryIndex>;
}> {
  const registry = await loadAndValidateJson(
    root,
    REGISTRY_REL,
    REGISTRY_MAX_BYTES,
    (json) => {
      try {
        loadMalformedRegistryIndex(json);
        return [];
      } catch (e) {
        return [e instanceof Error ? e.message : String(e)];
      }
    },
  );
  const registryIndex = loadMalformedRegistryIndex(registry.json);

  const valid = await loadAndValidateJson(
    root,
    VALID_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    (json, text) =>
      diagnoseValidManifestValue(json, { rawText: text, checkCanonical: true }),
  );

  const malformed = await loadAndValidateJson(
    root,
    MALFORMED_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    (json) => diagnoseMalformedManifest(json, registryIndex),
  );

  const sequences = await loadAndValidateJson(
    root,
    SEQUENCES_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    (json) => diagnoseSequenceManifestValue(json),
  );

  const parity = await loadAndValidateJson(
    root,
    PARITY_REL,
    PARITY_MAX_BYTES,
    (json) => diagnoseParityValue(json),
  );

  return { valid, malformed, sequences, parity, registry, registryIndex };
}

async function loadBinary(
  root: string,
  rel: string,
  expectedLen: number,
  expectedSha: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const read = await readBoundedBytes(root, rel, maxBytes);
  if (!read.ok) throw new Error(`${rel}: ${read.error}`);
  if (read.bytes.length !== expectedLen) {
    throw new Error(`${rel}: length ${read.bytes.length} != ${expectedLen}`);
  }
  const sha = sha256Hex(read.bytes);
  if (sha !== expectedSha) throw new Error(`${rel}: sha256 mismatch`);
  return read.bytes;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildAgreeDocument(root: string): Promise<AgreeDocument> {
  const src = await loadValidatedSources(root);
  const regMap = new Map<string, number>();
  for (const [codeStr, info] of Object.entries(src.registryIndex.errors)) {
    regMap.set(info.name, Number(codeStr));
  }

  const outcomes: AgreeOutcome[] = [];
  let recipeMaterialized = false;

  // valid
  const validFixtures = (src.valid.json as { fixtures: unknown[] }).fixtures;
  for (const raw of validFixtures) {
    if (!isPlainObject(raw)) throw new Error("valid fixture must be an object");
    const id = String(raw.id);
    const kind = raw.kind as FixtureKind;
    const representation = raw.representation as "binary" | "segment_recipe";
    const byteLength = Number(raw.byte_length);
    const sha = String(raw.sha256);

    let bytes: Uint8Array;
    if (representation === "segment_recipe") {
      if (id !== RECIPE_ID) throw new Error(`unexpected segment recipe ${id}`);
      if (recipeMaterialized) throw new Error("64 MiB recipe materialized twice");
      if (!isPlainObject(raw.source)) throw new Error(`${id}: source`);
      bytes = encodeFixtureSource("frame", raw.source);
      recipeMaterialized = true;
      if (bytes.length !== RECIPE_BYTE_LENGTH || bytes.length !== byteLength) {
        throw new Error(`${id}: encodeFixtureSource length ${bytes.length}`);
      }
      if (sha256Hex(bytes) !== sha) throw new Error(`${id}: encodeFixtureSource sha256`);
    } else {
      if (typeof raw.path !== "string") throw new Error(`${id}: path`);
      const rel = path.posix.join(TESTDATA_REL, raw.path);
      bytes = await loadBinary(root, rel, byteLength, sha, BINARY_MAX_BYTES);
    }

    const parserKind: ParserKind = kind === "bootstrap" ? "bootstrap" : "frame";
    let record: BootstrapAgreeRecord | FrameAgreeRecord;
    if (parserKind === "bootstrap") {
      record = projectBootstrap(decodeBootstrapRecord(bytes));
    } else {
      record = projectFrame(decodeFrame(bytes), bytes);
      if (
        id === RECIPE_ID &&
        record.payload.form === "application" &&
        record.payload.payload_fnv1a64_hex !== RECIPE_PAYLOAD_FNV1A64_HEX
      ) {
        throw new Error(`64 MiB FNV mismatch ${record.payload.payload_fnv1a64_hex}`);
      }
    }

    outcomes.push({
      id: corpusQualifiedId("valid_boundary", id),
      corpus: "valid_boundary",
      source_id: id,
      parser_kind: parserKind,
      representation,
      byte_length: byteLength,
      input_sha256: sha,
      status: "success",
      record,
      error: null,
    });
  }
  if (!recipeMaterialized) {
    throw new Error("valid corpus requires the 64 MiB segment_recipe");
  }

  // sequences — carrier selects parser after validator acceptance
  const events = (src.sequences.json as { events: unknown[] }).events;
  for (const raw of events) {
    if (!isPlainObject(raw)) throw new Error("sequence event must be an object");
    const id = String(raw.id);
    const byteLength = Number(raw.byte_length);
    const sha = String(raw.sha256);
    const eventPath = String(raw.path);
    const carrier = String(raw.carrier);
    const rel = path.posix.join(SEQUENCES_DIR_REL, eventPath);
    const bytes = await loadBinary(root, rel, byteLength, sha, BINARY_MAX_BYTES);
    const parserKind: ParserKind = carrier === "bootstrap" ? "bootstrap" : "frame";
    const record =
      parserKind === "bootstrap"
        ? projectBootstrap(decodeBootstrapRecord(bytes))
        : projectFrame(decodeFrame(bytes), bytes);
    outcomes.push({
      id: corpusQualifiedId("sequences", id),
      corpus: "sequences",
      source_id: id,
      parser_kind: parserKind,
      representation: "binary",
      byte_length: byteLength,
      input_sha256: sha,
      status: "success",
      record,
      error: null,
    });
  }

  // malformed
  const malFixtures = (src.malformed.json as { fixtures: unknown[] }).fixtures;
  for (const raw of malFixtures) {
    if (!isPlainObject(raw)) throw new Error("malformed fixture must be an object");
    const id = String(raw.id);
    const kind = raw.kind as ParserKind;
    const byteLength = Number(raw.byte_length);
    const sha = String(raw.sha256);
    const fixturePath = String(raw.path);
    if (!isPlainObject(raw.expected)) throw new Error(`${id}: expected`);
    const expected = raw.expected;
    const oracle: AgreeError = {
      code: Number(expected.registry_code),
      name: String(expected.registry_name),
      reason: String(expected.reason),
      offset: Number(expected.offset),
      plane: String(expected.plane),
      step: Number(expected.step),
    };
    const regCode = regMap.get(oracle.name);
    if (regCode !== oracle.code) {
      throw new Error(`${id}: registry name/code mismatch`);
    }
    const rel = path.posix.join(TESTDATA_REL, fixturePath);
    const bytes = await loadBinary(root, rel, byteLength, sha, BINARY_MAX_BYTES);
    const ctx = isPlainObject(raw.decoder_context) ? raw.decoder_context : null;
    const opts = frameOptionsFromContext(ctx);

    let thrown: { name: string; reason: string; offset: number } | null = null;
    try {
      if (kind === "bootstrap") decodeBootstrapRecord(bytes);
      else decodeFrame(bytes, opts);
    } catch (e) {
      if (e instanceof BootstrapCodecError || e instanceof FrameCodecError) {
        thrown = { name: e.code, reason: e.reason, offset: e.offset };
      } else {
        throw new Error(
          `${id}: non-codec throw ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (!thrown) throw new Error(`${id}: expected failure`);
    if (thrown.name !== oracle.name) {
      throw new Error(`${id}: TS name ${thrown.name} != ${oracle.name}`);
    }
    if (thrown.reason !== oracle.reason) {
      throw new Error(`${id}: TS reason ${thrown.reason} != ${oracle.reason}`);
    }
    if (thrown.offset !== oracle.offset) {
      throw new Error(`${id}: TS offset ${thrown.offset} != ${oracle.offset}`);
    }

    outcomes.push({
      id: corpusQualifiedId("malformed", id),
      corpus: "malformed",
      source_id: id,
      parser_kind: kind,
      representation: "binary",
      byte_length: byteLength,
      input_sha256: sha,
      status: "error",
      record: null,
      error: oracle,
    });
  }

  outcomes.sort((a, b) => asciiCompare(a.id, b.id));
  if (outcomes.length !== OUTCOMES_TOTAL) {
    throw new Error(`outcomes total ${outcomes.length}`);
  }
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i]!.id === outcomes[i - 1]!.id) {
      throw new Error(`duplicate outcome id ${outcomes[i]!.id}`);
    }
  }

  const successBySource = new Map<string, AgreeOutcome>();
  for (const o of outcomes) {
    if (o.status === "success") {
      successBySource.set(`${o.corpus}:${o.source_id}`, o);
    }
  }

  // parity cross-bind
  const shared = (src.parity.json as { shared_artifacts: unknown[] }).shared_artifacts;
  const rules = (src.parity.json as { transport_rules: unknown[] }).transport_rules;
  if (shared.length !== PARITY_SHARED_TOTAL) throw new Error("parity shared count");
  if (rules.length !== PARITY_RULES_TOTAL) throw new Error("parity rules count");

  const transport_bindings: TransportBinding[] = [];
  for (const raw of shared) {
    if (!isPlainObject(raw)) throw new Error("shared artifact requires object");
    const id = String(raw.id);
    const source_corpus = String(raw.source_corpus);
    const source_id = String(raw.source_id);
    const byte_length = Number(raw.byte_length);
    const sha256 = String(raw.sha256);
    if (!isPlainObject(raw.webtransport) || !isPlainObject(raw.binary_wss)) {
      throw new Error(`parity ${id}: transports`);
    }
    const wt = {
      semantic_identity: String(raw.webtransport.semantic_identity),
      byte_length: Number(raw.webtransport.byte_length),
      sha256: String(raw.webtransport.sha256),
    };
    const wss = {
      semantic_identity: String(raw.binary_wss.semantic_identity),
      byte_length: Number(raw.binary_wss.byte_length),
      sha256: String(raw.binary_wss.sha256),
    };
    if (
      wt.semantic_identity !== wss.semantic_identity ||
      wt.byte_length !== wss.byte_length ||
      wt.sha256 !== wss.sha256 ||
      wt.byte_length !== byte_length ||
      wt.sha256 !== sha256
    ) {
      throw new Error(`parity ${id}: WT/WSS inequality`);
    }
    // Map parity source_corpus to outcome corpus
    const outcomeCorpus =
      source_corpus === "valid_boundary"
        ? "valid_boundary"
        : source_corpus === "sequences"
          ? "sequences"
          : null;
    if (!outcomeCorpus) throw new Error(`parity ${id}: bad source_corpus`);
    const outcome_id = corpusQualifiedId(outcomeCorpus, source_id);
    const outcome = successBySource.get(outcome_id);
    if (!outcome) throw new Error(`parity ${id}: missing success outcome ${outcome_id}`);
    if (outcome.byte_length !== byte_length || outcome.input_sha256 !== sha256) {
      throw new Error(`parity ${id}: outcome length/sha mismatch`);
    }
    if (outcome.source_id !== source_id || outcome.corpus !== outcomeCorpus) {
      throw new Error(`parity ${id}: outcome identity mismatch`);
    }
    transport_bindings.push({
      id,
      source_corpus,
      source_id,
      byte_length,
      sha256,
      outcome_id,
      webtransport: wt,
      binary_wss: wss,
      equal_wt_wss: true,
    });
  }
  transport_bindings.sort((a, b) => asciiCompare(a.id, b.id));
  for (let i = 1; i < transport_bindings.length; i++) {
    if (transport_bindings[i]!.id === transport_bindings[i - 1]!.id) {
      throw new Error(`duplicate transport binding ${transport_bindings[i]!.id}`);
    }
  }

  // Phase 1 triples from decoded SessionReady CONTROL fields
  const observedTriples: Array<{
    support_row_id: string;
    ros_distro: string;
    rmw_identifier: string;
  }> = [];
  for (const o of outcomes) {
    if (o.status !== "success" || !o.record || !("payload" in o.record)) continue;
    const triple = extractSessionReadyTriple(o.record.payload);
    if (!triple) continue;
    const expected = PHASE_ONE_TRIPLES.find((t) => t.support_row_id === triple.support_row_id);
    if (!expected) {
      throw new Error(
        `unexpected SessionReady support_row_id ${triple.support_row_id} on ${o.id}`,
      );
    }
    if (
      triple.ros_distro !== expected.ros_distro ||
      triple.rmw_identifier !== expected.rmw_identifier
    ) {
      throw new Error(
        `SessionReady triple mismatch for ${triple.support_row_id}: got ${triple.ros_distro}/${triple.rmw_identifier}`,
      );
    }
    if (!observedTriples.some((t) => t.support_row_id === triple.support_row_id)) {
      observedTriples.push({ ...triple });
    }
  }
  if (observedTriples.length !== PHASE_ONE_TRIPLES.length) {
    throw new Error(
      `SessionReady triple set size ${observedTriples.length} != ${PHASE_ONE_TRIPLES.length}`,
    );
  }
  const phase_one_triples = PHASE_ONE_TRIPLES.map((exp) => {
    const got = observedTriples.find((t) => t.support_row_id === exp.support_row_id);
    if (!got) throw new Error(`missing decoded SessionReady for ${exp.support_row_id}`);
    return { ...got };
  });

  return {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    generated_by: GENERATED_BY,
    batch: BATCH_ID,
    counts: {
      outcomes_total: OUTCOMES_TOTAL,
      valid_boundary: VALID_TOTAL,
      sequences: SEQUENCES_TOTAL,
      malformed: MALFORMED_TOTAL,
      parity_shared_artifacts: PARITY_SHARED_TOTAL,
      parity_transport_rules: PARITY_RULES_TOTAL,
    },
    phase_one_rows: [...PHASE_ONE_ROWS],
    phase_one_triples,
    sources: {
      valid_manifest: { path: VALID_MANIFEST_REL, sha256: src.valid.sha },
      malformed_manifest: { path: MALFORMED_MANIFEST_REL, sha256: src.malformed.sha },
      sequences_manifest: { path: SEQUENCES_MANIFEST_REL, sha256: src.sequences.sha },
      parity: { path: PARITY_REL, sha256: src.parity.sha },
      registry: { path: REGISTRY_REL, sha256: src.registry.sha },
    },
    transport_bindings,
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Closed total diagnoseAgreeDocument
// ---------------------------------------------------------------------------

const DOC_KEYS = [
  "schema_version",
  "protocol",
  "generated_by",
  "batch",
  "counts",
  "phase_one_rows",
  "phase_one_triples",
  "sources",
  "transport_bindings",
  "outcomes",
] as const;

const COUNTS_KEYS = [
  "outcomes_total",
  "valid_boundary",
  "sequences",
  "malformed",
  "parity_shared_artifacts",
  "parity_transport_rules",
] as const;

const OUTCOME_KEYS = [
  "id",
  "corpus",
  "source_id",
  "parser_kind",
  "representation",
  "byte_length",
  "input_sha256",
  "status",
  "record",
  "error",
] as const;

const ERROR_KEYS = ["code", "name", "reason", "offset", "plane", "step"] as const;
const BINDING_KEYS = [
  "id",
  "source_corpus",
  "source_id",
  "byte_length",
  "sha256",
  "outcome_id",
  "webtransport",
  "binary_wss",
  "equal_wt_wss",
] as const;
const SIDE_KEYS = ["semantic_identity", "byte_length", "sha256"] as const;
const SOURCE_KEYS = [
  "valid_manifest",
  "malformed_manifest",
  "sequences_manifest",
  "parity",
  "registry",
] as const;
const PROV_KEYS = ["path", "sha256"] as const;

function isNonNegSafeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

function isU8(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 255;
}

function isU16(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 65535;
}

function isU32(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 0xffff_ffff;
}

function parseUint64Decimal(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    if (n < 0n || n > UINT64_MAX) return null;
    // reject non-canonical leading zeros
    if (s.length > 1 && s.startsWith("0")) return null;
    return n;
  } catch {
    return null;
  }
}

function parseInt64Decimal(s: string): bigint | null {
  if (!/^-?\d+$/.test(s)) return null;
  try {
    const n = BigInt(s);
    if (n < INT64_MIN || n > INT64_MAX) return null;
    if (s === "-0") return null;
    if (s.length > 1 && (s.startsWith("0") || s.startsWith("-0"))) return null;
    return n;
  } catch {
    return null;
  }
}

function isLowerEvenHex(s: string): boolean {
  return s.length % 2 === 0 && (s.length === 0 || /^[0-9a-f]+$/.test(s));
}

function diagnoseTextDigest(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (value === null) return;
  if (!isPlainObject(value)) {
    diags.push(`${pathLabel}: TextDigest object or null`);
    return;
  }
  exactKeys(value, ["utf8_byte_length", "fnv1a64_hex"], pathLabel, diags);
  if (!isNonNegSafeInt(value.utf8_byte_length)) {
    diags.push(`${pathLabel}.utf8_byte_length`);
  } else if ((value.utf8_byte_length as number) > UTF8_TEXT_MAX_BYTES) {
    diags.push(`${pathLabel}.utf8_byte_length exceeds ${UTF8_TEXT_MAX_BYTES}`);
  }
  if (typeof value.fnv1a64_hex !== "string" || !FNV_HEX_PATTERN.test(value.fnv1a64_hex)) {
    diags.push(`${pathLabel}.fnv1a64_hex`);
  }
}

function alignExtensionTlv(valueLen: number): number {
  const raw = 4 + valueLen;
  return (raw + (EXTENSION_ALIGNMENT - 1)) & ~(EXTENSION_ALIGNMENT - 1);
}

function decodeLowerHex(hex: string): Uint8Array | null {
  if (!isLowerEvenHex(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function diagnoseCborAgree(
  value: unknown,
  pathLabel: string,
  diags: string[],
  depth = 0,
): void {
  if (depth > 16) {
    diags.push(`${pathLabel}: depth exceeds 16`);
    return;
  }
  if (!isPlainObject(value) || typeof value.t !== "string") {
    diags.push(`${pathLabel}: cbor projection must be tagged object`);
    return;
  }
  switch (value.t) {
    case "null":
      exactKeys(value, ["t"], pathLabel, diags);
      break;
    case "bool":
      exactKeys(value, ["t", "v"], pathLabel, diags);
      if (typeof value.v !== "boolean") diags.push(`${pathLabel}.v bool`);
      break;
    case "uint": {
      exactKeys(value, ["t", "v"], pathLabel, diags);
      if (typeof value.v !== "string") diags.push(`${pathLabel}.v string`);
      else if (parseUint64Decimal(value.v) === null) {
        diags.push(`${pathLabel}.v canonical nonnegative uint64 decimal`);
      }
      break;
    }
    case "nint": {
      exactKeys(value, ["t", "v"], pathLabel, diags);
      if (typeof value.v !== "string") diags.push(`${pathLabel}.v string`);
      else {
        if (!value.v.startsWith("-") || parseInt64Decimal(value.v) === null) {
          // nint may be below int64 for CBOR negative (down to -2^64); allow full CBOR nint range
          if (!/^-\d+$/.test(value.v) || value.v === "-0" || (value.v.length > 2 && value.v.startsWith("-0"))) {
            diags.push(`${pathLabel}.v canonical negative decimal`);
          } else {
            try {
              const n = BigInt(value.v);
              // RFC 8949 negative: -1 - n, n in 0..2^64-1 so value in -2^64 .. -1
              if (n > -1n || n < -(UINT64_MAX + 1n)) {
                diags.push(`${pathLabel}.v nint range`);
              }
            } catch {
              diags.push(`${pathLabel}.v nint`);
            }
          }
        }
      }
      break;
    }
    case "text": {
      exactKeys(value, ["t", "utf8_byte_length", "fnv1a64_hex", "inline"], pathLabel, diags);
      if (!isNonNegSafeInt(value.utf8_byte_length)) {
        diags.push(`${pathLabel}.utf8_byte_length`);
      }
      if (typeof value.fnv1a64_hex !== "string" || !FNV_HEX_PATTERN.test(value.fnv1a64_hex)) {
        diags.push(`${pathLabel}.fnv1a64_hex`);
      }
      if (value.inline !== null && typeof value.inline !== "string") {
        diags.push(`${pathLabel}.inline`);
      } else if (typeof value.inline === "string") {
        const enc = new TextEncoder().encode(value.inline);
        if (enc.length > TEXT_INLINE_MAX_BYTES) {
          diags.push(`${pathLabel}.inline exceeds bound`);
        }
        if (isNonNegSafeInt(value.utf8_byte_length) && enc.length !== value.utf8_byte_length) {
          diags.push(`${pathLabel}.inline length mismatch`);
        }
        if (
          typeof value.fnv1a64_hex === "string" &&
          FNV_HEX_PATTERN.test(value.fnv1a64_hex) &&
          fnv1a64Hex(enc) !== value.fnv1a64_hex
        ) {
          diags.push(`${pathLabel}.inline fnv mismatch`);
        }
      } else if (value.inline === null && isNonNegSafeInt(value.utf8_byte_length)) {
        if (value.utf8_byte_length <= TEXT_INLINE_MAX_BYTES) {
          diags.push(`${pathLabel}.inline must be present at or below bound`);
        }
      }
      break;
    }
    case "bytes": {
      exactKeys(value, ["t", "byte_length", "fnv1a64_hex", "inline_hex"], pathLabel, diags);
      if (!isNonNegSafeInt(value.byte_length)) diags.push(`${pathLabel}.byte_length`);
      if (typeof value.fnv1a64_hex !== "string" || !FNV_HEX_PATTERN.test(value.fnv1a64_hex)) {
        diags.push(`${pathLabel}.fnv1a64_hex`);
      }
      if (value.inline_hex !== null && typeof value.inline_hex !== "string") {
        diags.push(`${pathLabel}.inline_hex`);
      } else if (typeof value.inline_hex === "string") {
        if (!isLowerEvenHex(value.inline_hex)) {
          diags.push(`${pathLabel}.inline_hex lowercase even hex`);
        } else {
          const raw = new Uint8Array(value.inline_hex.length / 2);
          for (let i = 0; i < raw.length; i++) {
            raw[i] = Number.parseInt(value.inline_hex.slice(i * 2, i * 2 + 2), 16);
          }
          if (raw.length > BYTES_INLINE_MAX_BYTES) {
            diags.push(`${pathLabel}.inline_hex exceeds bound`);
          }
          if (isNonNegSafeInt(value.byte_length) && raw.length !== value.byte_length) {
            diags.push(`${pathLabel}.inline_hex length mismatch`);
          }
          if (
            typeof value.fnv1a64_hex === "string" &&
            FNV_HEX_PATTERN.test(value.fnv1a64_hex) &&
            fnv1a64Hex(raw) !== value.fnv1a64_hex
          ) {
            diags.push(`${pathLabel}.inline_hex fnv mismatch`);
          }
        }
      } else if (value.inline_hex === null && isNonNegSafeInt(value.byte_length)) {
        if (value.byte_length <= BYTES_INLINE_MAX_BYTES) {
          diags.push(`${pathLabel}.inline_hex must be present at or below bound`);
        }
      }
      break;
    }
    case "array":
      exactKeys(value, ["t", "items"], pathLabel, diags);
      if (!Array.isArray(value.items)) diags.push(`${pathLabel}.items array`);
      else {
        value.items.forEach((it, i) =>
          diagnoseCborAgree(it, `${pathLabel}.items[${i}]`, diags, depth + 1),
        );
      }
      break;
    case "map":
      exactKeys(value, ["t", "entries"], pathLabel, diags);
      if (!Array.isArray(value.entries)) diags.push(`${pathLabel}.entries array`);
      else {
        if (value.entries.length > CONTROL_MAP_ENTRIES_MAX) {
          diags.push(
            `${pathLabel}.entries exceeds ceiling ${CONTROL_MAP_ENTRIES_MAX}`,
          );
        }
        let prevKey: bigint | null = null;
        value.entries.forEach((ent, i) => {
          const ep = `${pathLabel}.entries[${i}]`;
          if (!isPlainObject(ent)) {
            diags.push(`${ep}: object`);
            return;
          }
          exactKeys(ent, ["key", "value"], ep, diags);
          if (typeof ent.key !== "string") diags.push(`${ep}.key`);
          else {
            const kn = parseUint64Decimal(ent.key);
            if (kn === null) diags.push(`${ep}.key canonical uint64 decimal`);
            else if (prevKey !== null && kn <= prevKey) {
              diags.push(`${ep}.key must be strictly ascending`);
            }
            if (kn !== null) prevKey = kn;
          }
          diagnoseCborAgree(ent.value, `${ep}.value`, diags, depth + 1);
        });
      }
      break;
    default:
      diags.push(`${pathLabel}: unknown cbor tag ${value.t}`);
  }
}

function diagnoseTransportCaps(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    diags.push(`${pathLabel}: object`);
    return;
  }
  exactKeys(
    value,
    ["webtransport_http3", "binary_wss", "max_datagram_size"],
    pathLabel,
    diags,
  );
  if (typeof value.webtransport_http3 !== "boolean") {
    diags.push(`${pathLabel}.webtransport_http3`);
  }
  if (typeof value.binary_wss !== "boolean") diags.push(`${pathLabel}.binary_wss`);
  if (
    value.max_datagram_size !== null &&
    !isU32(value.max_datagram_size)
  ) {
    diags.push(`${pathLabel}.max_datagram_size`);
  }
}

function diagnoseBufferCaps(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    diags.push(`${pathLabel}: object`);
    return;
  }
  exactKeys(
    value,
    ["transferable_arraybuffer", "shared_arraybuffer"],
    pathLabel,
    diags,
  );
  if (typeof value.transferable_arraybuffer !== "boolean") {
    diags.push(`${pathLabel}.transferable_arraybuffer`);
  }
  if (typeof value.shared_arraybuffer !== "boolean") {
    diags.push(`${pathLabel}.shared_arraybuffer`);
  }
}

function diagnoseCapArray(
  value: unknown,
  pathLabel: string,
  diags: string[],
  maxLen: number,
): void {
  if (!Array.isArray(value)) {
    diags.push(`${pathLabel}: array`);
    return;
  }
  if (value.length > maxLen) diags.push(`${pathLabel}: length`);
  let prev = -1;
  value.forEach((x, i) => {
    if (!isU16(x) || (x as number) < 1) {
      diags.push(`${pathLabel}[${i}]`);
      return;
    }
    if ((x as number) <= prev) diags.push(`${pathLabel}[${i}] order`);
    prev = x as number;
  });
}

function diagnoseRecord(
  record: unknown,
  parserKind: string,
  pathLabel: string,
  outcomeByteLength: number | null,
  diags: string[],
): void {
  if (!isPlainObject(record)) {
    diags.push(`${pathLabel}: record object`);
    return;
  }
  if (parserKind === "bootstrap") {
    if (record.variant === "client_hello") {
      exactKeys(
        record,
        [
          "variant",
          "wire_versions",
          "transport_capabilities",
          "buffer_capabilities",
          "requested_limits",
          "extension_capabilities",
        ],
        pathLabel,
        diags,
      );
      if (!Array.isArray(record.wire_versions)) {
        diags.push(`${pathLabel}.wire_versions`);
      } else if (
        record.wire_versions.length < 1 ||
        record.wire_versions.length > WIRE_VERSIONS_MAX
      ) {
        diags.push(
          `${pathLabel}.wire_versions length must be 1..${WIRE_VERSIONS_MAX}`,
        );
      } else {
        let prev = -1;
        record.wire_versions.forEach((v, i) => {
          if (!isU8(v)) {
            diags.push(`${pathLabel}.wire_versions[${i}]`);
            return;
          }
          if ((v as number) <= prev) {
            diags.push(
              `${pathLabel}.wire_versions[${i}] must be strictly ascending unique`,
            );
          }
          prev = v as number;
        });
      }
      diagnoseTransportCaps(record.transport_capabilities, `${pathLabel}.transport_capabilities`, diags);
      diagnoseBufferCaps(record.buffer_capabilities, `${pathLabel}.buffer_capabilities`, diags);
      if (!isPlainObject(record.requested_limits)) {
        diags.push(`${pathLabel}.requested_limits`);
      } else {
        exactKeys(
          record.requested_limits,
          [
            "max_channels",
            "max_session_bytes",
            "max_message_bytes",
            "max_control_payload_bytes",
          ],
          `${pathLabel}.requested_limits`,
          diags,
        );
        const rl = record.requested_limits;
        if (rl.max_channels !== null && !isU32(rl.max_channels)) {
          diags.push(`${pathLabel}.requested_limits.max_channels`);
        }
        if (
          rl.max_session_bytes !== null &&
          (typeof rl.max_session_bytes !== "string" ||
            parseUint64Decimal(rl.max_session_bytes) === null)
        ) {
          diags.push(`${pathLabel}.requested_limits.max_session_bytes`);
        }
        if (rl.max_message_bytes !== null && !isU32(rl.max_message_bytes)) {
          diags.push(`${pathLabel}.requested_limits.max_message_bytes`);
        }
        if (
          rl.max_control_payload_bytes !== null &&
          !isU32(rl.max_control_payload_bytes)
        ) {
          diags.push(`${pathLabel}.requested_limits.max_control_payload_bytes`);
        }
      }
      diagnoseCapArray(
        record.extension_capabilities,
        `${pathLabel}.extension_capabilities`,
        diags,
        64,
      );
    } else if (record.variant === "server_hello") {
      exactKeys(
        record,
        [
          "variant",
          "selected_wire_version",
          "transport_capabilities",
          "buffer_capabilities",
          "effective_limits",
          "extension_capabilities",
        ],
        pathLabel,
        diags,
      );
      if (!isU8(record.selected_wire_version)) {
        diags.push(`${pathLabel}.selected_wire_version`);
      } else if (record.selected_wire_version !== 0) {
        diags.push(`${pathLabel}.selected_wire_version equals v0`);
      }
      diagnoseTransportCaps(record.transport_capabilities, `${pathLabel}.transport_capabilities`, diags);
      diagnoseBufferCaps(record.buffer_capabilities, `${pathLabel}.buffer_capabilities`, diags);
      if (!isPlainObject(record.effective_limits)) {
        diags.push(`${pathLabel}.effective_limits`);
      } else {
        exactKeys(
          record.effective_limits,
          [
            "max_channels",
            "max_session_bytes",
            "max_message_bytes",
            "max_control_payload_bytes",
          ],
          `${pathLabel}.effective_limits`,
          diags,
        );
        const el = record.effective_limits;
        if (!isU32(el.max_channels)) {
          diags.push(`${pathLabel}.effective_limits.max_channels`);
        } else if ((el.max_channels as number) > EFFECTIVE_MAX_CHANNELS) {
          diags.push(
            `${pathLabel}.effective_limits.max_channels exceeds ceiling ${EFFECTIVE_MAX_CHANNELS}`,
          );
        }
        if (typeof el.max_session_bytes !== "string") {
          diags.push(`${pathLabel}.effective_limits.max_session_bytes`);
        } else {
          const session = parseUint64Decimal(el.max_session_bytes);
          if (session === null) {
            diags.push(`${pathLabel}.effective_limits.max_session_bytes`);
          } else if (session > EFFECTIVE_MAX_SESSION_BYTES) {
            diags.push(
              `${pathLabel}.effective_limits.max_session_bytes exceeds ceiling ${EFFECTIVE_MAX_SESSION_BYTES.toString(10)}`,
            );
          }
        }
        if (!isU32(el.max_message_bytes)) {
          diags.push(`${pathLabel}.effective_limits.max_message_bytes`);
        } else if ((el.max_message_bytes as number) > EFFECTIVE_MAX_MESSAGE_BYTES) {
          diags.push(
            `${pathLabel}.effective_limits.max_message_bytes exceeds ceiling ${EFFECTIVE_MAX_MESSAGE_BYTES}`,
          );
        }
        if (!isU32(el.max_control_payload_bytes)) {
          diags.push(`${pathLabel}.effective_limits.max_control_payload_bytes`);
        } else if (
          (el.max_control_payload_bytes as number) > EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES
        ) {
          diags.push(
            `${pathLabel}.effective_limits.max_control_payload_bytes exceeds ceiling ${EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES}`,
          );
        }
      }
      diagnoseCapArray(
        record.extension_capabilities,
        `${pathLabel}.extension_capabilities`,
        diags,
        64,
      );
    } else if (record.variant === "bootstrap_error") {
      exactKeys(record, ["variant", "code", "message", "detail"], pathLabel, diags);
      if (!isU8(record.code)) {
        diags.push(`${pathLabel}.code`);
      } else if (!BOOTSTRAP_ERROR_CODES.has(record.code as number)) {
        diags.push(`${pathLabel}.code assigned bootstrap error set`);
      }
      diagnoseTextDigest(record.message, `${pathLabel}.message`, diags);
      diagnoseTextDigest(record.detail, `${pathLabel}.detail`, diags);
    } else {
      diags.push(`${pathLabel}: bad bootstrap variant`);
    }
    return;
  }

  // frame
  exactKeys(
    record,
    [
      "version",
      "opcode",
      "flags",
      "channel_id",
      "sequence",
      "source_time_ns",
      "payload_len",
      "extension_len",
      "priority",
      "clock_id",
      "extensions",
      "payload",
    ],
    pathLabel,
    diags,
  );
  if (!isU8(record.version)) diags.push(`${pathLabel}.version`);
  else if (record.version !== 0) diags.push(`${pathLabel}.version equals v0`);

  if (!isU8(record.opcode)) diags.push(`${pathLabel}.opcode`);
  else if (
    (record.opcode as number) < OPCODE_ASSIGNED_MIN ||
    (record.opcode as number) > OPCODE_ASSIGNED_MAX
  ) {
    diags.push(`${pathLabel}.opcode assigned 1..12`);
  }

  if (!isU16(record.flags)) diags.push(`${pathLabel}.flags`);
  else if (((record.flags as number) & ~FLAG_ASSIGNED_MASK) !== 0) {
    diags.push(`${pathLabel}.flags assigned mask`);
  }

  if (!isU32(record.channel_id)) diags.push(`${pathLabel}.channel_id`);
  if (typeof record.sequence !== "string" || parseUint64Decimal(record.sequence) === null) {
    diags.push(`${pathLabel}.sequence`);
  }

  let sourceTime: bigint | null = null;
  if (typeof record.source_time_ns !== "string") {
    diags.push(`${pathLabel}.source_time_ns`);
  } else {
    sourceTime = parseInt64Decimal(record.source_time_ns);
    if (sourceTime === null) diags.push(`${pathLabel}.source_time_ns`);
  }

  if (!isU32(record.payload_len)) diags.push(`${pathLabel}.payload_len`);
  else if ((record.payload_len as number) > FRAME_PAYLOAD_MAX_BYTES) {
    diags.push(`${pathLabel}.payload_len exceeds frame ceiling`);
  }

  if (!isU16(record.extension_len)) {
    diags.push(`${pathLabel}.extension_len`);
  } else {
    const extLen = record.extension_len as number;
    if (extLen > EXTENSION_AREA_MAX_BYTES) {
      diags.push(`${pathLabel}.extension_len exceeds ${EXTENSION_AREA_MAX_BYTES}`);
    }
    if (extLen % EXTENSION_ALIGNMENT !== 0) {
      diags.push(`${pathLabel}.extension_len 4-byte aligned`);
    }
  }

  if (!isU8(record.priority)) diags.push(`${pathLabel}.priority`);
  else if ((record.priority as number) > 4) {
    diags.push(`${pathLabel}.priority assigned 0..4`);
  }

  if (!isU8(record.clock_id)) diags.push(`${pathLabel}.clock_id`);
  else if ((record.clock_id as number) > 4) {
    diags.push(`${pathLabel}.clock_id assigned 0..4`);
  } else if ((record.clock_id as number) === 0 && sourceTime !== null && sourceTime !== 0n) {
    diags.push(`${pathLabel}.source_time_ns clock NONE requires 0`);
  }

  const opcode = isU8(record.opcode) ? (record.opcode as number) : null;
  const flags = isU16(record.flags) ? (record.flags as number) : null;
  if (opcode !== null && flags !== null) {
    if ((flags & FLAG_FRAGMENT) !== 0) {
      diags.push(`${pathLabel}.flags FRAGMENT frozen unset`);
    }
    if ((flags & FLAG_KEYFRAME) !== 0 && opcode !== OPCODE_MEDIA_CHUNK) {
      diags.push(`${pathLabel}.flags KEYFRAME requires MEDIA_CHUNK opcode`);
    }
    if (
      ((flags & FLAG_ROS_RELIABLE) !== 0 || (flags & FLAG_RETAINED) !== 0) &&
      opcode !== OPCODE_ROS_SAMPLE
    ) {
      diags.push(
        `${pathLabel}.flags ROS_RELIABLE and RETAINED require ROS_SAMPLE opcode`,
      );
    }
  }

  if (opcode === OPCODE_CONTROL_CBOR) {
    if (isU32(record.channel_id) && (record.channel_id as number) !== 0) {
      diags.push(`${pathLabel}.channel_id CONTROL requires 0`);
    }
    if (isU8(record.priority) && (record.priority as number) !== 0) {
      diags.push(`${pathLabel}.priority CONTROL requires 0`);
    }
    if (
      isU32(record.payload_len) &&
      (record.payload_len as number) > CONTROL_PAYLOAD_MAX_BYTES
    ) {
      diags.push(`${pathLabel}.payload_len CONTROL ceiling`);
    }
  } else if (opcode !== null) {
    if (isU32(record.channel_id) && (record.channel_id as number) === 0) {
      diags.push(`${pathLabel}.channel_id application requires positive channel`);
    }
  }

  if (
    outcomeByteLength !== null &&
    isU32(record.payload_len) &&
    isU16(record.extension_len)
  ) {
    const expected =
      FRAME_HEADER_LENGTH +
      (record.extension_len as number) +
      (record.payload_len as number);
    if (outcomeByteLength !== expected) {
      diags.push(
        `${pathLabel}: outcome byte_length equals ${FRAME_HEADER_LENGTH}+extension_len+payload_len`,
      );
    }
  }

  let hasTraceExt = false;
  let knownTlvTotal = 0;
  if (!Array.isArray(record.extensions)) {
    diags.push(`${pathLabel}.extensions array`);
  } else {
    let prevType = -1;
    record.extensions.forEach((ext, i) => {
      const ep = `${pathLabel}.extensions[${i}]`;
      if (!isPlainObject(ext)) {
        diags.push(`${ep}: object`);
        return;
      }
      exactKeys(
        ext,
        ["type_id", "critical", "value_len", "value_fnv1a64_hex"],
        ep,
        diags,
      );
      if (!isU8(ext.type_id)) {
        diags.push(`${ep}.type_id`);
      } else {
        const tid = ext.type_id as number;
        if (tid !== TRACE_CONTEXT_TYPE && tid !== OPERATION_ID_TYPE) {
          diags.push(`${ep}.type_id assigned 1 or 2`);
        }
        if (tid <= prevType) diags.push(`${ep}.type_id order`);
        prevType = tid;
        if (tid === TRACE_CONTEXT_TYPE) hasTraceExt = true;
      }
      if (typeof ext.critical !== "boolean") diags.push(`${ep}.critical`);
      if (!isU16(ext.value_len)) {
        diags.push(`${ep}.value_len`);
      } else {
        const vlen = ext.value_len as number;
        if (ext.type_id === TRACE_CONTEXT_TYPE && vlen !== TRACE_CONTEXT_VALUE_LEN) {
          diags.push(`${ep}.value_len TRACE_CONTEXT ${TRACE_CONTEXT_VALUE_LEN}`);
        }
        if (ext.type_id === OPERATION_ID_TYPE && vlen !== OPERATION_ID_VALUE_LEN) {
          diags.push(`${ep}.value_len OPERATION_ID ${OPERATION_ID_VALUE_LEN}`);
        }
        if (
          ext.type_id === TRACE_CONTEXT_TYPE ||
          ext.type_id === OPERATION_ID_TYPE
        ) {
          knownTlvTotal += alignExtensionTlv(vlen);
        }
      }
      if (
        typeof ext.value_fnv1a64_hex !== "string" ||
        !FNV_HEX_PATTERN.test(ext.value_fnv1a64_hex)
      ) {
        diags.push(`${ep}.value_fnv1a64_hex`);
      }
    });
    if (isU16(record.extension_len) && knownTlvTotal > (record.extension_len as number)) {
      diags.push(`${pathLabel}.extensions padded known TLV total fits extension_len`);
    }
  }

  if (flags !== null) {
    const traceFlag = (flags & FLAG_TRACE_PRESENT) !== 0;
    if (traceFlag !== hasTraceExt) {
      diags.push(`${pathLabel}: TRACE flag and type 1 presence agree`);
    }
  }

  if (!isPlainObject(record.payload)) {
    diags.push(`${pathLabel}.payload object`);
    return;
  }
  const pay = record.payload;
  const framePlen = isU32(record.payload_len) ? (record.payload_len as number) : null;

  if (opcode === OPCODE_CONTROL_CBOR && pay.form !== "control") {
    diags.push(`${pathLabel}.payload.form CONTROL opcode requires control`);
  }
  if (opcode !== null && opcode !== OPCODE_CONTROL_CBOR && pay.form !== "application") {
    diags.push(`${pathLabel}.payload.form application opcode requires application`);
  }

  if (pay.form === "application") {
    exactKeys(
      pay,
      [
        "form",
        "payload_len",
        "payload_fnv1a64_hex",
        "payload_head_hex",
        "payload_tail_hex",
      ],
      `${pathLabel}.payload`,
      diags,
    );
    if (!isNonNegSafeInt(pay.payload_len)) diags.push(`${pathLabel}.payload.payload_len`);
    if (framePlen !== null && pay.payload_len !== framePlen) {
      diags.push(`${pathLabel}.payload.payload_len equals frame`);
    }
    if (
      typeof pay.payload_fnv1a64_hex !== "string" ||
      !FNV_HEX_PATTERN.test(pay.payload_fnv1a64_hex)
    ) {
      diags.push(`${pathLabel}.payload.payload_fnv1a64_hex`);
    }
    const plen =
      isNonNegSafeInt(pay.payload_len) ? (pay.payload_len as number) : framePlen;
    const expectedHexBytes =
      plen === null ? null : Math.min(HEAD_TAIL_HEX_BYTES, plen);
    let headHex: string | null = null;
    let tailHex: string | null = null;
    for (const hk of ["payload_head_hex", "payload_tail_hex"] as const) {
      const hv = pay[hk];
      if (typeof hv !== "string" || !isLowerEvenHex(hv)) {
        diags.push(`${pathLabel}.payload.${hk}`);
      } else if (expectedHexBytes !== null && hv.length / 2 !== expectedHexBytes) {
        diags.push(
          `${pathLabel}.payload.${hk} exact min(8,payload_len) bytes`,
        );
      } else {
        if (hk === "payload_head_hex") headHex = hv;
        else tailHex = hv;
      }
    }
    if (plen === 0) {
      if (headHex !== "" || tailHex !== "") {
        diags.push(`${pathLabel}.payload empty head/tail`);
      }
      if (
        typeof pay.payload_fnv1a64_hex === "string" &&
        pay.payload_fnv1a64_hex !== EMPTY_PAYLOAD_FNV1A64_HEX
      ) {
        diags.push(`${pathLabel}.payload empty FNV`);
      }
    } else if (plen !== null && plen <= HEAD_TAIL_HEX_BYTES && headHex !== null && tailHex !== null) {
      if (headHex !== tailHex) {
        diags.push(`${pathLabel}.payload head/tail equal for short payload`);
      }
      const raw = decodeLowerHex(headHex);
      if (
        raw &&
        typeof pay.payload_fnv1a64_hex === "string" &&
        FNV_HEX_PATTERN.test(pay.payload_fnv1a64_hex) &&
        fnv1a64Hex(raw) !== pay.payload_fnv1a64_hex
      ) {
        diags.push(`${pathLabel}.payload short FNV matches head`);
      }
    }
  } else if (pay.form === "control") {
    exactKeys(
      pay,
      [
        "form",
        "payload_len",
        "payload_fnv1a64_hex",
        "control_kind",
        "control_field_keys",
        "control_fields",
      ],
      `${pathLabel}.payload`,
      diags,
    );
    if (!isNonNegSafeInt(pay.payload_len)) diags.push(`${pathLabel}.payload.payload_len`);
    if (framePlen !== null && pay.payload_len !== framePlen) {
      diags.push(`${pathLabel}.payload.payload_len equals frame`);
    }
    if (
      typeof pay.payload_fnv1a64_hex !== "string" ||
      !FNV_HEX_PATTERN.test(pay.payload_fnv1a64_hex)
    ) {
      diags.push(`${pathLabel}.payload.payload_fnv1a64_hex`);
    }
    if (
      typeof pay.control_kind !== "number" ||
      !Number.isSafeInteger(pay.control_kind) ||
      pay.control_kind < 1 ||
      pay.control_kind > 15
    ) {
      diags.push(`${pathLabel}.payload.control_kind`);
    }
    if (!Array.isArray(pay.control_field_keys)) {
      diags.push(`${pathLabel}.payload.control_field_keys`);
    } else {
      let prev = -1;
      const keySet: number[] = [];
      pay.control_field_keys.forEach((k, i) => {
        if (!isNonNegSafeInt(k)) {
          diags.push(`${pathLabel}.payload.control_field_keys[${i}]`);
          return;
        }
        if ((k as number) <= prev) {
          diags.push(`${pathLabel}.payload.control_field_keys[${i}] order`);
        }
        prev = k as number;
        keySet.push(k as number);
      });

      if (!isPlainObject(pay.control_fields) || pay.control_fields.t !== "map") {
        diags.push(`${pathLabel}.payload.control_fields must be map`);
      } else {
        diagnoseCborAgree(pay.control_fields, `${pathLabel}.payload.control_fields`, diags);
        const mapKeys: number[] = [];
        let kindFromMap: number | null = null;
        if (Array.isArray(pay.control_fields.entries)) {
          if (pay.control_fields.entries.length > CONTROL_MAP_ENTRIES_MAX) {
            diags.push(
              `${pathLabel}.payload.control_fields entries at most ${CONTROL_MAP_ENTRIES_MAX}`,
            );
          }
          for (const ent of pay.control_fields.entries) {
            if (isPlainObject(ent) && typeof ent.key === "string") {
              const n = parseUint64Decimal(ent.key);
              if (n !== null && n <= BigInt(Number.MAX_SAFE_INTEGER)) {
                mapKeys.push(Number(n));
                if (n === 1n) {
                  if (
                    isPlainObject(ent.value) &&
                    ent.value.t === "uint" &&
                    typeof ent.value.v === "string"
                  ) {
                    const kv = parseUint64Decimal(ent.value.v);
                    if (kv !== null && kv <= BigInt(Number.MAX_SAFE_INTEGER)) {
                      kindFromMap = Number(kv);
                    }
                  } else {
                    diags.push(
                      `${pathLabel}.payload.control_fields key 1 must be uint`,
                    );
                  }
                }
              }
            }
          }
        }
        if (
          !(
            keySet.length === mapKeys.length &&
            keySet.every((k, i) => k === mapKeys[i])
          )
        ) {
          diags.push(`${pathLabel}.payload.control_field_keys map equality`);
        }
        if (kindFromMap === null) {
          diags.push(`${pathLabel}.payload.control_fields key 1 required`);
        } else if (
          typeof pay.control_kind === "number" &&
          Number.isSafeInteger(pay.control_kind) &&
          kindFromMap !== pay.control_kind
        ) {
          diags.push(
            `${pathLabel}.payload.control_kind equals map key 1`,
          );
        }
      }
    }
  } else {
    diags.push(`${pathLabel}.payload.form`);
  }
}

export function diagnoseAgreeDocument(doc: unknown): string[] {
  const diags: string[] = [];
  try {
    if (!isPlainObject(doc)) {
      diags.push("root: must be object");
      return diags.sort(asciiCompare);
    }
    exactKeys(doc, DOC_KEYS, "root", diags);
    if (doc.schema_version !== SCHEMA_VERSION) diags.push("schema_version");
    if (doc.protocol !== PROTOCOL_ID) diags.push("protocol");
    if (doc.generated_by !== GENERATED_BY) diags.push("generated_by");
    if (doc.batch !== BATCH_ID) diags.push("batch");

    if (!isPlainObject(doc.counts)) diags.push("counts object");
    else exactKeys(doc.counts, COUNTS_KEYS, "counts", diags);

    if (!Array.isArray(doc.phase_one_rows) || doc.phase_one_rows.length !== PHASE_ONE_ROWS.length) {
      diags.push("phase_one_rows");
    } else {
      for (let i = 0; i < 4; i++) {
        if (doc.phase_one_rows[i] !== PHASE_ONE_ROWS[i]) {
          diags.push(`phase_one_rows[${i}]`);
        }
      }
    }

    if (
      !Array.isArray(doc.phase_one_triples) ||
      doc.phase_one_triples.length !== PHASE_ONE_TRIPLES.length
    ) {
      diags.push("phase_one_triples");
    } else {
      doc.phase_one_triples.forEach((t, i) => {
        const p = `phase_one_triples[${i}]`;
        if (!isPlainObject(t)) {
          diags.push(`${p}: object`);
          return;
        }
        exactKeys(t, ["support_row_id", "ros_distro", "rmw_identifier"], p, diags);
        const exp = PHASE_ONE_TRIPLES[i];
        if (
          exp &&
          (t.support_row_id !== exp.support_row_id ||
            t.ros_distro !== exp.ros_distro ||
            t.rmw_identifier !== exp.rmw_identifier)
        ) {
          diags.push(`${p}: triple mismatch`);
        }
      });
    }

    if (!isPlainObject(doc.sources)) diags.push("sources object");
    else {
      exactKeys(doc.sources, SOURCE_KEYS, "sources", diags);
      for (const k of SOURCE_KEYS) {
        const s = doc.sources[k];
        const p = `sources.${k}`;
        if (!isPlainObject(s)) diags.push(`${p} object`);
        else {
          exactKeys(s, PROV_KEYS, p, diags);
          if (typeof s.sha256 !== "string" || !SHA256_PATTERN.test(s.sha256)) {
            diags.push(`${p}.sha256`);
          }
          if (s.path !== SOURCE_PATH_CONSTANTS[k]) {
            diags.push(`${p}.path constant`);
          }
        }
      }
    }

    const successIds = new Set<string>();
    const successById = new Map<string, Record<string, unknown>>();
    let countValid = 0;
    let countSeq = 0;
    let countMal = 0;
    let countSuccess = 0;
    let countError = 0;
    let recipeCount = 0;

    if (!Array.isArray(doc.outcomes)) diags.push("outcomes array");
    else {
      let prev = "";
      doc.outcomes.forEach((o, i) => {
        const p = `outcomes[${i}]`;
        if (!isPlainObject(o)) {
          diags.push(`${p}: object`);
          return;
        }
        exactKeys(o, OUTCOME_KEYS, p, diags);
        if (typeof o.id !== "string" || !ID_TOKEN.test(o.id)) diags.push(`${p}.id`);
        if (typeof o.source_id !== "string" || !SOURCE_ID_TOKEN.test(o.source_id)) {
          diags.push(`${p}.source_id`);
        }
        if (prev && asciiCompare(prev, String(o.id)) >= 0) {
          diags.push(`${p}.id unsorted or duplicate`);
        }
        prev = String(o.id);
        if (!CORPUS_SET.has(String(o.corpus))) diags.push(`${p}.corpus`);
        if (!PARSER_SET.has(String(o.parser_kind))) diags.push(`${p}.parser_kind`);
        if (!REPR_SET.has(String(o.representation))) diags.push(`${p}.representation`);
        if (!STATUS_SET.has(String(o.status))) diags.push(`${p}.status`);
        if (!isNonNegSafeInt(o.byte_length)) diags.push(`${p}.byte_length`);
        if (typeof o.input_sha256 !== "string" || !SHA256_PATTERN.test(o.input_sha256)) {
          diags.push(`${p}.input_sha256`);
        }
        if (
          typeof o.corpus === "string" &&
          typeof o.source_id === "string" &&
          o.id !== corpusQualifiedId(o.corpus as CorpusName, o.source_id)
        ) {
          diags.push(`${p}.id corpus-qualified`);
        }

        if (o.corpus === "valid_boundary") countValid++;
        if (o.corpus === "sequences") countSeq++;
        if (o.corpus === "malformed") countMal++;

        if (o.corpus === "valid_boundary" || o.corpus === "sequences") {
          if (o.status !== "success") diags.push(`${p}.status success required`);
        }
        if (o.corpus === "malformed") {
          if (o.status !== "error") diags.push(`${p}.status error required`);
        }
        if (
          o.representation === "segment_recipe" ||
          o.source_id === RECIPE_ID
        ) {
          recipeCount++;
          const rec = isPlainObject(o.record) ? o.record : null;
          const pay =
            rec && isPlainObject(rec.payload) ? (rec.payload as Record<string, unknown>) : null;
          if (
            o.source_id !== RECIPE_ID ||
            o.corpus !== "valid_boundary" ||
            o.representation !== "segment_recipe" ||
            o.status !== "success" ||
            o.byte_length !== RECIPE_BYTE_LENGTH ||
            !pay ||
            pay.form !== "application" ||
            pay.payload_len !== RECIPE_PAYLOAD_LENGTH ||
            pay.payload_fnv1a64_hex !== RECIPE_PAYLOAD_FNV1A64_HEX
          ) {
            diags.push(`${p}: 64 MiB segment_recipe pin`);
          }
        }
        if (
          (o.corpus === "sequences" || o.corpus === "malformed") &&
          o.representation !== "binary"
        ) {
          diags.push(`${p}.representation binary`);
        }

        if (o.status === "success") {
          countSuccess++;
          successIds.add(String(o.id));
          successById.set(String(o.id), o);
          if (o.error !== null) diags.push(`${p}.error must be null`);
          const outcomeLen = isNonNegSafeInt(o.byte_length)
            ? (o.byte_length as number)
            : null;
          diagnoseRecord(
            o.record,
            String(o.parser_kind),
            `${p}.record`,
            outcomeLen,
            diags,
          );
        } else if (o.status === "error") {
          countError++;
          if (o.record !== null) diags.push(`${p}.record must be null`);
          if (!isPlainObject(o.error)) diags.push(`${p}.error object`);
          else {
            exactKeys(o.error, ERROR_KEYS, `${p}.error`, diags);
            if (!isNonNegSafeInt(o.error.code) || o.error.code > 255) {
              diags.push(`${p}.error.code`);
            }
            if (typeof o.error.name !== "string" || !ERROR_TOKEN.test(o.error.name)) {
              diags.push(`${p}.error.name`);
            }
            if (typeof o.error.reason !== "string" || !ERROR_TOKEN.test(o.error.reason)) {
              diags.push(`${p}.error.reason`);
            }
            if (!isNonNegSafeInt(o.error.offset)) {
              diags.push(`${p}.error.offset`);
            } else if (
              isNonNegSafeInt(o.byte_length) &&
              (o.error.offset as number) > (o.byte_length as number)
            ) {
              diags.push(`${p}.error.offset within byte_length`);
            }
            if (!PLANE_SET.has(String(o.error.plane))) diags.push(`${p}.error.plane`);
            if (
              typeof o.error.step !== "number" ||
              !Number.isSafeInteger(o.error.step)
            ) {
              diags.push(`${p}.error.step`);
            } else if (o.parser_kind === "bootstrap") {
              if (o.error.step < 1 || o.error.step > 9) diags.push(`${p}.error.step bootstrap`);
              if (o.error.plane !== "bootstrap") diags.push(`${p}.error.plane bootstrap`);
            } else if (o.parser_kind === "frame") {
              if (o.error.step < 1 || o.error.step > 16) diags.push(`${p}.error.step frame`);
              if (o.error.plane !== "selected_frame") diags.push(`${p}.error.plane frame`);
            }
          }
        }
      });
      if (doc.outcomes.length !== OUTCOMES_TOTAL) {
        diags.push(`outcomes length ${doc.outcomes.length}`);
      }
      if (countValid !== VALID_TOTAL) {
        diags.push(`valid_boundary count ${countValid} != ${VALID_TOTAL}`);
      }
      if (countSeq !== SEQUENCES_TOTAL) {
        diags.push(`sequences count ${countSeq} != ${SEQUENCES_TOTAL}`);
      }
      if (countMal !== MALFORMED_TOTAL) {
        diags.push(`malformed count ${countMal} != ${MALFORMED_TOTAL}`);
      }
      if (countSuccess !== VALID_TOTAL + SEQUENCES_TOTAL) {
        diags.push(`success count ${countSuccess}`);
      }
      if (countError !== MALFORMED_TOTAL) diags.push(`error count ${countError}`);
      if (recipeCount !== 1) {
        diags.push(`64 MiB segment_recipe count ${recipeCount}`);
      }
    }

    if (isPlainObject(doc.counts)) {
      if (doc.counts.outcomes_total !== countValid + countSeq + countMal) {
        diags.push("counts.outcomes_total recomputed mismatch");
      }
      if (doc.counts.valid_boundary !== countValid) diags.push("counts.valid_boundary");
      if (doc.counts.sequences !== countSeq) diags.push("counts.sequences");
      if (doc.counts.malformed !== countMal) diags.push("counts.malformed");
      if (doc.counts.valid_boundary !== VALID_TOTAL) {
        diags.push("counts.valid_boundary constant 20");
      }
      if (doc.counts.sequences !== SEQUENCES_TOTAL) {
        diags.push("counts.sequences constant 26");
      }
      if (doc.counts.malformed !== MALFORMED_TOTAL) {
        diags.push("counts.malformed constant 55");
      }
      if (doc.counts.outcomes_total !== OUTCOMES_TOTAL) {
        diags.push("counts.outcomes_total constant");
      }
      if (doc.counts.parity_shared_artifacts !== PARITY_SHARED_TOTAL) {
        diags.push("counts.parity_shared_artifacts");
      }
      if (doc.counts.parity_transport_rules !== PARITY_RULES_TOTAL) {
        diags.push("counts.parity_transport_rules");
      }
    }

    if (!Array.isArray(doc.transport_bindings)) diags.push("transport_bindings array");
    else {
      let prev = "";
      const boundOutcomes = new Set<string>();
      doc.transport_bindings.forEach((b, i) => {
        const p = `transport_bindings[${i}]`;
        if (!isPlainObject(b)) {
          diags.push(`${p}: object`);
          return;
        }
        exactKeys(b, BINDING_KEYS, p, diags);
        if (typeof b.id !== "string" || !ID_TOKEN.test(b.id)) diags.push(`${p}.id`);
        if (prev && asciiCompare(prev, String(b.id)) >= 0) {
          diags.push(`${p}.id unsorted or duplicate`);
        }
        prev = String(b.id);
        if (b.source_corpus !== "valid_boundary" && b.source_corpus !== "sequences") {
          diags.push(`${p}.source_corpus`);
        }
        if (typeof b.source_id !== "string" || !SOURCE_ID_TOKEN.test(b.source_id)) {
          diags.push(`${p}.source_id`);
        }
        if (b.equal_wt_wss !== true) diags.push(`${p}.equal_wt_wss`);
        if (!isNonNegSafeInt(b.byte_length)) diags.push(`${p}.byte_length`);
        if (typeof b.sha256 !== "string" || !SHA256_PATTERN.test(b.sha256)) {
          diags.push(`${p}.sha256`);
        }
        const expectedOutcomeId =
          typeof b.source_corpus === "string" && typeof b.source_id === "string"
            ? corpusQualifiedId(b.source_corpus as CorpusName, b.source_id)
            : null;
        if (b.outcome_id !== expectedOutcomeId) {
          diags.push(`${p}.outcome_id identity`);
        }
        if (b.id !== b.outcome_id) diags.push(`${p}.id equals outcome_id`);
        const expectedSemantic =
          typeof b.source_corpus === "string" && typeof b.source_id === "string"
            ? `${b.source_corpus}/${b.source_id}`
            : null;
        for (const side of ["webtransport", "binary_wss"] as const) {
          const s = b[side];
          if (!isPlainObject(s)) diags.push(`${p}.${side} object`);
          else {
            exactKeys(s, SIDE_KEYS, `${p}.${side}`, diags);
            if (typeof s.sha256 !== "string" || !SHA256_PATTERN.test(s.sha256)) {
              diags.push(`${p}.${side}.sha256`);
            }
            if (!isNonNegSafeInt(s.byte_length)) diags.push(`${p}.${side}.byte_length`);
            if (s.semantic_identity !== expectedSemantic) {
              diags.push(`${p}.${side}.semantic_identity`);
            }
            if (s.byte_length !== b.byte_length) diags.push(`${p}.${side}.byte_length top`);
            if (s.sha256 !== b.sha256) diags.push(`${p}.${side}.sha256 top`);
          }
        }
        if (
          isPlainObject(b.webtransport) &&
          isPlainObject(b.binary_wss) &&
          (b.webtransport.sha256 !== b.binary_wss.sha256 ||
            b.webtransport.byte_length !== b.binary_wss.byte_length ||
            b.webtransport.semantic_identity !== b.binary_wss.semantic_identity)
        ) {
          diags.push(`${p}: WT/WSS mismatch`);
        }
        if (typeof b.outcome_id !== "string" || !successIds.has(b.outcome_id)) {
          diags.push(`${p}.outcome_id cross-ref`);
        } else {
          if (boundOutcomes.has(b.outcome_id)) {
            diags.push(`${p}.outcome_id bound twice`);
          }
          boundOutcomes.add(b.outcome_id);
          const o = successById.get(b.outcome_id);
          if (o) {
            if (o.byte_length !== b.byte_length || o.input_sha256 !== b.sha256) {
              diags.push(`${p}: outcome length/sha`);
            }
          }
        }
      });
      if (doc.transport_bindings.length !== PARITY_SHARED_TOTAL) {
        diags.push("transport_bindings length");
      }
      if (boundOutcomes.size !== PARITY_SHARED_TOTAL) {
        diags.push(`bound outcome unique count ${boundOutcomes.size}`);
      }
    }
  } catch (e) {
    diags.push(`diagnose threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  return diags.sort(asciiCompare);
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

export async function writeExpected(
  root: string,
): Promise<{ text: string; doc: AgreeDocument }> {
  const doc = await buildAgreeDocument(root);
  const text = stableJsonPretty(doc);
  const w = await writeBoundedTextAtomic(root, EXPECTED_REL, text, EXPECTED_MAX_BYTES);
  if (!w.ok) throw new Error(`write ${EXPECTED_REL}: ${w.error}`);
  return { text, doc };
}

export async function checkExpected(
  root: string,
): Promise<{ ok: true; doc: AgreeDocument } | { ok: false; diagnostics: string[] }> {
  const diags: string[] = [];
  const read = await readBoundedText(root, EXPECTED_REL, EXPECTED_MAX_BYTES);
  if (!read.ok) {
    // When expected.json is absent, report the read diagnostic and leave the filesystem unchanged.
    return { ok: false, diagnostics: [`${EXPECTED_REL}: ${read.error}`] };
  }

  let committed: unknown;
  try {
    committed = JSON.parse(read.text);
  } catch (e) {
    return {
      ok: false,
      diagnostics: [
        `${EXPECTED_REL}: malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
  diags.push(...diagnoseAgreeDocument(committed));

  let rebuilt: AgreeDocument;
  try {
    rebuilt = await buildAgreeDocument(root);
  } catch (e) {
    diags.push(`rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, diagnostics: diags.sort(asciiCompare) };
  }

  const canonical = stableJsonPretty(rebuilt);
  if (read.text !== canonical) {
    diags.push(`${EXPECTED_REL}: raw text must equal the canonical rebuild`);
  }
  if (stableJsonPretty(committed) !== canonical) {
    diags.push(`${EXPECTED_REL}: committed JSON differs from rebuild`);
  }

  const recipe = rebuilt.outcomes.find((o) => o.source_id === RECIPE_ID);
  if (
    !recipe ||
    recipe.status !== "success" ||
    !recipe.record ||
    !("payload" in recipe.record) ||
    recipe.record.payload.form !== "application" ||
    recipe.record.payload.payload_fnv1a64_hex !== RECIPE_PAYLOAD_FNV1A64_HEX
  ) {
    diags.push("64 MiB payload_fnv1a64_hex pin failed");
  }

  if (diags.length > 0) return { ok: false, diagnostics: diags.sort(asciiCompare) };
  return { ok: true, doc: rebuilt };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const parsed = parseCliMode(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const root = repoRootFrom(import.meta.dir);
  try {
    if (parsed.mode === "write-expected") {
      const { doc } = await writeExpected(root);
      console.log(
        JSON.stringify({
          mode: "write-expected",
          output: EXPECTED_REL,
          outcomes: doc.counts.outcomes_total,
          status: "ok",
        }),
      );
      return 0;
    }
    const result = await checkExpected(root);
    if (!result.ok) {
      for (const d of result.diagnostics) console.error(d);
      console.log(
        JSON.stringify({
          mode: "check-expected",
          status: "error",
          diagnostics: result.diagnostics.length,
        }),
      );
      return 1;
    }
    console.log(
      JSON.stringify({
        mode: "check-expected",
        status: "ok",
        outcomes: result.doc.counts.outcomes_total,
      }),
    );
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
