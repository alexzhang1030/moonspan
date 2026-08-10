#!/usr/bin/env bun
/**
 * R2WP v0 static malformed wire fixture generator and checker (M0-03e1).
 *
 * --write  regenerates protocol/testdata/malformed/manifest.json and *.bin
 * --check  reconstructs every fixture and verifies committed artifacts
 *
 * Deterministic: no timestamps, host paths, or locale-dependent ordering.
 * Valid/boundary corpus remains owned by scripts/protocol-fixtures.ts.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  unlink,
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import {
  BOOTSTRAP_PAYLOAD_MAX_BYTES,
  BOOTSTRAP_PREFIX_LENGTH,
  BootstrapCodecError,
  decodeBootstrapRecord,
  encodeBootstrapRecord,
  type BootstrapRecord,
} from "../sdk/typescript/src/protocol/bootstrap.ts";

export { BOOTSTRAP_PAYLOAD_MAX_BYTES };
import {
  CLOCK_NONE,
  CLOCK_ROS,
  CLOCK_SYSTEM,
  FLAG_FRAGMENT,
  FLAG_KEYFRAME,
  FLAG_RETAINED,
  FLAG_ROS_RELIABLE,
  FLAG_TRACE_PRESENT,
  FRAME_HEADER_LENGTH,
  FRAME_PAYLOAD_MAX_BYTES,
  FrameCodecError,
  OPCODE_CONTROL_CBOR,
  OPCODE_MEDIA_CHUNK,
  OPCODE_ROS_SAMPLE,
  OPCODE_SERVICE_REQUEST,
  PRIORITY_CONTROL,
  PRIORITY_DEFAULT,
  decodeFrame,
  encodeFrame,
  type FrameDecodeOptions,
} from "../sdk/typescript/src/protocol/frame.ts";
import {
  CONTROL_KIND_AUTHENTICATE,
  encodeControlMessage,
} from "../sdk/typescript/src/protocol/control.ts";
import { encodeDeterministicCbor } from "../sdk/typescript/src/protocol/cbor.ts";
import {
  TRACE_CONTEXT_EXTENSION_TYPE,
  TRACE_CONTEXT_VALUE_LENGTH,
  encodeExtensionArea,
} from "../sdk/typescript/src/protocol/extension.ts";

// ---------------------------------------------------------------------------
// Paths / constants
// ---------------------------------------------------------------------------

export const MALFORMED_DIR_REL = "protocol/testdata/malformed";
export const MANIFEST_REL = "protocol/testdata/malformed/manifest.json";
export const REGISTRY_REL = "protocol/registry/r2wp-v0.json";
export const GENERATED_BY = "scripts/protocol-malformed-fixtures.ts";
export const SCHEMA_VERSION = 1;
export const PROTOCOL_ID = "r2wp-v0";
export const PER_FIXTURE_ALLOC_MAX = 256 * 1024;
export const CORPUS_ALLOC_MAX = 2 * 1024 * 1024;
export const HEX_LITERAL_MAX_BYTES = 64 * 1024;
export const MUTATION_APPEND_MAX_BYTES = 4096;
export const U16_MAX = 65_535;
export const MANIFEST_MAX_BYTES = 512 * 1024;
export const REGISTRY_MAX_BYTES = 2 * 1024 * 1024;
export const FIXTURE_COUNT_MAX = 256;
export const ID_MAX_LEN = 128;
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/;
export const STRING_FIELD_MAX = 256;
export const COVERAGE_PER_FIXTURE_MAX = 64;
export const MUTATION_OPS_MAX = 32;
export const CLAIM_MAX = 512;
export const ASSIGNED_CLOCK_IDS = [0, 1, 2, 3, 4] as const;

const MANIFEST_KEYS = [
  "schema_version",
  "protocol",
  "byte_order",
  "generated_by",
  "bootstrap_step6_defensive_equivalence",
  "fixtures",
] as const;

const FIXTURE_KEYS = [
  "id",
  "kind",
  "path",
  "representation",
  "byte_length",
  "sha256",
  "source",
  "decoder_context",
  "expected",
  "coverage",
] as const;

const EXPECTED_KEYS = [
  "registry_code",
  "registry_name",
  "reason",
  "offset",
  "plane",
  "step",
] as const;

const DECODER_CONTEXT_KEYS = [
  "selectedVersion",
  "experimentalOpcodesEnabled",
  "availableClockIds",
] as const;

const STEP6_KEYS = [
  "plane",
  "step",
  "u16_maximum",
  "absolute_ceiling_bytes",
  "claim",
] as const;

const OP_KEYS: Record<string, readonly string[]> = {
  truncate: ["op", "length"],
  set_u8: ["op", "offset", "value"],
  set_u16be: ["op", "offset", "value"],
  set_u32be: ["op", "offset", "value"],
  replace_hex: ["op", "offset", "hex"],
  append_hex: ["op", "hex"],
};

const MUTATE_OPS = [
  "truncate",
  "set_u8",
  "set_u16be",
  "set_u32be",
  "replace_hex",
  "append_hex",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FixtureKind = "bootstrap" | "frame";
export type Representation = "binary" | "defensive_equivalence";
export type ValidationPlane = "bootstrap" | "selected_frame";

export type DecoderContext = {
  selectedVersion?: number;
  experimentalOpcodesEnabled?: boolean;
  availableClockIds?: number[];
};

export type ExpectedOutcome = {
  registry_code: number;
  registry_name: string;
  reason: string;
  offset: number;
  plane: ValidationPlane;
  step: number;
};

export type OpTruncate = { op: "truncate"; length: number };
export type OpSetU8 = { op: "set_u8"; offset: number; value: number };
export type OpSetU16 = { op: "set_u16be"; offset: number; value: number };
export type OpSetU32 = { op: "set_u32be"; offset: number; value: number };
export type OpReplace = { op: "replace_hex"; offset: number; hex: string };
export type OpAppend = { op: "append_hex"; hex: string };
export type MutationOp =
  | OpTruncate
  | OpSetU8
  | OpSetU16
  | OpSetU32
  | OpReplace
  | OpAppend;

export type HexSource = { $type: "hex"; hex: string };
export type MutateSource = {
  $type: "mutate";
  base: HexSource;
  ops: MutationOp[];
};
export type ConstructionSource = HexSource | MutateSource;

export type MalformedFixtureEntry = {
  id: string;
  kind: FixtureKind;
  path: string | null;
  representation: Representation;
  byte_length: number;
  sha256: string;
  source: ConstructionSource | { $type: "defensive_equivalence"; claim: string };
  decoder_context: DecoderContext;
  expected: ExpectedOutcome;
  coverage: string[];
};

export type Manifest = {
  schema_version: number;
  protocol: string;
  byte_order: "network";
  generated_by: string;
  bootstrap_step6_defensive_equivalence: {
    plane: "bootstrap";
    step: 6;
    u16_maximum: number;
    absolute_ceiling_bytes: number;
    claim: string;
  };
  fixtures: MalformedFixtureEntry[];
};

type FixtureDef = {
  id: string;
  kind: FixtureKind;
  representation?: Representation;
  source: ConstructionSource | { $type: "defensive_equivalence"; claim: string };
  decoder_context?: DecoderContext;
  expected: ExpectedOutcome;
  coverage: string[];
};

// ---------------------------------------------------------------------------
// ASCII / helpers
// ---------------------------------------------------------------------------

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortAscii(strings: string[]): string[] {
  return [...strings].sort(asciiCompare);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd hex length ${hex.length}`);
  if (!/^[0-9a-f]*$/.test(hex)) throw new Error("hex must be lowercase [0-9a-f]");
  if (hex.length / 2 > HEX_LITERAL_MAX_BYTES) {
    throw new Error(`hex literal exceeds ${HEX_LITERAL_MAX_BYTES} bytes`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Uint8Array)
  );
}

function exactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  p: string,
  diags: string[],
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) diags.push(`${p}: unknown key "${k}"`);
  }
}

function requireKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  p: string,
  diags: string[],
): void {
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) {
      diags.push(`${p}: missing key "${k}"`);
    }
  }
}

export function stableManifestJson(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

export function isCanonicalMalformedPath(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.includes("\\") || rel.includes("\0")) return false;
  if (path.isAbsolute(rel)) return false;
  if (rel.startsWith("/") || rel.startsWith("./") || rel.startsWith("../")) return false;
  const parts = rel.split("/");
  if (parts.length !== 2) return false;
  if (parts[0] !== "malformed") return false;
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  if (!parts[1]!.endsWith(".bin")) return false;
  if (rel !== `malformed/${path.posix.basename(rel)}`) return false;
  return true;
}

/** Path must be exactly malformed/<id>.bin for the fixture id. */
export function isCanonicalMalformedEntryPath(id: string, rel: string): boolean {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
  if (!isCanonicalMalformedPath(rel)) return false;
  return rel === `malformed/${id}.bin`;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function resolveUnderRoot(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Wire builders (deterministic bases)
// ---------------------------------------------------------------------------

function setU16BE(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 8) & 0xff;
  b[o + 1] = v & 0xff;
}
function setU32BE(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

export function bootstrapPrefix(
  kind: number,
  payload: Uint8Array,
  flags = 0,
  version = 0,
): Uint8Array {
  if (payload.length > HEX_LITERAL_MAX_BYTES) {
    throw new Error("bootstrap payload too large for fixture construction");
  }
  const out = new Uint8Array(BOOTSTRAP_PREFIX_LENGTH + payload.length);
  out[0] = 0x52;
  out[1] = 0x32;
  out[2] = 0x57;
  out[3] = 0x50;
  out[4] = version;
  out[5] = kind;
  setU16BE(out, 6, flags);
  setU32BE(out, 8, payload.length);
  out.set(payload, BOOTSTRAP_PREFIX_LENGTH);
  return out;
}

export function assembleFrame(fields: {
  version?: number;
  opcode: number;
  flags?: number;
  channelId: number;
  sequence?: number;
  sourceTimeNs?: number;
  priority: number;
  clockId: number;
  extension: Uint8Array;
  payload: Uint8Array;
}): Uint8Array {
  const ext = fields.extension;
  const payload = fields.payload;
  const total = FRAME_HEADER_LENGTH + ext.length + payload.length;
  if (total > PER_FIXTURE_ALLOC_MAX) {
    throw new Error(`assembleFrame total ${total} exceeds per-fixture ceiling`);
  }
  const out = new Uint8Array(total);
  out[0] = fields.version ?? 0;
  out[1] = fields.opcode;
  setU16BE(out, 2, fields.flags ?? 0);
  setU32BE(out, 4, fields.channelId >>> 0);
  const seq = fields.sequence ?? 0;
  // sequence low byte only for small values; full zero default
  if (seq !== 0) out[15] = seq & 0xff;
  const t = fields.sourceTimeNs ?? 0;
  if (t !== 0) {
    let x = BigInt(t);
    if (x < 0n) x += 0x1_0000_0000_0000_0000n;
    for (let i = 7; i >= 0; i--) {
      out[16 + i] = Number(x & 0xffn);
      x >>= 8n;
    }
  }
  setU32BE(out, 24, payload.length);
  setU16BE(out, 28, ext.length);
  out[30] = fields.priority;
  out[31] = fields.clockId;
  out.set(ext, FRAME_HEADER_LENGTH);
  out.set(payload, FRAME_HEADER_LENGTH + ext.length);
  return out;
}

function tlv(type: number, value: Uint8Array, critical = false): Uint8Array {
  const pad = (4 - ((4 + value.length) % 4)) % 4;
  const out = new Uint8Array(4 + value.length + pad);
  out[0] = type;
  out[1] = critical ? 0x80 : 0;
  setU16BE(out, 2, value.length);
  out.set(value, 4);
  return out;
}

function legalTraceValue(): Uint8Array {
  const v = new Uint8Array(TRACE_CONTEXT_VALUE_LENGTH);
  v[0] = 1;
  v[24] = 1;
  return v;
}

function controlAuthBytes(): Uint8Array {
  return encodeControlMessage(
    new Map<number | bigint, unknown>([
      [1, CONTROL_KIND_AUTHENTICATE],
      [2, new Uint8Array(16)],
      [16, "tok"],
      [17, new Uint8Array([0xab, 0xcd])],
    ]) as never,
  );
}

function minimalClientHelloBytes(): Uint8Array {
  const record: BootstrapRecord = {
    kind: "client_hello",
    wireVersions: [0],
    transportCapabilities: { webtransportHttp3: true, binaryWss: false },
    bufferCapabilities: {
      transferableArraybuffer: true,
      sharedArraybuffer: false,
    },
    requestedLimits: {},
    extensionCapabilities: [],
  };
  return encodeBootstrapRecord(record);
}

function minimalAppFrameBytes(): Uint8Array {
  return encodeFrame({
    opcode: OPCODE_ROS_SAMPLE,
    channelId: 1,
    sequence: 0,
    sourceTimeNs: 0,
    priority: PRIORITY_DEFAULT,
    clockId: CLOCK_NONE,
    payload: new Uint8Array([0xde, 0xad]),
  });
}

function minimalControlFrameBytes(): Uint8Array {
  return assembleFrame({
    opcode: OPCODE_CONTROL_CBOR,
    channelId: 0,
    priority: PRIORITY_CONTROL,
    clockId: CLOCK_NONE,
    extension: new Uint8Array(0),
    payload: controlAuthBytes(),
  });
}

// ---------------------------------------------------------------------------
// Construction DSL
// ---------------------------------------------------------------------------

export function materializeSource(
  source: ConstructionSource,
  allocBudget: { used: number },
): Uint8Array {
  if (source.$type === "hex") {
    const bytes = fromHex(source.hex);
    allocBudget.used += bytes.length;
    if (allocBudget.used > CORPUS_ALLOC_MAX) {
      throw new Error(`corpus allocation exceeded ${CORPUS_ALLOC_MAX}`);
    }
    if (bytes.length > PER_FIXTURE_ALLOC_MAX) {
      throw new Error(`fixture allocation exceeded ${PER_FIXTURE_ALLOC_MAX}`);
    }
    return bytes;
  }
  if (source.$type === "mutate") {
    if (!source.base || source.base.$type !== "hex") {
      throw new Error("mutate.base must be hex");
    }
    if (!Array.isArray(source.ops)) throw new Error("mutate.ops must be array");
    if (source.ops.length > MUTATION_OPS_MAX) {
      throw new Error(`mutate.ops exceeds ${MUTATION_OPS_MAX}`);
    }
    const base = fromHex(source.base.hex);
    let cur = new Uint8Array(base);
    allocBudget.used += cur.length;
    for (const op of source.ops) {
      cur = applyOp(cur, op, allocBudget);
    }
    if (cur.length > PER_FIXTURE_ALLOC_MAX) {
      throw new Error(`fixture allocation exceeded ${PER_FIXTURE_ALLOC_MAX}`);
    }
    return cur;
  }
  throw new Error("unsupported source type");
}

function applyOp(
  cur: Uint8Array,
  op: MutationOp,
  allocBudget: { used: number },
): Uint8Array {
  switch (op.op) {
    case "truncate": {
      if (
        typeof op.length !== "number" ||
        !Number.isSafeInteger(op.length) ||
        op.length < 0 ||
        op.length > cur.length
      ) {
        throw new Error("truncate.length invalid");
      }
      return cur.slice(0, op.length);
    }
    case "set_u8": {
      if (
        !Number.isSafeInteger(op.offset) ||
        op.offset < 0 ||
        op.offset >= cur.length ||
        !Number.isSafeInteger(op.value) ||
        op.value < 0 ||
        op.value > 255
      ) {
        throw new Error("set_u8 operands invalid");
      }
      const out = new Uint8Array(cur);
      out[op.offset] = op.value;
      return out;
    }
    case "set_u16be": {
      if (
        !Number.isSafeInteger(op.offset) ||
        op.offset < 0 ||
        op.offset + 1 >= cur.length ||
        !Number.isSafeInteger(op.value) ||
        op.value < 0 ||
        op.value > 0xffff
      ) {
        throw new Error("set_u16be operands invalid");
      }
      const out = new Uint8Array(cur);
      setU16BE(out, op.offset, op.value);
      return out;
    }
    case "set_u32be": {
      if (
        !Number.isSafeInteger(op.offset) ||
        op.offset < 0 ||
        op.offset + 3 >= cur.length ||
        !Number.isSafeInteger(op.value) ||
        op.value < 0 ||
        op.value > 0xffffffff
      ) {
        throw new Error("set_u32be operands invalid");
      }
      const out = new Uint8Array(cur);
      setU32BE(out, op.offset, op.value >>> 0);
      return out;
    }
    case "replace_hex": {
      const rep = fromHex(op.hex);
      if (
        !Number.isSafeInteger(op.offset) ||
        op.offset < 0 ||
        op.offset + rep.length > cur.length
      ) {
        throw new Error("replace_hex operands invalid");
      }
      const out = new Uint8Array(cur);
      out.set(rep, op.offset);
      return out;
    }
    case "append_hex": {
      const app = fromHex(op.hex);
      if (app.length > MUTATION_APPEND_MAX_BYTES) {
        throw new Error(`append_hex exceeds ${MUTATION_APPEND_MAX_BYTES}`);
      }
      const next = cur.length + app.length;
      if (next > PER_FIXTURE_ALLOC_MAX) {
        throw new Error("append would exceed per-fixture ceiling");
      }
      allocBudget.used += app.length;
      if (allocBudget.used > CORPUS_ALLOC_MAX) {
        throw new Error(`corpus allocation exceeded ${CORPUS_ALLOC_MAX}`);
      }
      const out = new Uint8Array(next);
      out.set(cur);
      out.set(app, cur.length);
      return out;
    }
    default:
      throw new Error(`unknown op`);
  }
}

// ---------------------------------------------------------------------------
// Registry binding
// ---------------------------------------------------------------------------

export type RegistryIndex = {
  errors: Record<string, { name: string }>;
  bootstrapSteps: Map<number, { error: string; code: number; check: string }>;
  frameSteps: Map<number, { error: string; code: number; check: string }>;
};

export function loadRegistryIndex(registryJson: unknown): RegistryIndex {
  if (!isPlainObject(registryJson)) throw new Error("registry root must be object");
  const errors = registryJson.errors;
  if (!isPlainObject(errors)) throw new Error("registry.errors missing");
  const vo = registryJson.validation_order;
  if (!isPlainObject(vo)) throw new Error("registry.validation_order missing");
  const bootstrap = vo.bootstrap;
  const selected = vo.selected_frame;
  if (!Array.isArray(bootstrap) || !Array.isArray(selected)) {
    throw new Error("validation_order planes missing");
  }

  function ingestSteps(
    rows: unknown[],
    plane: string,
  ): Map<number, { error: string; code: number; check: string }> {
    const map = new Map<number, { error: string; code: number; check: string }>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isPlainObject(row)) {
        throw new Error(`registry ${plane} row ${i}: must be object`);
      }
      const step = row.step;
      const code = row.code;
      const error = row.error;
      const check = row.check;
      if (typeof step !== "number" || !Number.isSafeInteger(step) || step < 1) {
        throw new Error(`registry ${plane} row ${i}: step must be positive safe integer`);
      }
      // disposition-only rows may have null code; skip rows without wire error codes
      if (code === null || code === undefined) {
        continue;
      }
      if (typeof code !== "number" || !Number.isSafeInteger(code) || code < 0 || code > 255) {
        throw new Error(`registry ${plane} row ${i}: code must be safe integer 0..255`);
      }
      if (typeof error !== "string" || error.length === 0) {
        throw new Error(`registry ${plane} row ${i}: error name must be nonempty string`);
      }
      if (typeof check !== "string" || check.length === 0) {
        throw new Error(`registry ${plane} row ${i}: check must be nonempty string`);
      }
      if (map.has(step)) {
        throw new Error(`registry ${plane}: duplicate step ${step}`);
      }
      map.set(step, { error, code, check });
    }
    return map;
  }

  const bootstrapSteps = ingestSteps(bootstrap, "bootstrap");
  const frameSteps = ingestSteps(selected, "selected_frame");

  const errMap: Record<string, { name: string }> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (!/^[0-9]+$/.test(k)) continue;
    if (!isPlainObject(v)) {
      throw new Error(`registry.errors[${k}]: must be object`);
    }
    if (typeof v.name !== "string" || v.name.length === 0) {
      throw new Error(`registry.errors[${k}]: name must be nonempty string`);
    }
    errMap[k] = { name: v.name };
  }
  if (Object.keys(errMap).length === 0) {
    throw new Error("registry.errors: no numeric error rows");
  }
  return { errors: errMap, bootstrapSteps, frameSteps };
}

export function crossBindExpected(
  expected: ExpectedOutcome,
  registry: RegistryIndex,
): string[] {
  const diags: string[] = [];
  const err = registry.errors[String(expected.registry_code)];
  if (!err) {
    diags.push(`unknown registry code ${expected.registry_code}`);
    return diags;
  }
  if (err.name !== expected.registry_name) {
    diags.push(
      `registry code ${expected.registry_code} name ${err.name} != expected ${expected.registry_name}`,
    );
  }
  const planeMap =
    expected.plane === "bootstrap" ? registry.bootstrapSteps : registry.frameSteps;
  const step = planeMap.get(expected.step);
  if (!step) {
    diags.push(`unknown ${expected.plane} step ${expected.step}`);
    return diags;
  }
  if (step.code !== expected.registry_code) {
    diags.push(
      `${expected.plane} step ${expected.step} code ${step.code} != ${expected.registry_code}`,
    );
  }
  if (step.error !== expected.registry_name) {
    diags.push(
      `${expected.plane} step ${expected.step} error ${step.error} != ${expected.registry_name}`,
    );
  }
  return diags;
}

// ---------------------------------------------------------------------------
// Fixture definitions (hard-coded oracle)
// ---------------------------------------------------------------------------

function hexSrc(bytes: Uint8Array): HexSource {
  return { $type: "hex", hex: toHex(bytes) };
}

function mutateHex(hex: string, ops: MutationOp[]): MutateSource {
  return { $type: "mutate", base: { $type: "hex", hex }, ops };
}

export function buildFixtureDefs(): FixtureDef[] {
  const hello = minimalClientHelloBytes();
  const helloPayload = hello.slice(BOOTSTRAP_PREFIX_LENGTH);
  const app = minimalAppFrameBytes();
  const ctrl = minimalControlFrameBytes();
  const authPayload = controlAuthBytes();

  const areaBadPad = new Uint8Array(8);
  areaBadPad[0] = 128;
  areaBadPad[3] = 1;
  areaBadPad[4] = 0xaa;
  areaBadPad[5] = 0x01;

  const tlv2 = tlv(2, new Uint8Array(16));
  const tlv1 = tlv(1, legalTraceValue());
  const descending = new Uint8Array(tlv2.length + tlv1.length);
  descending.set(tlv2);
  descending.set(tlv1, tlv2.length);
  const duplicateType = new Uint8Array(tlv2.length * 2);
  duplicateType.set(tlv2);
  duplicateType.set(tlv2, tlv2.length);
  const criticalUnknown = encodeExtensionArea([
    { type: 99, critical: true, value: new Uint8Array(0) },
  ]);
  const legalTraceExt = encodeExtensionArea([
    {
      type: TRACE_CONTEXT_EXTENSION_TYPE,
      critical: false,
      value: legalTraceValue(),
    },
  ]);
  const structuralThenCritical = (() => {
    const c = tlv(99, new Uint8Array(0), true);
    const a = new Uint8Array(areaBadPad.length + c.length);
    a.set(areaBadPad);
    a.set(c, areaBadPad.length);
    return a;
  })();

  const defs: FixtureDef[] = [
    // ---- bootstrap steps ----
    {
      id: "bootstrap-step1-truncated-prefix",
      kind: "bootstrap",
      source: hexSrc(new Uint8Array(11)),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "truncated_prefix",
        offset: 0,
        plane: "bootstrap",
        step: 1,
      },
      coverage: ["bootstrap_step_1", "truncated"],
    },
    {
      id: "bootstrap-step2-bad-magic",
      kind: "bootstrap",
      source: mutateHex(toHex(bootstrapPrefix(1, helloPayload)), [
        { op: "set_u8", offset: 0, value: 0 },
      ]),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "bad_magic",
        offset: 0,
        plane: "bootstrap",
        step: 2,
      },
      coverage: ["bootstrap_step_2"],
    },
    {
      id: "bootstrap-step3-unsupported-version",
      kind: "bootstrap",
      source: hexSrc(bootstrapPrefix(1, helloPayload, 0, 1)),
      expected: {
        registry_code: 4,
        registry_name: "unsupported_version",
        reason: "unsupported_bootstrap_version",
        offset: 4,
        plane: "bootstrap",
        step: 3,
      },
      coverage: ["bootstrap_step_3"],
    },
    {
      id: "bootstrap-step4-nonzero-flags",
      kind: "bootstrap",
      source: hexSrc(bootstrapPrefix(1, helloPayload, 1, 0)),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "nonzero_flags",
        offset: 6,
        plane: "bootstrap",
        step: 4,
      },
      coverage: ["bootstrap_step_4"],
    },
    {
      id: "bootstrap-step5-unassigned-kind",
      kind: "bootstrap",
      source: hexSrc(bootstrapPrefix(0, helloPayload)),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "unassigned_kind",
        offset: 5,
        plane: "bootstrap",
        step: 5,
      },
      coverage: ["bootstrap_step_5"],
    },
    {
      id: "bootstrap-step6-u16-ceiling-equivalence",
      kind: "bootstrap",
      representation: "defensive_equivalence",
      source: {
        $type: "defensive_equivalence",
        claim:
          "step 6 is represented by defensive-equivalence metadata because u16 maximum equals the absolute 65535-byte ceiling",
      },
      expected: {
        registry_code: 24,
        registry_name: "message_too_large",
        reason: "payload_too_large",
        offset: 8,
        plane: "bootstrap",
        step: 6,
      },
      coverage: ["bootstrap_step_6", "defensive_equivalence"],
    },
    {
      id: "bootstrap-step7-truncated-body",
      kind: "bootstrap",
      source: mutateHex(toHex(bootstrapPrefix(1, helloPayload)), [
        { op: "truncate", length: hello.length - 1 },
      ]),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "exact_total_mismatch",
        offset: 0,
        plane: "bootstrap",
        step: 7,
      },
      coverage: ["bootstrap_step_7", "bootstrap_truncation", "truncation"],
    },
    {
      id: "bootstrap-step7-trailing-bytes",
      kind: "bootstrap",
      source: mutateHex(toHex(bootstrapPrefix(1, helloPayload)), [
        { op: "append_hex", hex: "00" },
      ]),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "exact_total_mismatch",
        offset: 0,
        plane: "bootstrap",
        step: 7,
      },
      coverage: ["bootstrap_step_7", "bootstrap_trailing_bytes", "trailing_bytes"],
    },
    {
      id: "bootstrap-step8-indefinite-cbor",
      kind: "bootstrap",
      source: hexSrc(bootstrapPrefix(1, new Uint8Array([0x9f]))),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "cbor_profile",
        offset: 12,
        plane: "bootstrap",
        step: 8,
      },
      coverage: ["bootstrap_step_8", "cbor_profile"],
    },
    {
      id: "bootstrap-step8-duplicate-map-key",
      kind: "bootstrap",
      source: hexSrc(
        bootstrapPrefix(
          1,
          new Uint8Array([0xa2, 0x01, 0x81, 0x00, 0x01, 0x81, 0x00]),
        ),
      ),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "cbor_profile",
        offset: 16,
        plane: "bootstrap",
        step: 8,
      },
      coverage: ["bootstrap_step_8", "bootstrap_duplicate_cbor_key", "duplicate_cbor_key"],
    },
    {
      id: "bootstrap-step8-non-shortest-key",
      kind: "bootstrap",
      source: hexSrc(
        bootstrapPrefix(1, new Uint8Array([0xa1, 0x18, 0x01, 0x80])),
      ),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "cbor_profile",
        offset: 13,
        plane: "bootstrap",
        step: 8,
      },
      coverage: ["bootstrap_step_8", "bootstrap_non_shortest_cbor", "non_shortest_cbor"],
    },
    {
      id: "bootstrap-step9-kind-shape-mismatch",
      kind: "bootstrap",
      source: hexSrc(
        bootstrapPrefix(1, encodeDeterministicCbor(new Map([[1, 1]]))),
      ),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "missing_key",
        offset: 12,
        plane: "bootstrap",
        step: 9,
      },
      coverage: ["bootstrap_step_9", "kind_shape"],
    },
    {
      id: "bootstrap-step9-wrong-kind-payload",
      kind: "bootstrap",
      source: hexSrc(bootstrapPrefix(3, helloPayload)),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "unknown_key",
        offset: 12,
        plane: "bootstrap",
        step: 9,
      },
      coverage: ["bootstrap_step_9", "kind_shape"],
    },

    // ---- frame steps ----
    {
      id: "frame-step1-truncated-header",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "truncate", length: 31 }]),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "truncated_header",
        offset: 0,
        plane: "selected_frame",
        step: 1,
      },
      coverage: ["frame_step_1", "truncation"],
    },
    {
      id: "frame-step2-version-mismatch",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 0, value: 1 }]),
      expected: {
        registry_code: 4,
        registry_name: "unsupported_version",
        reason: "unsupported_version",
        offset: 0,
        plane: "selected_frame",
        step: 2,
      },
      coverage: ["frame_step_2"],
    },
    {
      id: "frame-step3-extension-overflow",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u16be", offset: 28, value: 4097 },
      ]),
      expected: {
        registry_code: 24,
        registry_name: "message_too_large",
        reason: "extension_too_large",
        offset: 28,
        plane: "selected_frame",
        step: 3,
      },
      coverage: ["frame_step_3", "declared_bound_overflow", "extension_overflow"],
    },
    {
      id: "frame-step3-payload-overflow",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u32be", offset: 24, value: FRAME_PAYLOAD_MAX_BYTES + 1 },
      ]),
      expected: {
        registry_code: 24,
        registry_name: "message_too_large",
        reason: "payload_too_large",
        offset: 24,
        plane: "selected_frame",
        step: 3,
      },
      coverage: ["frame_step_3", "declared_bound_overflow", "payload_overflow"],
    },
    {
      id: "frame-step4-truncated-body",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "truncate", length: app.length - 1 }]),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "exact_total_mismatch",
        offset: 0,
        plane: "selected_frame",
        step: 4,
      },
      coverage: ["frame_step_4", "frame_truncation", "truncation"],
    },
    {
      id: "frame-step4-trailing-bytes",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "append_hex", hex: "00" }]),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "exact_total_mismatch",
        offset: 0,
        plane: "selected_frame",
        step: 4,
      },
      coverage: ["frame_step_4", "frame_trailing_bytes", "trailing_bytes"],
    },
    {
      id: "frame-step5-unassigned-opcode",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 1, value: 0 }]),
      expected: {
        registry_code: 5,
        registry_name: "unsupported_opcode",
        reason: "unsupported_opcode",
        offset: 1,
        plane: "selected_frame",
        step: 5,
      },
      coverage: ["frame_step_5", "unassigned_opcode"],
    },
    {
      id: "frame-step5-experimental-disabled",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 1, value: 128 }]),
      decoder_context: { experimentalOpcodesEnabled: false },
      expected: {
        registry_code: 5,
        registry_name: "unsupported_opcode",
        reason: "unsupported_opcode",
        offset: 1,
        plane: "selected_frame",
        step: 5,
      },
      coverage: ["frame_step_5", "capability_gated_opcode"],
    },
    {
      id: "frame-step6-unknown-flag-bits",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 3, value: 0x20 }]),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "unknown_flag_bits",
        offset: 2,
        plane: "selected_frame",
        step: 6,
      },
      coverage: ["frame_step_6"],
    },
    {
      id: "frame-step7-fragment-prohibited",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u16be", offset: 2, value: FLAG_FRAGMENT },
      ]),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "fragment_prohibited",
        offset: 2,
        plane: "selected_frame",
        step: 7,
      },
      coverage: ["frame_step_7", "flag_fragment", "fragment"],
    },
    {
      id: "frame-step7-keyframe-opcode",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u16be", offset: 2, value: FLAG_KEYFRAME },
      ]),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "keyframe_opcode",
        offset: 2,
        plane: "selected_frame",
        step: 7,
      },
      coverage: ["frame_step_7", "flag_keyframe", "keyframe"],
    },
    {
      id: "frame-step7-ros-reliable-opcode",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_SERVICE_REQUEST,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          flags: FLAG_ROS_RELIABLE,
          extension: new Uint8Array(0),
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "ros_flag_opcode",
        offset: 2,
        plane: "selected_frame",
        step: 7,
      },
      coverage: ["frame_step_7", "flag_ros_reliable", "ros_reliable"],
    },
    {
      id: "frame-step7-retained-opcode",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_MEDIA_CHUNK,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          flags: FLAG_RETAINED,
          extension: new Uint8Array(0),
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "ros_flag_opcode",
        offset: 2,
        plane: "selected_frame",
        step: 7,
      },
      coverage: ["frame_step_7", "flag_retained", "retained"],
    },
    {
      id: "frame-step8-control-on-app-channel",
      kind: "frame",
      source: mutateHex(toHex(ctrl), [
        { op: "set_u32be", offset: 4, value: 1 },
      ]),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "channel_class",
        offset: 4,
        plane: "selected_frame",
        step: 8,
      },
      coverage: ["frame_step_8", "channel_class", "channel_control_on_app"],
    },
    {
      id: "frame-step8-app-on-control-channel",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u32be", offset: 4, value: 0 },
      ]),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "channel_class",
        offset: 4,
        plane: "selected_frame",
        step: 8,
      },
      coverage: ["frame_step_8", "channel_class", "channel_app_on_control"],
    },
    {
      id: "frame-step9-unassigned-priority",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 30, value: 5 }]),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "unassigned_priority",
        offset: 30,
        plane: "selected_frame",
        step: 9,
      },
      coverage: ["frame_step_9", "unassigned_priority"],
    },
    {
      id: "frame-step9-control-priority",
      kind: "frame",
      source: mutateHex(toHex(ctrl), [
        { op: "set_u8", offset: 30, value: PRIORITY_DEFAULT },
      ]),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "control_priority",
        offset: 30,
        plane: "selected_frame",
        step: 9,
      },
      coverage: ["frame_step_9", "control_priority"],
    },
    {
      id: "frame-step10-unassigned-clock",
      kind: "frame",
      source: mutateHex(toHex(app), [{ op: "set_u8", offset: 31, value: 5 }]),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "unassigned_clock",
        offset: 31,
        plane: "selected_frame",
        step: 10,
      },
      coverage: ["frame_step_10"],
    },
    {
      id: "frame-step11-none-nonzero-time",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          sourceTimeNs: 1,
          extension: new Uint8Array(0),
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "none_requires_zero_time",
        offset: 16,
        plane: "selected_frame",
        step: 11,
      },
      coverage: ["frame_step_11"],
    },
    {
      id: "frame-step12-clock-unavailable",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_ROS,
          sourceTimeNs: 1,
          extension: new Uint8Array(0),
          payload: new Uint8Array([1]),
        }),
      ),
      decoder_context: {
        availableClockIds: [CLOCK_NONE, CLOCK_SYSTEM],
      },
      expected: {
        registry_code: 28,
        registry_name: "clock_unavailable",
        reason: "clock_unavailable",
        offset: 31,
        plane: "selected_frame",
        step: 12,
      },
      coverage: ["frame_step_12", "unavailable_clock_context"],
    },
    {
      id: "frame-step13-tlv-padding",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: areaBadPad,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "extension_structural",
        offset: 37,
        plane: "selected_frame",
        step: 13,
      },
      coverage: ["frame_step_13", "tlv_padding"],
    },
    {
      id: "frame-step13-tlv-bounds",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: (() => {
            // TLV header only: declared value_len exceeds remaining extension area.
            const area = new Uint8Array(4);
            area[0] = 128;
            area[1] = 0;
            area[2] = 0;
            area[3] = 10;
            return area;
          })(),
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "extension_structural",
        offset: 36,
        plane: "selected_frame",
        step: 13,
      },
      coverage: ["frame_step_13", "tlv_bounds"],
    },
    {
      id: "frame-step13-descending-order",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: descending,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "extension_structural",
        offset: 52,
        plane: "selected_frame",
        step: 13,
      },
      coverage: ["frame_step_13", "tlv_order"],
    },
    {
      id: "frame-step13-duplicate-type",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: duplicateType,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "extension_structural",
        offset: 52,
        plane: "selected_frame",
        step: 13,
      },
      coverage: ["frame_step_13", "tlv_duplicate"],
    },
    {
      id: "frame-step14-unknown-critical",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: criticalUnknown,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 22,
        registry_name: "unsupported_extension",
        reason: "unknown_critical",
        offset: 32,
        plane: "selected_frame",
        step: 14,
      },
      coverage: ["frame_step_14", "unknown_critical"],
    },
    {
      id: "frame-step15-trace-flag-without-ext",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          flags: FLAG_TRACE_PRESENT,
          extension: new Uint8Array(0),
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "trace_consistency",
        offset: 2,
        plane: "selected_frame",
        step: 15,
      },
      coverage: ["frame_step_15", "trace_flag_without_ext"],
    },
    {
      id: "frame-step15-trace-ext-without-flag",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          flags: 0,
          extension: legalTraceExt,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "trace_consistency",
        offset: 32,
        plane: "selected_frame",
        step: 15,
      },
      coverage: ["frame_step_15", "trace_ext_without_flag"],
    },
    {
      id: "frame-step16-control-indefinite",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          extension: new Uint8Array(0),
          payload: new Uint8Array([0x9f]),
        }),
      ),
      expected: {
        registry_code: 23,
        registry_name: "invalid_control",
        reason: "invalid_control",
        offset: 32,
        plane: "selected_frame",
        step: 16,
      },
      coverage: ["frame_step_16", "control_cbor_profile", "cbor_profile"],
    },
    {
      id: "frame-step16-control-non-shortest",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          extension: new Uint8Array(0),
          payload: new Uint8Array([0xa1, 0x18, 0x01, 0x02]),
        }),
      ),
      expected: {
        registry_code: 23,
        registry_name: "invalid_control",
        reason: "invalid_control",
        offset: 33,
        plane: "selected_frame",
        step: 16,
      },
      coverage: ["frame_step_16", "control_non_shortest_cbor", "non_shortest_cbor"],
    },
    {
      id: "frame-step16-control-duplicate-key",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          extension: new Uint8Array(0),
          payload: new Uint8Array([0xa2, 0x01, 0x02, 0x01, 0x03]),
        }),
      ),
      expected: {
        registry_code: 23,
        registry_name: "invalid_control",
        reason: "invalid_control",
        offset: 35,
        plane: "selected_frame",
        step: 16,
      },
      coverage: ["frame_step_16", "control_duplicate_cbor_key", "duplicate_cbor_key"],
    },
    {
      id: "frame-step16-control-cddl-shape",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          extension: new Uint8Array(0),
          payload: encodeDeterministicCbor(new Map([[1, 999]])),
        }),
      ),
      expected: {
        registry_code: 23,
        registry_name: "invalid_control",
        reason: "invalid_control",
        offset: 32,
        plane: "selected_frame",
        step: 16,
      },
      coverage: ["frame_step_16", "control_cddl_shape", "cddl_shape"],
    },

    // ---- multi-invalid precedence ----
    {
      id: "frame-multi-2-before-3",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u8", offset: 0, value: 1 },
        { op: "set_u16be", offset: 28, value: 4097 },
      ]),
      expected: {
        registry_code: 4,
        registry_name: "unsupported_version",
        reason: "unsupported_version",
        offset: 0,
        plane: "selected_frame",
        step: 2,
      },
      coverage: ["multi_invalid", "precedence_2_before_3"],
    },
    {
      id: "frame-multi-3-before-4",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u32be", offset: 24, value: FRAME_PAYLOAD_MAX_BYTES + 1 },
      ]),
      expected: {
        registry_code: 24,
        registry_name: "message_too_large",
        reason: "payload_too_large",
        offset: 24,
        plane: "selected_frame",
        step: 3,
      },
      coverage: ["multi_invalid", "precedence_3_before_4"],
    },
    {
      id: "frame-multi-5-before-6",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u8", offset: 1, value: 0 },
        { op: "set_u8", offset: 3, value: 0x20 },
      ]),
      expected: {
        registry_code: 5,
        registry_name: "unsupported_opcode",
        reason: "unsupported_opcode",
        offset: 1,
        plane: "selected_frame",
        step: 5,
      },
      coverage: ["multi_invalid", "precedence_5_before_6"],
    },
    {
      id: "frame-multi-6-before-8",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u8", offset: 3, value: 0x20 },
        { op: "set_u32be", offset: 4, value: 0 },
      ]),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "unknown_flag_bits",
        offset: 2,
        plane: "selected_frame",
        step: 6,
      },
      coverage: ["multi_invalid", "precedence_6_before_8"],
    },
    {
      id: "frame-multi-7-before-8",
      kind: "frame",
      source: mutateHex(toHex(app), [
        { op: "set_u16be", offset: 2, value: FLAG_FRAGMENT },
        { op: "set_u32be", offset: 4, value: 0 },
      ]),
      expected: {
        registry_code: 6,
        registry_name: "unsupported_flags",
        reason: "fragment_prohibited",
        offset: 2,
        plane: "selected_frame",
        step: 7,
      },
      coverage: ["multi_invalid", "precedence_7_before_8"],
    },
    {
      id: "frame-multi-9-before-16",
      kind: "frame",
      source: mutateHex(
        toHex(
          assembleFrame({
            opcode: OPCODE_CONTROL_CBOR,
            channelId: 0,
            priority: PRIORITY_CONTROL,
            clockId: CLOCK_NONE,
            extension: new Uint8Array(0),
            payload: new Uint8Array([0x9f]),
          }),
        ),
        [{ op: "set_u8", offset: 30, value: 5 }],
      ),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "unassigned_priority",
        offset: 30,
        plane: "selected_frame",
        step: 9,
      },
      coverage: ["multi_invalid", "precedence_9_before_16"],
    },
    {
      id: "frame-multi-12-before-13",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_ROS,
          sourceTimeNs: 1,
          extension: areaBadPad,
          payload: new Uint8Array([1]),
        }),
      ),
      decoder_context: { availableClockIds: [CLOCK_NONE, CLOCK_SYSTEM] },
      expected: {
        registry_code: 28,
        registry_name: "clock_unavailable",
        reason: "clock_unavailable",
        offset: 31,
        plane: "selected_frame",
        step: 12,
      },
      coverage: ["multi_invalid", "precedence_12_before_13"],
    },
    {
      id: "frame-multi-13-before-14",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extension: structuralThenCritical,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 3,
        registry_name: "malformed_frame",
        reason: "extension_structural",
        offset: 37,
        plane: "selected_frame",
        step: 13,
      },
      coverage: ["multi_invalid", "precedence_13_before_14"],
    },
    {
      id: "frame-multi-14-before-15",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          flags: FLAG_TRACE_PRESENT,
          extension: criticalUnknown,
          payload: new Uint8Array([1]),
        }),
      ),
      expected: {
        registry_code: 22,
        registry_name: "unsupported_extension",
        reason: "unknown_critical",
        offset: 32,
        plane: "selected_frame",
        step: 14,
      },
      coverage: ["multi_invalid", "precedence_14_before_15"],
    },
    {
      id: "frame-multi-15-before-16",
      kind: "frame",
      source: hexSrc(
        assembleFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          flags: FLAG_TRACE_PRESENT,
          extension: new Uint8Array(0),
          payload: new Uint8Array([0x9f]),
        }),
      ),
      expected: {
        registry_code: 25,
        registry_name: "protocol_violation",
        reason: "trace_consistency",
        offset: 2,
        plane: "selected_frame",
        step: 15,
      },
      coverage: ["multi_invalid", "precedence_15_before_16"],
    },
    // bootstrap multi: 2 before 3
    {
      id: "bootstrap-multi-2-before-3",
      kind: "bootstrap",
      source: mutateHex(toHex(bootstrapPrefix(1, helloPayload, 0, 1)), [
        { op: "set_u8", offset: 0, value: 0 },
      ]),
      expected: {
        registry_code: 1,
        registry_name: "malformed_bootstrap",
        reason: "bad_magic",
        offset: 0,
        plane: "bootstrap",
        step: 2,
      },
      coverage: ["multi_invalid", "bootstrap_precedence_2_before_3"],
    },
  ];

  return defs;
}

export const REQUIRED_COVERAGE = [
  "bootstrap_step_1",
  "bootstrap_step_2",
  "bootstrap_step_3",
  "bootstrap_step_4",
  "bootstrap_step_5",
  "bootstrap_step_6",
  "bootstrap_step_7",
  "bootstrap_step_8",
  "bootstrap_step_9",
  "bootstrap_truncation",
  "bootstrap_trailing_bytes",
  "bootstrap_duplicate_cbor_key",
  "bootstrap_non_shortest_cbor",
  "bootstrap_precedence_2_before_3",
  "frame_step_1",
  "frame_step_2",
  "frame_step_3",
  "frame_step_4",
  "frame_step_5",
  "frame_step_6",
  "frame_step_7",
  "frame_step_8",
  "frame_step_9",
  "frame_step_10",
  "frame_step_11",
  "frame_step_12",
  "frame_step_13",
  "frame_step_14",
  "frame_step_15",
  "frame_step_16",
  "frame_truncation",
  "frame_trailing_bytes",
  "extension_overflow",
  "payload_overflow",
  "unassigned_opcode",
  "capability_gated_opcode",
  "flag_fragment",
  "flag_keyframe",
  "flag_ros_reliable",
  "flag_retained",
  "channel_control_on_app",
  "channel_app_on_control",
  "unassigned_priority",
  "control_priority",
  "unavailable_clock_context",
  "tlv_bounds",
  "tlv_padding",
  "tlv_order",
  "tlv_duplicate",
  "unknown_critical",
  "trace_flag_without_ext",
  "trace_ext_without_flag",
  "control_duplicate_cbor_key",
  "control_non_shortest_cbor",
  "control_cddl_shape",
  "defensive_equivalence",
  "duplicate_cbor_key",
  "non_shortest_cbor",
  "multi_invalid",
  "precedence_2_before_3",
  "precedence_3_before_4",
  "precedence_5_before_6",
  "precedence_6_before_8",
  "precedence_7_before_8",
  "precedence_9_before_16",
  "precedence_12_before_13",
  "precedence_13_before_14",
  "precedence_14_before_15",
  "precedence_15_before_16",
] as const;


// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

export function buildManifest(): Manifest {
  const defs = buildFixtureDefs();
  const alloc = { used: 0 };
  const fixtures: MalformedFixtureEntry[] = [];

  for (const def of defs) {
    const coverage = sortAscii([...new Set(def.coverage)]);
    if (def.representation === "defensive_equivalence") {
      fixtures.push({
        id: def.id,
        kind: def.kind,
        path: null,
        representation: "defensive_equivalence",
        byte_length: 0,
        sha256: sha256Hex(new Uint8Array(0)),
        source: def.source as { $type: "defensive_equivalence"; claim: string },
        decoder_context: def.decoder_context ?? {},
        expected: def.expected,
        coverage,
      });
      continue;
    }
    const bytes = materializeSource(def.source as ConstructionSource, alloc);
    const id = def.id;
    fixtures.push({
      id,
      kind: def.kind,
      path: `malformed/${id}.bin`,
      representation: "binary",
      byte_length: bytes.length,
      sha256: sha256Hex(bytes),
      source: def.source as ConstructionSource,
      decoder_context: def.decoder_context ?? {},
      expected: def.expected,
      coverage,
    });
  }

  fixtures.sort((a, b) => asciiCompare(a.id, b.id));

  return {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    byte_order: "network",
    generated_by: GENERATED_BY,
    bootstrap_step6_defensive_equivalence: {
      plane: "bootstrap",
      step: 6,
      u16_maximum: U16_MAX,
      absolute_ceiling_bytes: BOOTSTRAP_PAYLOAD_MAX_BYTES,
      claim:
        "step 6 is represented by defensive-equivalence metadata because u16 maximum equals the absolute 65535-byte ceiling",
    },
    fixtures,
  };
}

export function materializeFixtureBytes(
  entry: MalformedFixtureEntry,
  alloc: { used: number } = { used: 0 },
): Uint8Array | null {
  if (entry.representation === "defensive_equivalence") return null;
  return materializeSource(entry.source as ConstructionSource, alloc);
}

// ---------------------------------------------------------------------------
// Decode invocation
// ---------------------------------------------------------------------------

export function invokeDecode(
  entry: MalformedFixtureEntry,
  bytes: Uint8Array,
): { code: string; reason: string; offset: number } {
  const ctx = entry.decoder_context ?? {};
  if (entry.kind === "bootstrap") {
    try {
      decodeBootstrapRecord(bytes);
      throw new Error("expected BootstrapCodecError");
    } catch (e) {
      if (!(e instanceof BootstrapCodecError)) throw e;
      return { code: e.code, reason: e.reason, offset: e.offset };
    }
  }
  const opts: FrameDecodeOptions = {};
  if (ctx.selectedVersion !== undefined) opts.selectedVersion = ctx.selectedVersion;
  if (ctx.experimentalOpcodesEnabled !== undefined) {
    opts.experimentalOpcodesEnabled = ctx.experimentalOpcodesEnabled;
  }
  if (ctx.availableClockIds !== undefined) {
    opts.availableClockIds = ctx.availableClockIds;
  }
  try {
    decodeFrame(bytes, opts);
    throw new Error("expected FrameCodecError");
  } catch (e) {
    if (!(e instanceof FrameCodecError)) throw e;
    return { code: e.code, reason: e.reason, offset: e.offset };
  }
}

// Map registry name to TypeScript error code string (usually identical).
function registryNameToTsCode(name: string): string {
  return name;
}

// ---------------------------------------------------------------------------
// Closed validation
// ---------------------------------------------------------------------------

export function diagnoseManifest(
  value: unknown,
  registry: RegistryIndex,
): string[] {
  const diags: string[] = [];
  if (value === null) {
    diags.push("root: must be object, got null");
    return sortAscii(diags);
  }
  if (!isPlainObject(value)) {
    diags.push(`root: must be object, got ${typeof value}`);
    return sortAscii(diags);
  }
  exactKeys(value, MANIFEST_KEYS, "root", diags);
  requireKeys(value, MANIFEST_KEYS, "root", diags);
  if (value.schema_version !== SCHEMA_VERSION) {
    diags.push(`root: schema_version must be ${SCHEMA_VERSION}`);
  }
  if (value.protocol !== PROTOCOL_ID) {
    diags.push(`root: protocol must be ${PROTOCOL_ID}`);
  }
  if (value.byte_order !== "network") {
    diags.push("root: byte_order must be network");
  }
  if (value.generated_by !== GENERATED_BY) {
    diags.push(`root: generated_by must be ${GENERATED_BY}`);
  }

  const step6 = value.bootstrap_step6_defensive_equivalence;
  if (!isPlainObject(step6)) {
    diags.push("root: bootstrap_step6_defensive_equivalence must be object");
  } else {
    exactKeys(step6, STEP6_KEYS, "bootstrap_step6_defensive_equivalence", diags);
    requireKeys(step6, STEP6_KEYS, "bootstrap_step6_defensive_equivalence", diags);
    if (step6.plane !== "bootstrap") {
      diags.push("bootstrap_step6_defensive_equivalence: plane must be bootstrap");
    }
    if (step6.step !== 6) {
      diags.push("bootstrap_step6_defensive_equivalence: step must be 6");
    }
    if (step6.u16_maximum !== U16_MAX) {
      diags.push("bootstrap_step6_defensive_equivalence: u16_maximum must be 65535");
    }
    if (step6.absolute_ceiling_bytes !== BOOTSTRAP_PAYLOAD_MAX_BYTES) {
      diags.push(
        "bootstrap_step6_defensive_equivalence: absolute_ceiling_bytes must equal BOOTSTRAP_PAYLOAD_MAX_BYTES",
      );
    }
    if (BOOTSTRAP_PAYLOAD_MAX_BYTES !== U16_MAX) {
      diags.push(
        "bootstrap_step6_defensive_equivalence: u16 maximum must equal absolute ceiling",
      );
    }
    if (typeof step6.claim !== "string" || step6.claim.length === 0 || step6.claim.length > CLAIM_MAX) {
      diags.push("bootstrap_step6_defensive_equivalence: claim length out of bounds");
    }
  }

  if (!Array.isArray(value.fixtures)) {
    diags.push("root: fixtures must be array");
    return sortAscii(diags);
  }
  if (value.fixtures.length > FIXTURE_COUNT_MAX) {
    diags.push(`root: fixtures count exceeds ${FIXTURE_COUNT_MAX}`);
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  const coverageSeen = new Set<string>();
  let prevId = "";
  value.fixtures.forEach((raw, i) => {
    const fp = `fixtures/${i}`;
    if (!isPlainObject(raw)) {
      diags.push(`${fp}: must be object`);
      return;
    }
    exactKeys(raw, FIXTURE_KEYS, fp, diags);
    requireKeys(raw, FIXTURE_KEYS, fp, diags);

    if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id) || raw.id.length > ID_MAX_LEN) {
      diags.push(`${fp}: id must match ${ID_PATTERN} and length 1..${ID_MAX_LEN}`);
    } else {
      if (ids.has(raw.id)) diags.push(`${fp}: duplicate id ${raw.id}`);
      ids.add(raw.id);
      if (prevId && asciiCompare(prevId, raw.id) >= 0) {
        diags.push(`${fp}: fixtures must be sorted by id`);
      }
      prevId = raw.id;
    }

    if (raw.kind !== "bootstrap" && raw.kind !== "frame") {
      diags.push(`${fp}: kind must be bootstrap|frame`);
    }
    if (raw.representation !== "binary" && raw.representation !== "defensive_equivalence") {
      diags.push(`${fp}: invalid representation`);
    }

    if (!isPlainObject(raw.expected)) {
      diags.push(`${fp}: expected must be object`);
    } else {
      exactKeys(raw.expected, EXPECTED_KEYS, `${fp}/expected`, diags);
      requireKeys(raw.expected, EXPECTED_KEYS, `${fp}/expected`, diags);
      const exp = raw.expected;
      if (typeof exp.registry_code !== "number" || !Number.isSafeInteger(exp.registry_code) || exp.registry_code < 0 || exp.registry_code > 255) {
        diags.push(`${fp}/expected: registry_code must be safe integer 0..255`);
      }
      if (typeof exp.registry_name !== "string" || exp.registry_name.length === 0 || exp.registry_name.length > STRING_FIELD_MAX) {
        diags.push(`${fp}/expected: registry_name length out of bounds`);
      }
      if (typeof exp.reason !== "string" || exp.reason.length === 0 || exp.reason.length > STRING_FIELD_MAX) {
        diags.push(`${fp}/expected: reason must be nonempty string within bounds`);
      }
      if (typeof exp.offset !== "number" || !Number.isSafeInteger(exp.offset) || exp.offset < 0 || exp.offset > PER_FIXTURE_ALLOC_MAX) {
        diags.push(`${fp}/expected: offset must be safe integer 0..PER_FIXTURE_ALLOC_MAX`);
      }
      if (exp.plane !== "bootstrap" && exp.plane !== "selected_frame") {
        diags.push(`${fp}/expected: plane must be bootstrap|selected_frame`);
      }
      if (typeof exp.step !== "number" || !Number.isSafeInteger(exp.step) || exp.step < 1 || exp.step > 64) {
        diags.push(`${fp}/expected: step must be safe integer 1..64`);
      }
      if (raw.kind === "bootstrap" && exp.plane !== "bootstrap") {
        diags.push(`${fp}: bootstrap kind requires bootstrap plane`);
      }
      if (raw.kind === "frame" && exp.plane !== "selected_frame") {
        diags.push(`${fp}: frame kind requires selected_frame plane`);
      }
      if (
        typeof exp.registry_code === "number" &&
        typeof exp.registry_name === "string" &&
        typeof exp.plane === "string" &&
        typeof exp.step === "number" &&
        typeof exp.reason === "string" &&
        typeof exp.offset === "number"
      ) {
        for (const d of crossBindExpected(
          {
            registry_code: exp.registry_code,
            registry_name: exp.registry_name,
            reason: exp.reason,
            offset: exp.offset,
            plane: exp.plane as ValidationPlane,
            step: exp.step,
          },
          registry,
        )) {
          diags.push(`${fp}/expected: ${d}`);
        }
      }
    }

    if (raw.representation === "binary") {
      if (typeof raw.path === "string") {
        if (paths.has(raw.path)) {
          diags.push(`${fp}: duplicate path ${raw.path}`);
        } else {
          paths.add(raw.path);
        }
        if (typeof raw.id === "string") {
          if (!isCanonicalMalformedEntryPath(raw.id, raw.path)) {
            diags.push(`${fp}: path must be exactly malformed/<id>.bin`);
          }
        } else if (!isCanonicalMalformedPath(raw.path)) {
          diags.push(`${fp}: path must be canonical malformed/*.bin`);
        }
      } else {
        diags.push(`${fp}: path must be exactly malformed/<id>.bin`);
      }
      if (
        typeof raw.byte_length !== "number" ||
        !Number.isSafeInteger(raw.byte_length) ||
        raw.byte_length < 0 ||
        raw.byte_length > PER_FIXTURE_ALLOC_MAX
      ) {
        diags.push(`${fp}: byte_length out of range`);
      }
      if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
        diags.push(`${fp}: sha256 must be 64 lowercase hex`);
      }
    } else {
      if (raw.path !== null) diags.push(`${fp}: defensive_equivalence path must be null`);
      if (raw.byte_length !== 0) diags.push(`${fp}: defensive_equivalence byte_length must be 0`);
      if (raw.sha256 !== sha256Hex(new Uint8Array(0))) {
        diags.push(`${fp}: defensive_equivalence sha256 must be empty digest`);
      }
    }

    if (!isPlainObject(raw.decoder_context)) {
      diags.push(`${fp}: decoder_context must be object`);
    } else {
      exactKeys(raw.decoder_context, DECODER_CONTEXT_KEYS, `${fp}/decoder_context`, diags);
      const ctx = raw.decoder_context;
      if (Object.prototype.hasOwnProperty.call(ctx, "selectedVersion")) {
        if (typeof ctx.selectedVersion !== "number" || !Number.isSafeInteger(ctx.selectedVersion) || ctx.selectedVersion < 0 || ctx.selectedVersion > 255) {
          diags.push(`${fp}/decoder_context: selectedVersion must be safe integer 0..255`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(ctx, "experimentalOpcodesEnabled")) {
        if (typeof ctx.experimentalOpcodesEnabled !== "boolean") {
          diags.push(`${fp}/decoder_context: experimentalOpcodesEnabled must be boolean`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(ctx, "availableClockIds")) {
        if (!Array.isArray(ctx.availableClockIds)) {
          diags.push(`${fp}/decoder_context: availableClockIds must be array`);
        } else if (ctx.availableClockIds.length > 5) {
          diags.push(`${fp}/decoder_context: availableClockIds max length 5`);
        } else {
          let prev = -1;
          const seen = new Set<number>();
          for (const c of ctx.availableClockIds) {
            if (typeof c !== "number" || !Number.isSafeInteger(c) || !(ASSIGNED_CLOCK_IDS as readonly number[]).includes(c)) {
              diags.push(`${fp}/decoder_context: availableClockIds entries must be assigned clocks 0..4`);
              break;
            }
            if (seen.has(c)) {
              diags.push(`${fp}/decoder_context: availableClockIds must be unique`);
              break;
            }
            seen.add(c);
            if (c <= prev) {
              diags.push(`${fp}/decoder_context: availableClockIds must be sorted ascending`);
              break;
            }
            prev = c;
          }
        }
      }
    }

    if (!Array.isArray(raw.coverage)) {
      diags.push(`${fp}: coverage must be array`);
    } else if (raw.coverage.length > COVERAGE_PER_FIXTURE_MAX) {
      diags.push(`${fp}: coverage exceeds ${COVERAGE_PER_FIXTURE_MAX}`);
    } else {
      let prev = "";
      const local = new Set<string>();
      for (const c of raw.coverage) {
        if (typeof c !== "string" || c.length === 0 || c.length > STRING_FIELD_MAX) {
          diags.push(`${fp}: coverage entries must be nonempty strings within bounds`);
          continue;
        }
        if (local.has(c)) diags.push(`${fp}: duplicate coverage ${c}`);
        local.add(c);
        coverageSeen.add(c);
        if (prev && asciiCompare(prev, c) >= 0) {
          diags.push(`${fp}: coverage must be sorted unique`);
        }
        prev = c;
      }
    }

    validateSource(raw.source, `${fp}/source`, diags, raw.representation as Representation);
  });

  for (const req of REQUIRED_COVERAGE) {
    if (!coverageSeen.has(req)) {
      diags.push(`coverage: missing required token ${req}`);
    }
  }
  return sortAscii(diags);
}

function validateSource(
  source: unknown,
  sp: string,
  diags: string[],
  representation: Representation,
): void {
  if (!isPlainObject(source)) {
    diags.push(`${sp}: must be object`);
    return;
  }
  if (representation === "defensive_equivalence") {
    exactKeys(source, ["$type", "claim"], sp, diags);
    requireKeys(source, ["$type", "claim"], sp, diags);
    if (source.$type !== "defensive_equivalence") {
      diags.push(`${sp}: $type must be defensive_equivalence`);
    }
    if (typeof source.claim !== "string" || source.claim.length === 0 || source.claim.length > CLAIM_MAX) {
      diags.push(`${sp}: claim length out of bounds`);
    }
    return;
  }
  if (source.$type === "hex") {
    exactKeys(source, ["$type", "hex"], sp, diags);
    requireKeys(source, ["$type", "hex"], sp, diags);
    if (
      typeof source.hex !== "string" ||
      !/^[0-9a-f]*$/.test(source.hex) ||
      source.hex.length % 2 !== 0
    ) {
      diags.push(`${sp}: hex must be lowercase even-length`);
    } else if (source.hex.length / 2 > HEX_LITERAL_MAX_BYTES) {
      diags.push(`${sp}: hex exceeds max bytes`);
    }
    return;
  }
  if (source.$type === "mutate") {
    exactKeys(source, ["$type", "base", "ops"], sp, diags);
    requireKeys(source, ["$type", "base", "ops"], sp, diags);
    let curLen = -1;
    if (!isPlainObject(source.base)) {
      diags.push(`${sp}/base: must be object`);
    } else {
      exactKeys(source.base, ["$type", "hex"], `${sp}/base`, diags);
      requireKeys(source.base, ["$type", "hex"], `${sp}/base`, diags);
      if (source.base.$type !== "hex") {
        diags.push(`${sp}/base: $type must be hex`);
      }
      if (
        typeof source.base.hex !== "string" ||
        !/^[0-9a-f]*$/.test(source.base.hex) ||
        source.base.hex.length % 2 !== 0
      ) {
        diags.push(`${sp}/base: hex must be lowercase even-length`);
      } else if (source.base.hex.length / 2 > HEX_LITERAL_MAX_BYTES) {
        diags.push(`${sp}/base: hex exceeds max bytes`);
      } else {
        curLen = source.base.hex.length / 2;
      }
    }
    if (!Array.isArray(source.ops)) {
      diags.push(`${sp}/ops: must be array`);
      return;
    }
    if (source.ops.length > MUTATION_OPS_MAX) {
      diags.push(`${sp}/ops: exceeds ${MUTATION_OPS_MAX}`);
    }
    // Sequential length tracking: each op validates against current length.
    let appendTotal = 0;
    let aborted = curLen < 0;
    for (let i = 0; i < source.ops.length; i++) {
      const op = source.ops[i];
      const opPath = `${sp}/ops/${i}`;
      if (!isPlainObject(op) || typeof op.op !== "string") {
        diags.push(`${opPath}: invalid op`);
        aborted = true;
        continue;
      }
      const allowed = OP_KEYS[op.op];
      if (!allowed) {
        diags.push(`${opPath}: unknown op ${op.op}`);
        aborted = true;
        continue;
      }
      exactKeys(op, allowed, opPath, diags);
      requireKeys(op, allowed, opPath, diags);
      if (aborted || curLen < 0) continue;
      switch (op.op) {
        case "truncate": {
          if (typeof op.length !== "number" || !Number.isSafeInteger(op.length) || op.length < 0) {
            diags.push(`${opPath}: length must be non-negative safe integer`);
            aborted = true;
          } else if (op.length > curLen) {
            diags.push(`${opPath}: length exceeds current length ${curLen}`);
            aborted = true;
          } else {
            curLen = op.length;
          }
          break;
        }
        case "set_u8": {
          if (typeof op.offset !== "number" || !Number.isSafeInteger(op.offset) || op.offset < 0) {
            diags.push(`${opPath}: offset must be non-negative safe integer`);
            aborted = true;
          } else if (op.offset >= curLen) {
            diags.push(`${opPath}: offset ${op.offset} out of current length ${curLen}`);
            aborted = true;
          }
          if (typeof op.value !== "number" || !Number.isSafeInteger(op.value) || op.value < 0 || op.value > 255) {
            diags.push(`${opPath}: value must be 0..255`);
            aborted = true;
          }
          break;
        }
        case "set_u16be": {
          if (typeof op.offset !== "number" || !Number.isSafeInteger(op.offset) || op.offset < 0) {
            diags.push(`${opPath}: offset must be non-negative safe integer`);
            aborted = true;
          } else if (op.offset + 1 >= curLen) {
            diags.push(`${opPath}: offset ${op.offset} out of current length ${curLen}`);
            aborted = true;
          }
          if (typeof op.value !== "number" || !Number.isSafeInteger(op.value) || op.value < 0 || op.value > 0xffff) {
            diags.push(`${opPath}: value must be 0..65535`);
            aborted = true;
          }
          break;
        }
        case "set_u32be": {
          if (typeof op.offset !== "number" || !Number.isSafeInteger(op.offset) || op.offset < 0) {
            diags.push(`${opPath}: offset must be non-negative safe integer`);
            aborted = true;
          } else if (op.offset + 3 >= curLen) {
            diags.push(`${opPath}: offset ${op.offset} out of current length ${curLen}`);
            aborted = true;
          }
          if (typeof op.value !== "number" || !Number.isSafeInteger(op.value) || op.value < 0 || op.value > 0xffffffff) {
            diags.push(`${opPath}: value must be 0..2^32-1`);
            aborted = true;
          }
          break;
        }
        case "replace_hex": {
          if (typeof op.offset !== "number" || !Number.isSafeInteger(op.offset) || op.offset < 0) {
            diags.push(`${opPath}: offset must be non-negative safe integer`);
            aborted = true;
          }
          if (typeof op.hex !== "string" || !/^[0-9a-f]*$/.test(op.hex) || op.hex.length % 2 !== 0) {
            diags.push(`${opPath}: hex must be lowercase even-length`);
            aborted = true;
          } else {
            const n = op.hex.length / 2;
            if (n > HEX_LITERAL_MAX_BYTES) {
              diags.push(`${opPath}: hex too large`);
              aborted = true;
            } else if (typeof op.offset === "number" && op.offset + n > curLen) {
              diags.push(`${opPath}: replace exceeds current length ${curLen}`);
              aborted = true;
            }
          }
          break;
        }
        case "append_hex": {
          if (typeof op.hex !== "string" || !/^[0-9a-f]*$/.test(op.hex) || op.hex.length % 2 !== 0) {
            diags.push(`${opPath}: hex must be lowercase even-length`);
            aborted = true;
          } else {
            const n = op.hex.length / 2;
            if (n > MUTATION_APPEND_MAX_BYTES) {
              diags.push(`${opPath}: append exceeds ${MUTATION_APPEND_MAX_BYTES}`);
              aborted = true;
            } else {
              appendTotal += n;
              if (appendTotal > MUTATION_APPEND_MAX_BYTES) {
                diags.push(`${opPath}: cumulative append exceeds ${MUTATION_APPEND_MAX_BYTES}`);
                aborted = true;
              } else {
                curLen += n;
                if (curLen > PER_FIXTURE_ALLOC_MAX) {
                  diags.push(`${opPath}: final length would exceed per-fixture ceiling`);
                  aborted = true;
                }
              }
            }
          }
          break;
        }
      }
    }
    if (!aborted && curLen >= 0 && curLen > PER_FIXTURE_ALLOC_MAX) {
      diags.push(`${sp}: final length ${curLen} exceeds per-fixture ceiling`);
    }
    return;
  }
  diags.push(`${sp}: unknown source $type`);
}

/**
 * Walk relative directory components under root with lstat (no intermediate follow).
 * Rejects symlink directories. When createMissing is false, missing components throw
 * without creating anything (check mode is filesystem read-only).
 */
export async function ensureRealDirectoryChain(
  root: string,
  relativeParts: string[],
  createMissing: boolean,
): Promise<void> {
  const rootAbs = path.resolve(root);
  const rootStat = await lstat(rootAbs);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`root is not a real directory: ${rootAbs}`);
  }
  let cur = rootAbs;
  for (const part of relativeParts) {
    const next = path.resolve(cur, part);
    if (!next.startsWith(rootAbs + path.sep) && next !== rootAbs) {
      throw new Error(`path escapes root: ${part}`);
    }
    let st: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      st = await lstat(next);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (!err || err.code !== "ENOENT") throw e;
    }
    if (!st) {
      if (!createMissing) {
        throw new Error(`missing directory: ${relativeParts.join("/")}`);
      }
      // Parent (cur) is already a verified real directory.
      await mkdir(next, { recursive: false });
      st = await lstat(next);
    }
    if (st.isSymbolicLink()) {
      throw new Error(`symlink directory rejected: ${next}`);
    }
    if (!st.isDirectory()) {
      throw new Error(`path is not a directory: ${next}`);
    }
    cur = next;
  }
}

async function lstatRegularFile(
  absPath: string,
  maxBytes: number,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      return { ok: false, error: "symlink file rejected" };
    }
    if (!st.isFile()) {
      return { ok: false, error: "not a regular file" };
    }
    if (st.size > maxBytes) {
      return { ok: false, error: `file size ${st.size} exceeds max ${maxBytes}` };
    }
    return { ok: true, size: st.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readBoundedFile(
  absPath: string,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const meta = await lstatRegularFile(absPath, maxBytes);
  if (!meta.ok) return meta;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(absPath, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > maxBytes) {
        return { ok: false, error: "opened handle is not a bounded regular file" };
      }
      const buf = await fh.readFile();
      if (buf.byteLength > maxBytes) {
        return { ok: false, error: `read size exceeds max ${maxBytes}` };
      }
      return { ok: true, text: buf.toString("utf8") };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readArtifactBytes(
  absPath: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const meta = await lstatRegularFile(absPath, PER_FIXTURE_ALLOC_MAX);
  if (!meta.ok) {
    return {
      ok: false,
      error: meta.error.includes("symlink")
        ? "symlink artifact rejected"
        : meta.error.includes("not a regular")
          ? "artifact is not a regular file"
          : meta.error,
    };
  }
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(absPath, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > PER_FIXTURE_ALLOC_MAX) {
        return { ok: false, error: "opened artifact handle invalid" };
      }
      const buf = await fh.readFile();
      if (buf.byteLength > PER_FIXTURE_ALLOC_MAX) {
        return { ok: false, error: "read artifact exceeds per-fixture ceiling" };
      }
      return { ok: true, bytes: new Uint8Array(buf) };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function writeArtifactBytes(absPath: string, bytes: Uint8Array): Promise<void> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write symlink artifact ${absPath}`);
    }
    if (!st.isFile()) {
      throw new Error(`refusing to write non-regular artifact ${absPath}`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code !== "ENOENT") throw e;
  }
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_TRUNC |
    (fsConstants.O_NOFOLLOW ?? 0);
  const fh = await open(absPath, flags, 0o644);
  try {
    await fh.writeFile(bytes);
  } finally {
    await fh.close();
  }
}

async function loadRegistryFromRoot(root: string): Promise<RegistryIndex> {
  // Validate protocol/registry chain with createMissing=false before any registry read.
  await ensureRealDirectoryChain(root, ["protocol", "registry"], false);
  const regAbs = resolveUnderRoot(root, REGISTRY_REL);
  const read = await readBoundedFile(regAbs, REGISTRY_MAX_BYTES);
  if (!read.ok) {
    throw new Error(`registry: ${read.error}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch (e) {
    throw new Error(`registry: malformed JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return loadRegistryIndex(json);
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

export async function writeMalformedFixtures(root: string): Promise<Manifest> {
  // 1) Validate root/protocol/registry (no create), then load and cross-bind registry.
  const registry = await loadRegistryFromRoot(root);
  const manifest = buildManifest();
  const schemaDiags = diagnoseManifest(manifest, registry);
  if (schemaDiags.length) {
    throw new Error(`manifest schema invalid: ${schemaDiags.join("; ")}`);
  }

  // 2) After registry succeeds, validate/create root/protocol/testdata/malformed.
  // protocol was already verified as a real directory by the registry chain.
  await ensureRealDirectoryChain(root, ["protocol", "testdata", "malformed"], true);
  const dir = resolveUnderRoot(root, MALFORMED_DIR_REL);

  const alloc = { used: 0 };
  const wantNames = new Set<string>();
  for (const entry of manifest.fixtures) {
    if (entry.representation !== "binary" || entry.path === null) continue;
    if (!isCanonicalMalformedEntryPath(entry.id, entry.path)) {
      throw new Error(`non-canonical path ${entry.path} for ${entry.id}`);
    }
    const bytes = materializeFixtureBytes(entry, alloc);
    if (!bytes) throw new Error(`missing bytes for ${entry.id}`);
    if (bytes.length !== entry.byte_length || sha256Hex(bytes) !== entry.sha256) {
      throw new Error(`internal hash drift for ${entry.id}`);
    }
    const got = invokeDecode(entry, bytes);
    const expCode = registryNameToTsCode(entry.expected.registry_name);
    if (
      got.code !== expCode ||
      got.reason !== entry.expected.reason ||
      got.offset !== entry.expected.offset
    ) {
      throw new Error(
        `oracle mismatch ${entry.id}: got ${got.code}/${got.reason}@${got.offset} expected ${expCode}/${entry.expected.reason}@${entry.expected.offset}`,
      );
    }
    const abs = resolveUnderRoot(root, path.posix.join("protocol/testdata", entry.path));
    await writeArtifactBytes(abs, bytes);
    wantNames.add(path.posix.basename(entry.path));
  }
  let existing: string[];
  try {
    existing = await readdir(dir);
  } catch (e) {
    throw new Error(`readdir malformed failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const name of existing) {
    if (!name.endsWith(".bin")) continue;
    if (!wantNames.has(name)) {
      const p = path.join(dir, name);
      const st = await lstat(p);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error(`refusing to unlink non-regular stale artifact ${p}`);
      }
      await unlink(p);
    }
  }
  const manAbs = resolveUnderRoot(root, MANIFEST_REL);
  const manBytes = new TextEncoder().encode(stableManifestJson(manifest));
  await writeArtifactBytes(manAbs, manBytes);
  return manifest;
}

export type CheckResult = {
  diags: string[];
  manifest: Manifest | null;
};

export async function checkMalformedFixtures(root: string): Promise<CheckResult> {
  const diags: string[] = [];

  // Check mode is filesystem read-only: verify existing real directory chains; create zero paths.
  try {
    await ensureRealDirectoryChain(root, ["protocol", "registry"], false);
  } catch (e) {
    return {
      diags: [
        `disk: registry path chain invalid: ${e instanceof Error ? e.message : String(e)}`,
      ],
      manifest: null,
    };
  }
  try {
    await ensureRealDirectoryChain(root, ["protocol", "testdata", "malformed"], false);
  } catch (e) {
    return {
      diags: [
        `disk: malformed path chain invalid: ${e instanceof Error ? e.message : String(e)}`,
      ],
      manifest: null,
    };
  }

  let registry: RegistryIndex;
  try {
    registry = await loadRegistryFromRoot(root);
  } catch (e) {
    return {
      diags: [`registry: failed to load: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }

  const manAbs = resolveUnderRoot(root, MANIFEST_REL);
  const manRead = await readBoundedFile(manAbs, MANIFEST_MAX_BYTES);
  if (!manRead.ok) {
    return {
      diags: [`manifest: ${manRead.error}`],
      manifest: null,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(manRead.text);
  } catch (e) {
    return {
      diags: [`manifest: malformed JSON: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }
  if (raw === null) {
    return { diags: ["manifest: root is null"], manifest: null };
  }

  diags.push(...diagnoseManifest(raw, registry));
  if (diags.length) return { diags: sortAscii(diags), manifest: null };

  const manifest = raw as Manifest;
  const rebuilt = buildManifest();
  const canonical = stableManifestJson(rebuilt);
  // Parsed-object identity (semantic rebuild).
  if (stableManifestJson(manifest) !== canonical) {
    diags.push("manifest: not identical to deterministic rebuild");
    return { diags: sortAscii(diags), manifest: null };
  }
  // Raw byte identity: rejects whitespace, property-order, indentation, trailing-byte,
  // and final-newline drift that JSON.parse would otherwise normalize away.
  if (manRead.text !== canonical) {
    diags.push("manifest: raw text is not canonical stableManifestJson format");
    return { diags: sortAscii(diags), manifest: null };
  }

  const dir = resolveUnderRoot(root, MALFORMED_DIR_REL);
  let onDiskList: string[];
  try {
    onDiskList = await readdir(dir);
  } catch (e) {
    return {
      diags: sortAscii([
        `disk: malformed directory missing or unreadable: ${e instanceof Error ? e.message : String(e)}`,
      ]),
      manifest: null,
    };
  }
  const onDisk = new Set(onDiskList.filter((n) => n.endsWith(".bin")));
  const expectedBins = new Set(
    manifest.fixtures
      .filter((f) => f.representation === "binary" && f.path)
      .map((f) => path.posix.basename(f.path!)),
  );
  for (const n of onDisk) {
    if (!expectedBins.has(n)) diags.push(`disk: extra file ${n}`);
  }
  for (const n of expectedBins) {
    if (!onDisk.has(n)) diags.push(`disk: missing file ${n}`);
  }

  const alloc = { used: 0 };
  for (const entry of manifest.fixtures) {
    const bind = crossBindExpected(entry.expected, registry);
    for (const d of bind) diags.push(`${entry.id}: ${d}`);

    if (entry.representation === "defensive_equivalence") {
      if (BOOTSTRAP_PAYLOAD_MAX_BYTES !== U16_MAX) {
        diags.push(`${entry.id}: u16 max != absolute ceiling`);
      }
      if (
        manifest.bootstrap_step6_defensive_equivalence.absolute_ceiling_bytes !==
        BOOTSTRAP_PAYLOAD_MAX_BYTES
      ) {
        diags.push(`${entry.id}: manifest ceiling mismatch`);
      }
      continue;
    }

    if (!entry.path || !isCanonicalMalformedEntryPath(entry.id, entry.path)) {
      diags.push(`${entry.id}: bad path (canonical id/path gate)`);
      continue;
    }

    let reconstructed: Uint8Array;
    try {
      reconstructed = materializeFixtureBytes(entry, alloc)!;
    } catch (e) {
      diags.push(
        `${entry.id}: reconstruct failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (reconstructed.length !== entry.byte_length) {
      diags.push(
        `${entry.id}: reconstructed length ${reconstructed.length} != ${entry.byte_length}`,
      );
    }
    const reconHash = sha256Hex(reconstructed);
    if (reconHash !== entry.sha256) {
      diags.push(`${entry.id}: reconstructed sha256 mismatch`);
    }

    const abs = resolveUnderRoot(root, path.posix.join("protocol/testdata", entry.path));
    const read = await readArtifactBytes(abs);
    if (!read.ok) {
      diags.push(`${entry.id}: ${read.error}`);
      continue;
    }
    const disk = read.bytes;
    if (disk.length !== entry.byte_length) {
      diags.push(`${entry.id}: disk length ${disk.length} != ${entry.byte_length}`);
    }
    if (sha256Hex(disk) !== entry.sha256) {
      diags.push(`${entry.id}: disk sha256 mismatch`);
    }
    if (!bytesEqual(disk, reconstructed)) {
      diags.push(`${entry.id}: disk bytes differ from reconstructed bytes`);
    }

    try {
      const got = invokeDecode(entry, disk);
      const expCode = registryNameToTsCode(entry.expected.registry_name);
      if (got.code !== expCode) {
        diags.push(`${entry.id}: decode code ${got.code} != ${expCode}`);
      }
      if (got.reason !== entry.expected.reason) {
        diags.push(
          `${entry.id}: decode reason ${got.reason} != ${entry.expected.reason}`,
        );
      }
      if (got.offset !== entry.expected.offset) {
        diags.push(
          `${entry.id}: decode offset ${got.offset} != ${entry.expected.offset}`,
        );
      }
    } catch (e) {
      diags.push(
        `${entry.id}: decode threw unexpected: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const sorted = sortAscii(diags);
  return {
    diags: sorted,
    manifest: sorted.length === 0 ? manifest : null,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Exactly one argv item: --write or --check. */
export function parseCliMode(argv: string[]): "write" | "check" | null {
  if (argv.length !== 1) return null;
  if (argv[0] === "--write") return "write";
  if (argv[0] === "--check") return "check";
  return null;
}

export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const mode = parseCliMode(argv);
  if (!mode) {
    console.error(
      "usage: bun run scripts/protocol-malformed-fixtures.ts --write|--check",
    );
    return 2;
  }
  if (mode === "write") {
    try {
      const m = await writeMalformedFixtures(root);
      console.log(
        `status=ok mode=write fixtures=${m.fixtures.length} schema_version=${m.schema_version}`,
      );
      return 0;
    } catch (e) {
      console.error(`status=fail write: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  const { diags, manifest } = await checkMalformedFixtures(root);
  if (diags.length || !manifest) {
    for (const d of diags) console.error(d);
    console.error(`status=fail diagnostics=${diags.length}`);
    return 1;
  }
  console.log(
    `status=ok mode=check fixtures=${manifest.fixtures.length} schema_version=${manifest.schema_version}`,
  );
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
