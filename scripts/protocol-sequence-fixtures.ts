#!/usr/bin/env bun
/**
 * R2WP v0 receiver state-sequence fixture generator and checker (M0-03e2).
 *
 * --write  regenerates protocol/testdata/sequences/{manifest.json,scenarios,events}
 * --check  parses committed disk artifacts as data and replays them through codecs + state oracle
 *
 * Deterministic: no timestamps, host paths, or locale-dependent ordering.
 * Valid/boundary and malformed corpora remain separately owned.
 * buildCorpus is the deterministic writer/reference only; --check never substitutes it for disk.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  unlink,
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import {
  decodeBootstrapRecord,
  encodeBootstrapRecord,
  type BootstrapRecord,
} from "../sdk/typescript/src/protocol/bootstrap.ts";
import {
  CONTROL_KIND_AUTHENTICATE,
  CONTROL_KIND_CHANNEL_READY,
  CONTROL_KIND_OPEN_CHANNEL,
  CONTROL_KIND_SESSION_READY,
  CONTROL_KIND_SESSION_RESUME,
  CONTROL_KIND_SESSION_RESUME_RESULT,
  decodeControlMessage,
  type ControlMessage,
} from "../sdk/typescript/src/protocol/control.ts";
import {
  CLOCK_NONE,
  FLAG_ROS_RELIABLE,
  OPCODE_CONTROL_CBOR,
  OPCODE_ROS_SAMPLE,
  PRIORITY_CONTROL,
  PRIORITY_DEFAULT,
  decodeFrame,
  encodeFrame,
} from "../sdk/typescript/src/protocol/frame.ts";
import type { CborValue } from "../sdk/typescript/src/protocol/cbor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEQUENCES_DIR_REL = "protocol/testdata/sequences";
export const MANIFEST_REL = "protocol/testdata/sequences/manifest.json";
export const SCENARIOS_DIR_REL = "protocol/testdata/sequences/scenarios";
export const EVENTS_DIR_REL = "protocol/testdata/sequences/events";
export const REGISTRY_REL = "protocol/registry/r2wp-v0.json";
export const GENERATED_BY = "scripts/protocol-sequence-fixtures.ts";
export const SCHEMA_VERSION = 1;
export const PROTOCOL_ID = "r2wp-v0";
export const MANIFEST_MAX_BYTES = 512 * 1024;
export const REGISTRY_MAX_BYTES = 2 * 1024 * 1024;
export const SCENARIO_MAX_BYTES = 256 * 1024;
export const EVENT_MAX_BYTES = 64 * 1024;
export const PER_EVENT_ALLOC_MAX = 64 * 1024;
export const SCENARIO_COUNT_MAX = 64;
export const EVENT_COUNT_MAX = 256;
export const ID_MAX_LEN = 128;
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/;
export const STRING_FIELD_MAX = 256;
export const COVERAGE_MAX = 64;

export const PHASE_ONE_ROWS = {
  "H-FT": { distro: "humble", rmw: "rmw_fastrtps_cpp" },
  "H-CY": { distro: "humble", rmw: "rmw_cyclonedds_cpp" },
  "J-FT": { distro: "jazzy", rmw: "rmw_fastrtps_cpp" },
  "J-CY": { distro: "jazzy", rmw: "rmw_cyclonedds_cpp" },
} as const;

export type SupportRowId = keyof typeof PHASE_ONE_ROWS;

const MANIFEST_KEYS = [
  "schema_version",
  "protocol",
  "byte_order",
  "generated_by",
  "scenarios",
  "events",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
export function sortAscii(xs: string[]): string[] {
  return [...xs].sort(asciiCompare);
}
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new Error("hex must be lowercase even-length");
  }
  if (hex.length / 2 > PER_EVENT_ALLOC_MAX) throw new Error("hex too large");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Uint8Array);
}
function exactKeys(obj: Record<string, unknown>, allowed: readonly string[], p: string, diags: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) diags.push(`${p}: unknown key "${k}"`);
}
function requireKeys(obj: Record<string, unknown>, required: readonly string[], p: string, diags: string[]): void {
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(obj, k)) diags.push(`${p}: missing key "${k}"`);
}
function corr(n: number): Uint8Array {
  const b = new Uint8Array(16);
  b[0] = n & 0xff;
  return b;
}
function schemaId(): Map<number, CborValue> {
  return new Map<number, CborValue>([
    [1, "moonspan-schema-v1"],
    [2, "a".repeat(64)],
  ]);
}
function qosKeepLast(): Map<number, CborValue> {
  return new Map<number, CborValue>([[1, 1], [2, 1], [3, 1], [4, 1], [7, 1]]);
}
function budgets(): Map<number, CborValue> {
  return new Map<number, CborValue>([[1, 64], [3, 65536]]);
}
function negCaps(withResume: boolean): Map<number, CborValue> {
  return new Map<number, CborValue>([
    [1, new Map<number, CborValue>([[1, true], [2, true], [3, 1200]])],
    [2, new Map<number, CborValue>([[1, true], [2, false]])],
    [3, withResume ? [1] : []],
  ]);
}
function controlFrame(msg: ControlMessage): Uint8Array {
  return encodeFrame({
    opcode: OPCODE_CONTROL_CBOR,
    channelId: 0,
    sequence: 0,
    sourceTimeNs: 0,
    priority: PRIORITY_CONTROL,
    clockId: CLOCK_NONE,
    payload: msg,
  });
}
function rosSample(channelId: number, sequence: number, reliable: boolean): Uint8Array {
  return encodeFrame({
    opcode: OPCODE_ROS_SAMPLE,
    channelId,
    sequence,
    sourceTimeNs: 0,
    priority: PRIORITY_DEFAULT,
    clockId: CLOCK_NONE,
    flags: reliable ? FLAG_ROS_RELIABLE : 0,
    payload: new Uint8Array([0x01, 0x02, 0x03]),
  });
}

// ---------------------------------------------------------------------------
// Path safety (hardened, matching M0-03e1)
// ---------------------------------------------------------------------------

export function isCanonicalScenarioPath(id: string, rel: string): boolean {
  return ID_PATTERN.test(id) && rel === `scenarios/${id}.json`;
}
export function isCanonicalEventPath(id: string, rel: string): boolean {
  return ID_PATTERN.test(id) && rel === `events/${id}.bin`;
}
export function resolveUnderRoot(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error(`path escapes root: ${rel}`);
  return abs;
}
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
    if (!next.startsWith(rootAbs + path.sep) && next !== rootAbs) throw new Error(`path escapes root: ${part}`);
    let st: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      st = await lstat(next);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (!err || err.code !== "ENOENT") throw e;
    }
    if (!st) {
      if (!createMissing) throw new Error(`missing directory: ${relativeParts.join("/")}`);
      await mkdir(next, { recursive: false });
      st = await lstat(next);
    }
    if (st.isSymbolicLink()) throw new Error(`symlink directory rejected: ${next}`);
    if (!st.isDirectory()) throw new Error(`path is not a directory: ${next}`);
    cur = next;
  }
}
async function lstatRegularFile(absPath: string, maxBytes: number): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) return { ok: false, error: "symlink file rejected" };
    if (!st.isFile()) return { ok: false, error: "not a regular file" };
    if (st.size > maxBytes) return { ok: false, error: `file size ${st.size} exceeds max ${maxBytes}` };
    return { ok: true, size: st.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function readBoundedFile(absPath: string, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const meta = await lstatRegularFile(absPath, maxBytes);
  if (!meta.ok) return meta;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(absPath, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > maxBytes) return { ok: false, error: "opened handle invalid" };
      const buf = await fh.readFile();
      if (buf.byteLength > maxBytes) return { ok: false, error: `read size exceeds max ${maxBytes}` };
      return { ok: true, text: buf.toString("utf8") };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
export async function readArtifactBytes(absPath: string, maxBytes = PER_EVENT_ALLOC_MAX): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const meta = await lstatRegularFile(absPath, maxBytes);
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
      if (!st2.isFile() || st2.size > maxBytes) return { ok: false, error: "opened artifact handle invalid" };
      const buf = await fh.readFile();
      return { ok: true, bytes: new Uint8Array(buf) };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
export async function writeArtifactBytes(absPath: string, bytes: Uint8Array): Promise<void> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) throw new Error(`refusing to write symlink artifact ${absPath}`);
    if (!st.isFile()) throw new Error(`refusing to write non-regular artifact ${absPath}`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code !== "ENOENT") throw e;
  }
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0);
  const fh = await open(absPath, flags, 0o644);
  try {
    await fh.writeFile(bytes);
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type RegistryIndex = {
  errors: Record<string, { name: string }>;
  dispositions: Record<string, string>;
  bootstrapSteps: Map<number, { error: string | null; code: number | null; disposition?: string; check: string }>;
  frameSteps: Map<number, { error: string | null; code: number | null; disposition?: string; check: string }>;
};

export function loadRegistryIndex(json: unknown): RegistryIndex {
  if (!isPlainObject(json)) throw new Error("registry root must be object");
  if (!isPlainObject(json.errors)) throw new Error("registry.errors missing");
  if (!isPlainObject(json.dispositions) || !isPlainObject((json.dispositions as any).assigned)) {
    throw new Error("registry.dispositions.assigned missing");
  }
  if (!isPlainObject(json.validation_order)) throw new Error("validation_order missing");
  const vo = json.validation_order as Record<string, unknown>;
  if (!Array.isArray(vo.bootstrap) || !Array.isArray(vo.selected_frame)) {
    throw new Error("validation_order planes missing");
  }
  function ingest(rows: unknown[], plane: string) {
    const map = new Map<number, { error: string | null; code: number | null; disposition?: string; check: string }>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isPlainObject(row)) throw new Error(`registry ${plane} row ${i}: must be object`);
      if (typeof row.step !== "number" || !Number.isSafeInteger(row.step)) {
        throw new Error(`registry ${plane} row ${i}: bad step`);
      }
      if (typeof row.check !== "string" || !row.check) throw new Error(`registry ${plane} row ${i}: bad check`);
      if (map.has(row.step)) throw new Error(`registry ${plane}: duplicate step ${row.step}`);
      const code = row.code === null || row.code === undefined ? null : Number(row.code);
      const error = row.error === null || row.error === undefined ? null : String(row.error);
      const disposition = typeof row.disposition === "string" ? row.disposition : undefined;
      map.set(row.step, { error, code, disposition, check: row.check });
    }
    return map;
  }
  const errors: Record<string, { name: string }> = {};
  for (const [k, v] of Object.entries(json.errors)) {
    if (!/^[0-9]+$/.test(k)) continue;
    if (!isPlainObject(v) || typeof v.name !== "string" || !v.name) {
      throw new Error(`registry.errors[${k}] invalid`);
    }
    errors[k] = { name: v.name };
  }
  const dispositions: Record<string, string> = {};
  for (const [k, v] of Object.entries((json.dispositions as any).assigned)) {
    if (typeof v === "string") dispositions[k] = v;
  }
  return {
    errors,
    dispositions,
    bootstrapSteps: ingest(vo.bootstrap, "bootstrap"),
    frameSteps: ingest(vo.selected_frame, "selected_frame"),
  };
}

// ---------------------------------------------------------------------------
// State oracle
// ---------------------------------------------------------------------------

export type SessionPhase =
  | "awaiting_client_hello"
  | "awaiting_server_hello"
  | "awaiting_entry"
  | "awaiting_entry_response"
  | "ready"
  | "rejected"
  | "closed";

export type ChannelPhase = "unused" | "pending" | "active" | "failed" | "closed";

export type ChannelState = {
  phase: ChannelPhase;
  domain_id: number;
  operation_kind: "subscribe" | "publish";
  data_direction: "gateway_to_browser" | "browser_to_gateway";
  reliability: "reliable" | "best_effort";
};

export type SequenceDomain = {
  next_expected: number;
  highest_accepted: number;
};

export type PendingChannelAck = {
  channel_id: number;
  /** Last sequence the client acknowledges for this channel (normative resume field). */
  acknowledged_sequence: number;
};

export type PendingResumeClaim = {
  gateway_instance_id: string;
  support_row: SupportRowId;
  /** 32-byte previous session id as 64 lowercase hex. */
  previous_session_id_hex: string;
  /** Channel acks from the resume request (for result consistency). */
  channel_acks: PendingChannelAck[];
};

export type SessionState = {
  phase: SessionPhase;
  process_id: string;
  selected_version: number | null;
  extension_capabilities: number[];
  /** Effective binding after SessionReady or accepted resume; null until bound. */
  gateway_instance_id: string | null;
  session_id_hex: string | null;
  support_row: SupportRowId | null;
  entry_path: "fresh" | "resume" | null;
  /** Client resume claim; never overwrites process binding or effective session binding. */
  pending_resume_claim: PendingResumeClaim | null;
  ready: boolean;
  terminal: boolean;
  channels: Record<string, ChannelState>;
  sequences: Record<string, SequenceDomain>; // `${channelId}:${direction}`
  server_wire_versions: number[];
  server_gateway_instance_id: string;
  server_support_row: SupportRowId;
};

export const SESSION_ID_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const COMPOSITION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const DOMAIN_ID_MAX = 232;
/** Application channel_id range: 1..2^32-1 (normative channel lifecycle). */
export const CHANNEL_ID_MIN = 1;
export const CHANNEL_ID_MAX = 0xffffffff; // 4294967295
export const SEQUENCE_NUM_MAX = Number.MAX_SAFE_INTEGER;
export const SUPPORT_ROW_IDS = Object.keys(PHASE_ONE_ROWS) as SupportRowId[];
export const SEQUENCES_ROOT_FILES = ["manifest.json", "README.md"] as const;
export const SEQUENCES_ROOT_DIRS = ["events", "scenarios"] as const;

/** Canonical decimal channel id key: no leading zeros; range 1..CHANNEL_ID_MAX. */
export function isCanonicalChannelIdKey(cid: string): boolean {
  if (typeof cid !== "string" || !/^\d+$/.test(cid)) return false;
  // Reject leading-zero aliases such as "01".
  if (cid.length > 1 && cid.startsWith("0")) return false;
  const n = Number(cid);
  if (!Number.isSafeInteger(n) || n < CHANNEL_ID_MIN || n > CHANNEL_ID_MAX) return false;
  return String(n) === cid;
}

export function isChannelId(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= CHANNEL_ID_MIN && n <= CHANNEL_ID_MAX;
}

function isSortedUniqueNumbers(arr: unknown[]): boolean {
  let prev: number | null = null;
  const seen = new Set<number>();
  for (const v of arr) {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (prev !== null && prev >= v) return false;
    prev = v;
  }
  return true;
}

function sortUniqueNumbers(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}
export const SESSION_PHASES: SessionPhase[] = [
  "awaiting_client_hello",
  "awaiting_server_hello",
  "awaiting_entry",
  "awaiting_entry_response",
  "ready",
  "rejected",
  "closed",
];
export const CHANNEL_PHASES: ChannelPhase[] = ["unused", "pending", "active", "failed", "closed"];
export const OUTCOME_KEYS = [
  "status",
  "registry_code",
  "registry_name",
  "disposition_code",
  "disposition_name",
  "plane",
  "step",
  "reason",
] as const;

export type CompositionState = {
  processes: Record<string, { support_row: SupportRowId; gateway_instance_id: string }>;
  sessions: Record<string, SessionState>;
};

export type EventOutcome = {
  status: "success" | "error" | "disposition";
  registry_code: number | null;
  registry_name: string | null;
  disposition_code: number | null;
  disposition_name: string | null;
  plane: "bootstrap" | "selected_frame" | null;
  step: number | null;
  reason: string | null;
};

export type DecodedEvent =
  | { kind: "bootstrap"; record: BootstrapRecord }
  | { kind: "control"; control: ControlMessage; frame: ReturnType<typeof decodeFrame> }
  | { kind: "application"; frame: ReturnType<typeof decodeFrame> };

function seqKey(channelId: number, direction: string): string {
  return `${channelId}:${direction}`;
}

function cloneState(s: CompositionState): CompositionState {
  return structuredClone(s);
}

function emptySession(
  processId: string,
  serverRow: SupportRowId,
  gatewayId: string,
  serverVersions: number[] = [0],
): SessionState {
  return {
    phase: "awaiting_client_hello",
    process_id: processId,
    selected_version: null,
    extension_capabilities: [],
    gateway_instance_id: null,
    session_id_hex: null,
    support_row: null,
    entry_path: null,
    pending_resume_claim: null,
    ready: false,
    terminal: false,
    channels: {},
    sequences: {},
    server_wire_versions: serverVersions,
    server_gateway_instance_id: gatewayId,
    server_support_row: serverRow,
  };
}

/**
 * Bind error code to registry name. Attach plane/step only when that exact
 * validation row owns the code/name; otherwise callers pass null/null.
 * Never throws for valid known codes; returns a soft outcome if registry is incomplete.
 */
export function bindErrorOutcome(
  registry: RegistryIndex,
  code: number,
  reason: string,
  plane: "bootstrap" | "selected_frame" | null,
  step: number | null,
): EventOutcome {
  const name = registry.errors[String(code)]?.name ?? null;
  if (!name) {
    // Soft-fail: still produce a closed outcome shape (applyEvent must not throw).
    return {
      status: "error",
      registry_code: code,
      registry_name: "unknown_error",
      disposition_code: null,
      disposition_name: null,
      plane: null,
      step: null,
      reason,
    };
  }
  let usePlane = plane;
  let useStep = step;
  if (plane && step !== null) {
    const row =
      plane === "bootstrap" ? registry.bootstrapSteps.get(step) : registry.frameSteps.get(step);
    if (!row || (row.code !== null && row.code !== code) || (row.error !== null && row.error !== name)) {
      // Row does not own this code/name — drop plane/step rather than throw.
      usePlane = null;
      useStep = null;
    }
  } else if (plane !== null || step !== null) {
    // Partial plane/step is illegal; force both null.
    usePlane = null;
    useStep = null;
  }
  return {
    status: "error",
    registry_code: code,
    registry_name: name,
    disposition_code: null,
    disposition_name: null,
    plane: usePlane,
    step: useStep,
    reason,
  };
}

export function bindDispositionOutcome(
  registry: RegistryIndex,
  code: number,
  step: number,
): EventOutcome {
  const name = registry.dispositions[String(code)];
  if (!name) {
    return {
      status: "disposition",
      registry_code: null,
      registry_name: null,
      disposition_code: code,
      disposition_name: "unknown_disposition",
      plane: "selected_frame",
      step,
      reason: "unknown_disposition",
    };
  }
  const row = registry.frameSteps.get(step);
  if (!row || row.disposition !== name) {
    // Soft-fail with null plane/step if step does not own disposition.
    return {
      status: "disposition",
      registry_code: null,
      registry_name: null,
      disposition_code: code,
      disposition_name: name,
      plane: null,
      step: null,
      reason: name,
    };
  }
  return {
    status: "disposition",
    registry_code: null,
    registry_name: null,
    disposition_code: code,
    disposition_name: name,
    plane: "selected_frame",
    step,
    reason: name,
  };
}

function parseChannelAcks(raw: unknown): PendingChannelAck[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingChannelAck[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!(item instanceof Map)) continue;
    const channel_id = Number(item.get(1));
    const acknowledged_sequence = Number(item.get(2) ?? 0);
    if (!isChannelId(channel_id) || !Number.isSafeInteger(acknowledged_sequence) || acknowledged_sequence < 0) {
      continue;
    }
    if (seen.has(channel_id)) continue; // duplicates rejected later by schema/oracle
    seen.add(channel_id);
    out.push({ channel_id, acknowledged_sequence });
  }
  return out;
}

/**
 * Apply one decoded event to the composition state.
 * Always returns an EventOutcome for state/semantic rejection — never throws for those.
 */
export function applyEvent(
  state: CompositionState,
  sessionKey: string,
  decoded: DecodedEvent,
  registry: RegistryIndex,
): { outcome: EventOutcome; state: CompositionState } {
  const next = cloneState(state);

  const success = (): EventOutcome => ({
    status: "success",
    registry_code: null,
    registry_name: null,
    disposition_code: null,
    disposition_name: null,
    plane: null,
    step: null,
    reason: null,
  });

  const error = (
    code: number,
    reason: string,
    plane: "bootstrap" | "selected_frame" | null,
    step: number | null,
  ): EventOutcome => bindErrorOutcome(registry, code, reason, plane, step);

  const disposition = (code: number, step: number): EventOutcome =>
    bindDispositionOutcome(registry, code, step);

  const session = next.sessions[sessionKey];
  if (!session) {
    return { outcome: error(25, "unknown_session", null, null), state: next };
  }
  const process = next.processes[session.process_id];
  if (!process) {
    return { outcome: error(25, "unknown_process", null, null), state: next };
  }

  // Terminal sessions reject further non-error bootstrap_error noise as semantic violation.
  if (session.terminal && !(decoded.kind === "bootstrap" && decoded.record.kind === "bootstrap_error")) {
    return { outcome: error(25, "terminal_session", null, null), state: next };
  }

  if (decoded.kind === "bootstrap") {
    const rec = decoded.record;
    if (rec.kind === "client_hello") {
      if (session.phase !== "awaiting_client_hello") {
        // bootstrap step 10 owns protocol_violation for direction/state order.
        return { outcome: error(25, "wrong_phase", "bootstrap", 10), state: next };
      }
      const intersection = rec.wireVersions.filter((v) => session.server_wire_versions.includes(v));
      if (intersection.length === 0) {
        session.phase = "closed";
        session.terminal = true;
        return { outcome: error(2, "empty_intersection", "bootstrap", 11), state: next };
      }
      session.phase = "awaiting_server_hello";
      session.extension_capabilities = sortUniqueNumbers(
        rec.extensionCapabilities.filter((c) => c === 1 || c > 0),
      );
      return { outcome: success(), state: next };
    }
    if (rec.kind === "server_hello") {
      if (session.phase !== "awaiting_server_hello") {
        return { outcome: error(25, "wrong_phase", "bootstrap", 10), state: next };
      }
      session.selected_version = rec.selectedWireVersion;
      session.extension_capabilities = sortUniqueNumbers(rec.extensionCapabilities.slice());
      session.phase = "awaiting_entry";
      return { outcome: success(), state: next };
    }
    if (rec.kind === "bootstrap_error") {
      session.phase = "closed";
      session.terminal = true;
      return { outcome: error(rec.code, "bootstrap_error", "bootstrap", 11), state: next };
    }
  }

  if (decoded.kind === "control") {
    const kind = Number(decoded.control.get(1));

    if (kind === CONTROL_KIND_AUTHENTICATE) {
      if (session.phase !== "awaiting_entry") {
        // Semantic wrong-order: no selected_frame row owns code 25 for this check.
        return { outcome: error(25, "wrong_phase", null, null), state: next };
      }
      if (session.entry_path === "resume") {
        return { outcome: error(25, "entry_mutex", null, null), state: next };
      }
      if (session.entry_path === "fresh") {
        return { outcome: error(25, "repeated_entry", null, null), state: next };
      }
      session.entry_path = "fresh";
      session.phase = "awaiting_entry_response";
      return { outcome: success(), state: next };
    }

    if (kind === CONTROL_KIND_SESSION_READY) {
      if (session.phase !== "awaiting_entry_response" || session.entry_path !== "fresh") {
        return { outcome: error(25, "wrong_phase", null, null), state: next };
      }
      const row = String(decoded.control.get(8)) as SupportRowId;
      const gw = String(decoded.control.get(7));
      const distro = String(decoded.control.get(18) ?? "");
      const rmw = String(decoded.control.get(19) ?? "");
      const sid = decoded.control.get(53);

      // SessionReady must agree with immutable process binding.
      if (gw !== process.gateway_instance_id) {
        return { outcome: error(18, "session_ready_gateway_mismatch", null, null), state: next };
      }
      if (row !== process.support_row) {
        return { outcome: error(19, "session_ready_row_mismatch", null, null), state: next };
      }
      // Phase-one wire provenance: row → exact {distro, rmw}.
      const prof = PHASE_ONE_ROWS[row as SupportRowId];
      if (!prof) {
        return { outcome: error(19, "session_ready_unknown_row", null, null), state: next };
      }
      if (distro !== prof.distro || rmw !== prof.rmw) {
        return { outcome: error(19, "session_ready_profile_mismatch", null, null), state: next };
      }
      // Server binding fields on the session must match the referenced process.
      if (
        session.server_support_row !== process.support_row ||
        session.server_gateway_instance_id !== process.gateway_instance_id
      ) {
        return { outcome: error(25, "server_binding_mismatch", null, null), state: next };
      }

      session.support_row = process.support_row;
      session.gateway_instance_id = process.gateway_instance_id;
      session.session_id_hex =
        sid instanceof Uint8Array && sid.length === 32 ? toHex(sid) : null;
      if (session.session_id_hex === null || !SESSION_ID_HEX_PATTERN.test(session.session_id_hex)) {
        return { outcome: error(25, "session_ready_bad_session_id", null, null), state: next };
      }
      session.pending_resume_claim = null;
      session.ready = true;
      session.phase = "ready";
      return { outcome: success(), state: next };
    }

    if (kind === CONTROL_KIND_SESSION_RESUME) {
      if (session.phase !== "awaiting_entry") {
        return { outcome: error(25, "wrong_phase", null, null), state: next };
      }
      if (session.entry_path === "fresh") {
        return { outcome: error(25, "entry_mutex", null, null), state: next };
      }
      if (session.entry_path === "resume") {
        return { outcome: error(25, "repeated_entry", null, null), state: next };
      }
      if (!session.extension_capabilities.includes(1)) {
        return { outcome: error(25, "resume_cap", null, null), state: next };
      }
      const gw = String(decoded.control.get(7));
      const row = String(decoded.control.get(8)) as SupportRowId;
      const prev = decoded.control.get(42);
      if (!(prev instanceof Uint8Array) || prev.length !== 32) {
        return { outcome: error(25, "resume_bad_previous_session_id", null, null), state: next };
      }
      const previous_session_id_hex = toHex(prev);
      const rawAcks = decoded.control.get(45);
      if (!Array.isArray(rawAcks)) {
        return { outcome: error(25, "resume_bad_channel_acks", null, null), state: next };
      }
      // Reject duplicate ack channel ids in the request.
      const seenAck = new Set<number>();
      for (const item of rawAcks) {
        if (!(item instanceof Map)) {
          return { outcome: error(25, "resume_bad_channel_acks", null, null), state: next };
        }
        const cid = Number(item.get(1));
        if (!isChannelId(cid)) {
          return { outcome: error(25, "resume_bad_channel_acks", null, null), state: next };
        }
        if (seenAck.has(cid)) {
          return { outcome: error(25, "resume_duplicate_ack_channel", null, null), state: next };
        }
        seenAck.add(cid);
      }
      const channel_acks = parseChannelAcks(rawAcks);
      // Resume claims go into pending claim only; process binding stays immutable.
      session.entry_path = "resume";
      session.phase = "awaiting_entry_response";
      session.pending_resume_claim = {
        gateway_instance_id: gw,
        support_row: row,
        previous_session_id_hex,
        channel_acks,
      };
      return { outcome: success(), state: next };
    }

    if (kind === CONTROL_KIND_SESSION_RESUME_RESULT) {
      if (session.phase !== "awaiting_entry_response" || session.entry_path !== "resume") {
        return { outcome: error(25, "wrong_phase", null, null), state: next };
      }
      const claim = session.pending_resume_claim;
      if (!claim) {
        return { outcome: error(25, "missing_resume_claim", null, null), state: next };
      }
      const accepted = decoded.control.get(46) === true;
      const gwMismatch = claim.gateway_instance_id !== process.gateway_instance_id;
      const rowMismatch = claim.support_row !== process.support_row;
      if (!accepted) {
        const body = decoded.control.get(15) as Map<number, CborValue> | undefined;
        const code = body instanceof Map ? Number(body.get(48)) : NaN;
        let expectedCode: number | null = null;
        if (gwMismatch) expectedCode = 18;
        else if (rowMismatch) expectedCode = 19;
        session.ready = false;
        session.phase = "rejected";
        session.terminal = true;
        session.pending_resume_claim = null;
        if (expectedCode === null || code !== expectedCode) {
          return { outcome: error(25, "resume_reject_code_mismatch", null, null), state: next };
        }
        return {
          outcome: error(
            code,
            code === 18 ? "gateway_instance_mismatch" : "support_row_mismatch",
            null,
            null,
          ),
          state: next,
        };
      }
      // Accepted resume requires a compatible claim.
      if (gwMismatch || rowMismatch) {
        session.ready = false;
        session.phase = "rejected";
        session.terminal = true;
        session.pending_resume_claim = null;
        return { outcome: error(25, "resume_accept_with_mismatch", null, null), state: next };
      }
      const results = decoded.control.get(47) as Array<Map<number, CborValue>> | undefined;
      // For resumed reliable default-domain channels: exactly one result per acked channel,
      // next_sequence === acknowledged_sequence + 1; no duplicate result channel ids.
      if (claim.channel_acks.length > 0) {
        if (!Array.isArray(results)) {
          session.pending_resume_claim = null;
          return { outcome: error(25, "resume_result_missing", null, null), state: next };
        }
        const resultByCh = new Map<number, Map<number, CborValue>>();
        for (const r of results) {
          if (!(r instanceof Map)) {
            session.pending_resume_claim = null;
            return { outcome: error(25, "resume_result_malformed", null, null), state: next };
          }
          const ch = Number(r.get(1));
          if (!isChannelId(ch)) {
            session.pending_resume_claim = null;
            return { outcome: error(25, "resume_result_bad_channel", null, null), state: next };
          }
          if (resultByCh.has(ch)) {
            session.pending_resume_claim = null;
            return { outcome: error(25, "resume_result_duplicate_channel", null, null), state: next };
          }
          resultByCh.set(ch, r);
        }
        for (const ack of claim.channel_acks) {
          const r = resultByCh.get(ack.channel_id);
          if (!r) {
            session.pending_resume_claim = null;
            return { outcome: error(25, "resume_result_missing_channel", null, null), state: next };
          }
          const status = Number(r.get(2));
          if (status === 0) {
            const nextSeq = Number(r.get(3) ?? 0);
            if (nextSeq !== ack.acknowledged_sequence + 1) {
              session.pending_resume_claim = null;
              return { outcome: error(25, "resume_result_sequence_mismatch", null, null), state: next };
            }
          }
        }
        // Extra result channels not in acks are rejected for the represented reliable default-domain case.
        for (const ch of resultByCh.keys()) {
          if (!claim.channel_acks.some((a) => a.channel_id === ch)) {
            session.pending_resume_claim = null;
            return { outcome: error(25, "resume_result_extra_channel", null, null), state: next };
          }
        }
      }

      // Bind existing session identity from the pending claim.
      session.support_row = process.support_row;
      session.gateway_instance_id = process.gateway_instance_id;
      session.session_id_hex = claim.previous_session_id_hex;
      session.pending_resume_claim = null;
      session.ready = true;
      session.phase = "ready";
      if (Array.isArray(results)) {
        for (const r of results) {
          const ch = Number(r.get(1));
          const status = Number(r.get(2));
          if (status === 0) {
            const nextSeq = Number(r.get(3) ?? 0);
            const highest = nextSeq - 1;
            session.channels[String(ch)] = {
              phase: "active",
              domain_id: 0,
              operation_kind: "subscribe",
              data_direction: "gateway_to_browser",
              reliability: "reliable",
            };
            session.sequences[seqKey(ch, "gateway_to_browser")] = {
              next_expected: nextSeq,
              highest_accepted: highest,
            };
          }
        }
      }
      return { outcome: success(), state: next };
    }

    if (kind === CONTROL_KIND_OPEN_CHANNEL) {
      if (!session.ready || session.phase !== "ready") {
        return { outcome: error(27, "session_not_ready", "selected_frame", 17), state: next };
      }
      const ch = Number(decoded.control.get(29));
      if (!isChannelId(ch)) {
        return { outcome: error(25, "open_channel_bad_id", null, null), state: next };
      }
      // Channel ID lifetime: never reuse after any OpenChannel for that id (any phase).
      if (Object.prototype.hasOwnProperty.call(session.channels, String(ch))) {
        return { outcome: error(25, "channel_id_reuse", null, null), state: next };
      }
      const cls = Number(decoded.control.get(30));
      const domain = Number(decoded.control.get(9));
      const row = String(decoded.control.get(8));
      if (row !== process.support_row || (session.support_row !== null && row !== session.support_row)) {
        return { outcome: error(19, "open_channel_row_mismatch", null, null), state: next };
      }
      if (!Number.isSafeInteger(domain) || domain < 0 || domain > DOMAIN_ID_MAX) {
        return { outcome: error(25, "open_channel_bad_domain", null, null), state: next };
      }
      const opKind = cls === 0 ? "subscribe" : "publish";
      const dir = opKind === "subscribe" ? "gateway_to_browser" : "browser_to_gateway";
      session.channels[String(ch)] = {
        phase: "pending",
        domain_id: domain,
        operation_kind: opKind,
        data_direction: dir,
        reliability: "best_effort",
      };
      return { outcome: success(), state: next };
    }

    if (kind === CONTROL_KIND_CHANNEL_READY) {
      if (!session.ready || session.phase !== "ready") {
        return { outcome: error(27, "session_not_ready", "selected_frame", 17), state: next };
      }
      const ch = Number(decoded.control.get(29));
      const status = Number(decoded.control.get(33));
      const chState = session.channels[String(ch)];
      if (!chState || chState.phase !== "pending") {
        return { outcome: error(25, "not_pending", "selected_frame", 19), state: next };
      }
      // ChannelReady row/domain must match pending channel + session context.
      if (decoded.control.has(8)) {
        const row = String(decoded.control.get(8));
        if (row !== process.support_row || row !== session.support_row) {
          return { outcome: error(19, "channel_ready_row_mismatch", null, null), state: next };
        }
      }
      if (decoded.control.has(9)) {
        const domain = Number(decoded.control.get(9));
        if (domain !== chState.domain_id) {
          return { outcome: error(25, "channel_ready_domain_mismatch", null, null), state: next };
        }
      }
      if (status === 0 || status === 2) {
        const eff = decoded.control.get(57) as Map<number, CborValue> | undefined;
        const reliability = eff && Number(eff.get(1)) === 1 ? "reliable" : "best_effort";
        chState.phase = "active";
        chState.reliability = reliability as "reliable" | "best_effort";
        session.sequences[seqKey(ch, chState.data_direction)] = {
          next_expected: 0,
          highest_accepted: -1,
        };
      } else {
        chState.phase = "failed";
      }
      return { outcome: success(), state: next };
    }

    // Unhandled control kind: semantic violation, no owning step.
    return { outcome: error(25, "unhandled_control", null, null), state: next };
  }

  if (decoded.kind === "application") {
    const frame = decoded.frame;
    if (frame.opcode !== OPCODE_ROS_SAMPLE) {
      return { outcome: error(25, "not_ros_sample", null, null), state: next };
    }
    if (!session.ready || session.phase !== "ready") {
      return { outcome: error(27, "session_not_ready", "selected_frame", 17), state: next };
    }
    const ch = frame.channelId;
    const chState = session.channels[String(ch)];
    if (!chState) {
      return { outcome: error(7, "never_opened", "selected_frame", 20), state: next };
    }
    if (chState.phase === "pending") {
      return { outcome: error(25, "pending_channel", "selected_frame", 19), state: next };
    }
    if (chState.phase === "closed" || chState.phase === "failed") {
      return { outcome: error(7, "closed_or_failed", "selected_frame", 20), state: next };
    }
    if (chState.phase !== "active") {
      return { outcome: error(7, "inactive", "selected_frame", 20), state: next };
    }

    // Step 23: ROS_RELIABLE flag must match negotiated effective reliability.
    const flagReliable = (frame.flags & FLAG_ROS_RELIABLE) !== 0;
    if (chState.reliability === "reliable" && !flagReliable) {
      return { outcome: error(6, "reliable_flag_clear", "selected_frame", 23), state: next };
    }
    if (chState.reliability === "best_effort" && flagReliable) {
      return { outcome: error(6, "reliable_flag_set", "selected_frame", 23), state: next };
    }

    const dir = chState.data_direction;
    const key = seqKey(ch, dir);
    let domain = session.sequences[key];
    if (!domain) {
      domain = { next_expected: 0, highest_accepted: -1 };
      session.sequences[key] = domain;
    }
    const seq = typeof frame.sequence === "bigint" ? Number(frame.sequence) : Number(frame.sequence);

    if (chState.reliability === "reliable") {
      if (seq !== domain.next_expected) {
        return { outcome: error(25, "reliable_mismatch", "selected_frame", 25), state: next };
      }
      domain.next_expected = seq + 1;
      domain.highest_accepted = seq;
      return { outcome: success(), state: next };
    }

    // Best-effort: begins expecting 0; first sample > 0 is sequence_gap and advances tracking.
    // Stale: seq <= highest_accepted (when any sample has been accepted).
    // Gap: seq > highest_accepted + 1 (including first sample when highest_accepted === -1 and seq > 0).
    if (domain.highest_accepted >= 0 && seq <= domain.highest_accepted) {
      return { outcome: disposition(3, 27), state: next };
    }
    const expectedContiguous = domain.highest_accepted < 0 ? 0 : domain.highest_accepted + 1;
    if (seq > expectedContiguous) {
      domain.highest_accepted = seq;
      domain.next_expected = seq + 1;
      return { outcome: disposition(2, 26), state: next };
    }
    // Contiguous accept (including first sample at 0).
    domain.highest_accepted = seq;
    domain.next_expected = seq + 1;
    return { outcome: success(), state: next };
  }

  return { outcome: error(25, "unhandled", null, null), state: next };
}

export function decodeEventBytes(
  kind: "bootstrap" | "control" | "application",
  bytes: Uint8Array,
): DecodedEvent {
  if (kind === "bootstrap") {
    return { kind: "bootstrap", record: decodeBootstrapRecord(bytes) };
  }
  const frame = decodeFrame(bytes, {
    selectedVersion: 0,
    experimentalOpcodesEnabled: false,
    availableClockIds: [0, 1, 2, 3, 4],
  });
  if (frame.opcode === OPCODE_CONTROL_CBOR) {
    // decodeFrame already yields a validated ControlMessage Map for CONTROL_CBOR.
    const control = frame.payload as unknown as ControlMessage;
    if (!(control instanceof Map)) {
      // Fallback if payload remains raw bytes.
      const control2 = decodeControlMessage(frame.payload as Uint8Array);
      return { kind: "control", control: control2, frame };
    }
    return { kind: "control", control, frame };
  }
  return { kind: "application", frame };
}

/** Wire-side direction implied by decoded record/message kind. */
export function expectedDirectionForDecoded(
  decoded: DecodedEvent,
): "client_to_server" | "server_to_client" | null {
  if (decoded.kind === "bootstrap") {
    if (decoded.record.kind === "client_hello") return "client_to_server";
    if (decoded.record.kind === "server_hello" || decoded.record.kind === "bootstrap_error") {
      return "server_to_client";
    }
    return null;
  }
  if (decoded.kind === "control") {
    const kind = Number(decoded.control.get(1));
    if (
      kind === CONTROL_KIND_AUTHENTICATE ||
      kind === CONTROL_KIND_OPEN_CHANNEL ||
      kind === CONTROL_KIND_SESSION_RESUME
    ) {
      return "client_to_server";
    }
    if (
      kind === CONTROL_KIND_SESSION_READY ||
      kind === CONTROL_KIND_CHANNEL_READY ||
      kind === CONTROL_KIND_SESSION_RESUME_RESULT
    ) {
      return "server_to_client";
    }
    return null;
  }
  // Application ROS_SAMPLE in these fixtures is gateway_to_browser (server→client path).
  return "server_to_client";
}

const SESSION_STATE_KEYS = [
  "phase",
  "process_id",
  "selected_version",
  "extension_capabilities",
  "gateway_instance_id",
  "session_id_hex",
  "support_row",
  "entry_path",
  "pending_resume_claim",
  "ready",
  "terminal",
  "channels",
  "sequences",
  "server_wire_versions",
  "server_gateway_instance_id",
  "server_support_row",
] as const;

const PROCESS_STATE_KEYS = ["support_row", "gateway_instance_id"] as const;

/** Detect undeclared keys such as `_pending_acks` in serialized projections. */
export function findUndeclaredStateKeys(state: CompositionState): string[] {
  return diagnoseCompositionState(state, "state");
}

const PENDING_CLAIM_KEYS = [
  "gateway_instance_id",
  "support_row",
  "previous_session_id_hex",
  "channel_acks",
] as const;
const CHANNEL_STATE_KEYS = [
  "phase",
  "domain_id",
  "operation_kind",
  "data_direction",
  "reliability",
] as const;
const SEQUENCE_STATE_KEYS = ["next_expected", "highest_accepted"] as const;
const CHANNEL_ACK_KEYS = ["channel_id", "acknowledged_sequence"] as const;

function isSupportRowId(v: unknown): v is SupportRowId {
  return typeof v === "string" && (SUPPORT_ROW_IDS as string[]).includes(v);
}

function isSafeNonNegInt(v: unknown, max = SEQUENCE_NUM_MAX): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
}

function isSafeIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

/** Recursive closed validation of composition state (initial or state_after). */
export function diagnoseCompositionState(value: unknown, path: string): string[] {
  const diags: string[] = [];
  if (value === null) return [`${path}: null`];
  if (!isPlainObject(value)) return [`${path}: must be object`];
  exactKeys(value, ["processes", "sessions"], path, diags);
  requireKeys(value, ["processes", "sessions"], path, diags);
  if (!isPlainObject(value.processes)) {
    diags.push(`${path}.processes: must be object`);
    return sortAscii(diags);
  }
  if (!isPlainObject(value.sessions)) {
    diags.push(`${path}.sessions: must be object`);
    return sortAscii(diags);
  }
  const processIds = new Set<string>();
  for (const [pid, proc] of Object.entries(value.processes)) {
    const pp = `${path}.processes.${pid}`;
    if (!COMPOSITION_KEY_PATTERN.test(pid)) diags.push(`${pp}: bad process id`);
    processIds.add(pid);
    if (!isPlainObject(proc)) {
      diags.push(`${pp}: must be object`);
      continue;
    }
    exactKeys(proc, PROCESS_STATE_KEYS, pp, diags);
    requireKeys(proc, PROCESS_STATE_KEYS, pp, diags);
    if (!isSupportRowId(proc.support_row)) diags.push(`${pp}: bad support_row`);
    if (
      typeof proc.gateway_instance_id !== "string" ||
      !proc.gateway_instance_id ||
      proc.gateway_instance_id.length > STRING_FIELD_MAX
    ) {
      diags.push(`${pp}: bad gateway_instance_id`);
    }
  }
  const sessionCount = Object.keys(value.sessions).length;
  if (sessionCount > SCENARIO_COUNT_MAX) diags.push(`${path}.sessions: too many`);
  for (const [sid, sess] of Object.entries(value.sessions)) {
    diags.push(...diagnoseSessionState(sess, `${path}.sessions.${sid}`, processIds, value.processes));
    if (!COMPOSITION_KEY_PATTERN.test(sid)) diags.push(`${path}.sessions.${sid}: bad session id`);
  }
  return sortAscii(diags);
}

function diagnoseSessionState(
  sess: unknown,
  path: string,
  processIds: Set<string>,
  processes: Record<string, unknown>,
): string[] {
  const diags: string[] = [];
  if (!isPlainObject(sess)) return [`${path}: must be object`];
  exactKeys(sess, SESSION_STATE_KEYS, path, diags);
  requireKeys(sess, SESSION_STATE_KEYS, path, diags);

  if (typeof sess.phase !== "string" || !(SESSION_PHASES as string[]).includes(sess.phase)) {
    diags.push(`${path}: bad phase`);
  }
  if (typeof sess.process_id !== "string" || !processIds.has(sess.process_id)) {
    diags.push(`${path}: process_id must reference a process`);
  }
  if (sess.selected_version !== null && !isSafeNonNegInt(sess.selected_version, 255)) {
    diags.push(`${path}: bad selected_version`);
  }
  if (!Array.isArray(sess.extension_capabilities) || sess.extension_capabilities.length > 64) {
    diags.push(`${path}: bad extension_capabilities`);
  } else {
    for (const c of sess.extension_capabilities) {
      if (!isSafeNonNegInt(c, 65535)) diags.push(`${path}: bad capability`);
    }
    if (!isSortedUniqueNumbers(sess.extension_capabilities as unknown[])) {
      diags.push(`${path}: extension_capabilities must be sorted unique`);
    }
  }
  if (sess.gateway_instance_id !== null) {
    if (
      typeof sess.gateway_instance_id !== "string" ||
      !sess.gateway_instance_id ||
      sess.gateway_instance_id.length > STRING_FIELD_MAX
    ) {
      diags.push(`${path}: bad gateway_instance_id`);
    }
  }
  if (sess.session_id_hex !== null) {
    if (typeof sess.session_id_hex !== "string" || !SESSION_ID_HEX_PATTERN.test(sess.session_id_hex)) {
      diags.push(`${path}: session_id_hex must be 64 lowercase hex or null`);
    }
  }
  if (sess.support_row !== null && !isSupportRowId(sess.support_row)) {
    diags.push(`${path}: bad support_row`);
  }
  if (sess.entry_path !== null && sess.entry_path !== "fresh" && sess.entry_path !== "resume") {
    diags.push(`${path}: bad entry_path`);
  }
  if (typeof sess.ready !== "boolean") diags.push(`${path}: ready must be boolean`);
  if (typeof sess.terminal !== "boolean") diags.push(`${path}: terminal must be boolean`);
  if (!isSupportRowId(sess.server_support_row)) diags.push(`${path}: bad server_support_row`);
  if (
    typeof sess.server_gateway_instance_id !== "string" ||
    !sess.server_gateway_instance_id ||
    sess.server_gateway_instance_id.length > STRING_FIELD_MAX
  ) {
    diags.push(`${path}: bad server_gateway_instance_id`);
  }
  if (!Array.isArray(sess.server_wire_versions) || sess.server_wire_versions.length > 16) {
    diags.push(`${path}: bad server_wire_versions`);
  } else {
    for (const v of sess.server_wire_versions) {
      if (!isSafeNonNegInt(v, 255)) diags.push(`${path}: bad wire version`);
    }
    if (!isSortedUniqueNumbers(sess.server_wire_versions as unknown[])) {
      diags.push(`${path}: server_wire_versions must be sorted unique`);
    }
  }

  // Binding invariants vs referenced process.
  const proc = processes[sess.process_id as string];
  if (isPlainObject(proc)) {
    if (sess.server_support_row !== proc.support_row) {
      diags.push(`${path}: server_support_row must equal process.support_row`);
    }
    if (sess.server_gateway_instance_id !== proc.gateway_instance_id) {
      diags.push(`${path}: server_gateway_instance_id must equal process.gateway_instance_id`);
    }
    if (sess.support_row !== null && sess.support_row !== proc.support_row) {
      diags.push(`${path}: effective support_row must equal process.support_row`);
    }
    if (sess.gateway_instance_id !== null && sess.gateway_instance_id !== proc.gateway_instance_id) {
      diags.push(`${path}: effective gateway_instance_id must equal process.gateway_instance_id`);
    }
  }

  // ready/phase/terminal coherence
  if (sess.ready === true && sess.phase !== "ready") {
    diags.push(`${path}: ready=true requires phase=ready`);
  }
  if (sess.phase === "ready" && sess.ready !== true) {
    diags.push(`${path}: phase=ready requires ready=true`);
  }
  if (sess.terminal === true && sess.phase !== "closed" && sess.phase !== "rejected") {
    diags.push(`${path}: terminal requires closed|rejected phase`);
  }
  if ((sess.phase === "closed" || sess.phase === "rejected") && sess.terminal !== true) {
    diags.push(`${path}: closed|rejected requires terminal=true`);
  }
  if (sess.ready === true && (sess.support_row === null || sess.gateway_instance_id === null)) {
    diags.push(`${path}: ready requires effective binding`);
  }
  if (sess.ready === true && sess.session_id_hex === null) {
    diags.push(`${path}: ready requires session_id_hex`);
  }

  // pending_resume_claim
  if (sess.pending_resume_claim !== null) {
    diags.push(...diagnosePendingClaim(sess.pending_resume_claim, `${path}.pending_resume_claim`));
    if (sess.entry_path !== "resume") {
      diags.push(`${path}: pending_resume_claim requires entry_path=resume`);
    }
  }

  // channels
  if (!isPlainObject(sess.channels)) diags.push(`${path}.channels: must be object`);
  else {
    for (const [cid, ch] of Object.entries(sess.channels)) {
      diags.push(...diagnoseChannelState(ch, `${path}.channels.${cid}`, cid));
    }
  }
  // sequences: exact linkage to channel state
  if (!isPlainObject(sess.sequences)) diags.push(`${path}.sequences: must be object`);
  else {
    const channels = isPlainObject(sess.channels) ? sess.channels : {};
    for (const [sk, seq] of Object.entries(sess.sequences)) {
      diags.push(...diagnoseSequenceDomain(seq, `${path}.sequences.${sk}`, sk, channels));
    }
  }
  return diags;
}

function diagnosePendingClaim(claim: unknown, path: string): string[] {
  const diags: string[] = [];
  if (!isPlainObject(claim)) return [`${path}: must be object`];
  exactKeys(claim, PENDING_CLAIM_KEYS, path, diags);
  requireKeys(claim, PENDING_CLAIM_KEYS, path, diags);
  if (
    typeof claim.gateway_instance_id !== "string" ||
    !claim.gateway_instance_id ||
    claim.gateway_instance_id.length > STRING_FIELD_MAX
  ) {
    diags.push(`${path}: bad gateway_instance_id`);
  }
  if (!isSupportRowId(claim.support_row)) diags.push(`${path}: bad support_row`);
  if (
    typeof claim.previous_session_id_hex !== "string" ||
    !SESSION_ID_HEX_PATTERN.test(claim.previous_session_id_hex)
  ) {
    diags.push(`${path}: previous_session_id_hex must be 64 lowercase hex`);
  }
  if (!Array.isArray(claim.channel_acks) || claim.channel_acks.length > 64) {
    diags.push(`${path}: channel_acks must be bounded array`);
  } else {
    const seenCh = new Set<number>();
    for (let i = 0; i < claim.channel_acks.length; i++) {
      const a = claim.channel_acks[i];
      const ap = `${path}.channel_acks/${i}`;
      if (!isPlainObject(a)) {
        diags.push(`${ap}: must be object`);
        continue;
      }
      exactKeys(a, CHANNEL_ACK_KEYS, ap, diags);
      requireKeys(a, CHANNEL_ACK_KEYS, ap, diags);
      if (!isChannelId(a.channel_id)) diags.push(`${ap}: bad channel_id`);
      else {
        if (seenCh.has(a.channel_id as number)) diags.push(`${ap}: duplicate channel_id`);
        seenCh.add(a.channel_id as number);
      }
      if (!isSafeNonNegInt(a.acknowledged_sequence)) diags.push(`${ap}: bad acknowledged_sequence`);
    }
  }
  return diags;
}

function diagnoseChannelState(ch: unknown, path: string, cid: string): string[] {
  const diags: string[] = [];
  if (!isCanonicalChannelIdKey(cid)) {
    diags.push(`${path}: bad channel id key (require canonical 1..${CHANNEL_ID_MAX})`);
  }
  if (!isPlainObject(ch)) return [...diags, `${path}: must be object`];
  exactKeys(ch, CHANNEL_STATE_KEYS, path, diags);
  requireKeys(ch, CHANNEL_STATE_KEYS, path, diags);
  if (typeof ch.phase !== "string" || !(CHANNEL_PHASES as string[]).includes(ch.phase)) {
    diags.push(`${path}: bad phase`);
  }
  if (!isSafeIntInRange(ch.domain_id, 0, DOMAIN_ID_MAX)) diags.push(`${path}: bad domain_id`);
  if (ch.operation_kind !== "subscribe" && ch.operation_kind !== "publish") {
    diags.push(`${path}: bad operation_kind`);
  }
  if (ch.data_direction !== "gateway_to_browser" && ch.data_direction !== "browser_to_gateway") {
    diags.push(`${path}: bad data_direction`);
  }
  if (ch.reliability !== "reliable" && ch.reliability !== "best_effort") {
    diags.push(`${path}: bad reliability`);
  }
  // direction/op coherence
  if (ch.operation_kind === "subscribe" && ch.data_direction !== "gateway_to_browser") {
    diags.push(`${path}: subscribe requires gateway_to_browser`);
  }
  if (ch.operation_kind === "publish" && ch.data_direction !== "browser_to_gateway") {
    diags.push(`${path}: publish requires browser_to_gateway`);
  }
  return diags;
}

function diagnoseSequenceDomain(
  seq: unknown,
  path: string,
  key: string,
  channels: Record<string, unknown>,
): string[] {
  const diags: string[] = [];
  const m = /^(\d+):(gateway_to_browser|browser_to_gateway)$/.exec(key);
  if (!m) {
    diags.push(`${path}: bad sequence key`);
  } else {
    const cid = m[1]!;
    const dir = m[2]!;
    if (!isCanonicalChannelIdKey(cid)) {
      diags.push(`${path}: bad channel in key (require canonical 1..${CHANNEL_ID_MAX})`);
    } else {
      const ch = channels[cid];
      if (!ch) {
        diags.push(`${path}: sequence key references missing channel ${cid}`);
      } else if (isPlainObject(ch)) {
        if (ch.data_direction !== dir) {
          diags.push(`${path}: sequence direction ${dir} != channel.data_direction ${ch.data_direction}`);
        }
      }
    }
  }
  if (!isPlainObject(seq)) return [...diags, `${path}: must be object`];
  exactKeys(seq, SEQUENCE_STATE_KEYS, path, diags);
  requireKeys(seq, SEQUENCE_STATE_KEYS, path, diags);
  if (!isSafeNonNegInt(seq.next_expected)) diags.push(`${path}: bad next_expected`);
  // highest_accepted may be -1 (no samples yet)
  if (
    typeof seq.highest_accepted !== "number" ||
    !Number.isSafeInteger(seq.highest_accepted) ||
    seq.highest_accepted < -1
  ) {
    diags.push(`${path}: bad highest_accepted`);
  }
  // Exact: next_expected === highest_accepted + 1 (including -1 → 0).
  if (
    typeof seq.next_expected === "number" &&
    typeof seq.highest_accepted === "number" &&
    Number.isSafeInteger(seq.next_expected) &&
    Number.isSafeInteger(seq.highest_accepted) &&
    seq.highest_accepted >= -1
  ) {
    if (seq.next_expected !== seq.highest_accepted + 1) {
      diags.push(
        `${path}: next_expected must equal highest_accepted+1 (got ${seq.next_expected} vs ${seq.highest_accepted}+1)`,
      );
    }
  }
  return diags;
}

/** Closed validation of EventOutcome with status-dependent nullability. */
export function diagnoseEventOutcome(value: unknown, path: string): string[] {
  const diags: string[] = [];
  if (!isPlainObject(value)) return [`${path}: must be object`];
  exactKeys(value, OUTCOME_KEYS, path, diags);
  requireKeys(value, OUTCOME_KEYS, path, diags);
  if (
    value.status !== "success" &&
    value.status !== "error" &&
    value.status !== "disposition"
  ) {
    diags.push(`${path}: bad status`);
    return diags;
  }
  if (value.status === "success") {
    for (const k of [
      "registry_code",
      "registry_name",
      "disposition_code",
      "disposition_name",
      "plane",
      "step",
      "reason",
    ] as const) {
      if (value[k] !== null) diags.push(`${path}: success requires ${k}=null`);
    }
  } else if (value.status === "error") {
    if (!isSafeNonNegInt(value.registry_code, 255)) diags.push(`${path}: error requires registry_code`);
    if (typeof value.registry_name !== "string" || !value.registry_name) {
      diags.push(`${path}: error requires registry_name`);
    }
    if (value.disposition_code !== null || value.disposition_name !== null) {
      diags.push(`${path}: error requires disposition null`);
    }
    const planeOk = value.plane === null || value.plane === "bootstrap" || value.plane === "selected_frame";
    if (!planeOk) diags.push(`${path}: bad plane`);
    if ((value.plane === null) !== (value.step === null)) {
      diags.push(`${path}: plane and step must both be null or both present`);
    }
    if (value.step !== null && !isSafeNonNegInt(value.step, 255)) diags.push(`${path}: bad step`);
    if (value.reason !== null && (typeof value.reason !== "string" || value.reason.length > STRING_FIELD_MAX)) {
      diags.push(`${path}: bad reason`);
    }
  } else if (value.status === "disposition") {
    if (!isSafeNonNegInt(value.disposition_code, 255)) {
      diags.push(`${path}: disposition requires disposition_code`);
    }
    if (typeof value.disposition_name !== "string" || !value.disposition_name) {
      diags.push(`${path}: disposition requires disposition_name`);
    }
    if (value.registry_code !== null || value.registry_name !== null) {
      diags.push(`${path}: disposition requires registry null`);
    }
    if (value.plane !== "selected_frame") diags.push(`${path}: disposition requires plane=selected_frame`);
    if (!isSafeNonNegInt(value.step, 255)) diags.push(`${path}: disposition requires step`);
    if (value.reason !== null && (typeof value.reason !== "string" || value.reason.length > STRING_FIELD_MAX)) {
      diags.push(`${path}: bad reason`);
    }
  }
  return diags;
}

// ---------------------------------------------------------------------------
// Event library (stable semantic ids)
// ---------------------------------------------------------------------------

export type BuiltEvent = {
  id: string;
  kind: "bootstrap" | "control" | "application";
  direction: "client_to_server" | "server_to_client";
  carrier: "bootstrap" | "control_cbor" | "ros_sample";
  bytes: Uint8Array;
  coverage: string[];
};

function sessionReady(row: SupportRowId, gateway: string, sidFill: number): ControlMessage {
  const prof = PHASE_ONE_ROWS[row];
  const sid = new Uint8Array(32);
  sid[0] = sidFill;
  return new Map<number | bigint, CborValue>([
    [1, CONTROL_KIND_SESSION_READY],
    [2, corr(2)],
    [7, gateway],
    [8, row],
    [10, [0]],
    [13, "policy-v1"],
    [12, budgets()],
    [18, prof.distro],
    [19, prof.rmw],
    [20, "adapter-1"],
    [21, "1.0.0"],
    [53, sid],
    [54, negCaps(true)],
  ]);
}

export function buildEventLibrary(): BuiltEvent[] {
  const events: BuiltEvent[] = [];
  const push = (e: BuiltEvent) => events.push(e);

  push({
    id: "evt-client-hello-v0",
    kind: "bootstrap",
    direction: "client_to_server",
    carrier: "bootstrap",
    bytes: encodeBootstrapRecord({
      kind: "client_hello",
      wireVersions: [0],
      transportCapabilities: { webtransportHttp3: true, binaryWss: true },
      bufferCapabilities: { transferableArraybuffer: true, sharedArraybuffer: false },
      requestedLimits: {},
      extensionCapabilities: [1],
    }),
    coverage: ["client_hello", "capability_resume"],
  });

  push({
    id: "evt-client-hello-no-common",
    kind: "bootstrap",
    direction: "client_to_server",
    carrier: "bootstrap",
    bytes: encodeBootstrapRecord({
      kind: "client_hello",
      wireVersions: [9],
      transportCapabilities: { webtransportHttp3: true, binaryWss: false },
      bufferCapabilities: { transferableArraybuffer: true, sharedArraybuffer: false },
      requestedLimits: {},
      extensionCapabilities: [],
    }),
    coverage: ["client_hello", "no_common_version"],
  });

  push({
    id: "evt-server-hello-v0",
    kind: "bootstrap",
    direction: "server_to_client",
    carrier: "bootstrap",
    bytes: encodeBootstrapRecord({
      kind: "server_hello",
      selectedWireVersion: 0,
      transportCapabilities: { webtransportHttp3: true, binaryWss: true, maxDatagramSize: 1200 },
      bufferCapabilities: { transferableArraybuffer: true, sharedArraybuffer: false },
      effectiveLimits: {
        maxChannels: 64,
        maxSessionBytes: 1_048_576,
        maxMessageBytes: 65_536,
        maxControlPayloadBytes: 4096,
      },
      extensionCapabilities: [1],
    }),
    coverage: ["server_hello"],
  });

  push({
    id: "evt-bootstrap-error-no-common",
    kind: "bootstrap",
    direction: "server_to_client",
    carrier: "bootstrap",
    bytes: encodeBootstrapRecord({
      kind: "bootstrap_error",
      code: 2,
      message: "no common version",
      detail: "empty intersection",
    }),
    coverage: ["bootstrap_error", "no_common_version"],
  });

  push({
    id: "evt-authenticate",
    kind: "control",
    direction: "client_to_server",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map([
        [1, CONTROL_KIND_AUTHENTICATE],
        [2, corr(1)],
        [16, "token"],
        [17, new Uint8Array([1, 2, 3])],
      ]),
    ),
    coverage: ["authenticate", "fresh_entry"],
  });

  for (const row of Object.keys(PHASE_ONE_ROWS) as SupportRowId[]) {
    push({
      id: `evt-session-ready-${row.toLowerCase()}`,
      kind: "control",
      direction: "server_to_client",
      carrier: "control_cbor",
      bytes: controlFrame(sessionReady(row, `gateway-${row}`, 0x30 + row.charCodeAt(0))),
      coverage: ["session_ready", `support_row_${row}`, "ready_transition"],
    });
  }

  // OpenChannel domain 0 and 1 for multi-domain
  for (const [id, domain, ch] of [
    ["evt-open-channel-d0", 0, 1],
    ["evt-open-channel-d1", 1, 2],
  ] as const) {
    push({
      id,
      kind: "control",
      direction: "client_to_server",
      carrier: "control_cbor",
      bytes: controlFrame(
        new Map<number | bigint, CborValue>([
          [1, CONTROL_KIND_OPEN_CHANNEL],
          [2, corr(10 + ch)],
          [29, ch],
          [30, 0],
          [31, domain === 0 ? "/chatter" : "/scan"],
          [4, "std_msgs/msg/String"],
          [3, schemaId()],
          [5, 1],
          [6, 1],
          [11, qosKeepLast()],
          [32, 2],
          [12, budgets()],
          [9, domain],
          [8, "H-FT"],
        ]),
      ),
      coverage: ["open_channel", `domain_${domain}`],
    });
  }

  // ChannelReady for ch1 reliable and ch1 best-effort variants
  push({
    id: "evt-channel-ready-ch1-reliable",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_CHANNEL_READY],
        [2, corr(11)],
        [29, 1],
        [33, 0],
        [12, budgets()],
        [59, 2],
        [57, new Map<number, CborValue>([[1, 1], [2, 1], [3, 1], [4, 1], [7, 1]])], // reliable
        [9, 0],
        [8, "H-FT"],
      ]),
    ),
    coverage: ["channel_ready", "reliable"],
  });

  push({
    id: "evt-channel-ready-ch1-best-effort",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_CHANNEL_READY],
        [2, corr(12)],
        [29, 1],
        [33, 0],
        [12, budgets()],
        [59, 2],
        [57, new Map<number, CborValue>([[1, 2], [2, 1], [3, 1], [4, 1], [7, 1]])], // best effort
        [9, 0],
        [8, "H-FT"],
      ]),
    ),
    coverage: ["channel_ready", "best_effort"],
  });

  push({
    id: "evt-channel-ready-ch2-d1",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_CHANNEL_READY],
        [2, corr(13)],
        [29, 2],
        [33, 0],
        [12, budgets()],
        [59, 2],
        [57, new Map<number, CborValue>([[1, 2], [2, 1], [3, 1], [4, 1], [7, 1]])],
        [9, 1],
        [8, "H-FT"],
      ]),
    ),
    coverage: ["channel_ready", "domain_1", "multi_domain"],
  });

  // Resume path
  const prevSid = new Uint8Array(32);
  prevSid[0] = 0x42;
  push({
    id: "evt-session-resume",
    kind: "control",
    direction: "client_to_server",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME],
        [2, corr(20)],
        [42, prevSid],
        [43, 0],
        [44, negCaps(true)],
        [7, "gateway-H-FT"],
        [8, "H-FT"],
        [14, 1],
        [6, 1],
        [13, "policy-v1"],
        [45, [new Map<number, CborValue>([[1, 1], [2, 1]])]],
        [16, "bearer"],
        [17, new Uint8Array([9, 9, 9])],
      ]),
    ),
    coverage: ["session_resume", "credential", "capability_resume"],
  });

  push({
    id: "evt-session-resume-wrong-gateway",
    kind: "control",
    direction: "client_to_server",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME],
        [2, corr(21)],
        [42, prevSid],
        [43, 0],
        [44, negCaps(true)],
        [7, "gateway-OTHER"],
        [8, "H-FT"],
        [14, 1],
        [6, 1],
        [13, "policy-v1"],
        [45, []],
        [16, "bearer"],
        [17, new Uint8Array([9, 9, 9])],
      ]),
    ),
    coverage: ["session_resume", "gateway_instance_mismatch"],
  });

  push({
    id: "evt-session-resume-wrong-row",
    kind: "control",
    direction: "client_to_server",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME],
        [2, corr(22)],
        [42, prevSid],
        [43, 0],
        [44, negCaps(true)],
        [7, "gateway-H-FT"],
        [8, "H-CY"],
        [14, 1],
        [6, 1],
        [13, "policy-v1"],
        [45, []],
        [16, "bearer"],
        [17, new Uint8Array([9, 9, 9])],
      ]),
    ),
    coverage: ["session_resume", "support_row_mismatch"],
  });

  push({
    id: "evt-resume-result-accept",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME_RESULT],
        [2, corr(20)],
        [46, true],
        // channel 1 status=0 next_sequence=2 when request acknowledged_sequence=1
        [47, [new Map<number, CborValue>([[1, 1], [2, 0], [3, 2]])]],
      ]),
    ),
    coverage: ["session_resume_result", "resume_success", "ready_transition"],
  });

  push({
    id: "evt-resume-result-gateway-mismatch",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME_RESULT],
        [2, corr(21)],
        [46, false],
        [15, new Map<number, CborValue>([[48, 18], [49, 0], [51, "gateway mismatch"]])],
      ]),
    ),
    coverage: ["session_resume_result", "gateway_instance_mismatch"],
  });

  push({
    id: "evt-resume-result-row-mismatch",
    kind: "control",
    direction: "server_to_client",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_SESSION_RESUME_RESULT],
        [2, corr(22)],
        [46, false],
        [15, new Map<number, CborValue>([[48, 19], [49, 0], [51, "row mismatch"]])],
      ]),
    ),
    coverage: ["session_resume_result", "support_row_mismatch"],
  });

  // ROS samples for sequence scenarios (only sequences used by scenarios).
  for (const seq of [0, 1, 2]) {
    push({
      id: `evt-ros-sample-be-seq-${seq}`,
      kind: "application",
      direction: "server_to_client",
      carrier: "ros_sample",
      bytes: rosSample(1, seq, false),
      coverage: ["ros_sample", "best_effort", `sequence_${seq}`],
    });
  }
  for (const seq of [0, 2]) {
    push({
      id: `evt-ros-sample-rel-seq-${seq}`,
      kind: "application",
      direction: "server_to_client",
      carrier: "ros_sample",
      bytes: rosSample(1, seq, true),
      coverage: ["ros_sample", "reliable", `sequence_${seq}`],
    });
  }

  // pre-ready open for step 17 guard (reuse open but will be used before ready)
  push({
    id: "evt-open-channel-pre-ready",
    kind: "control",
    direction: "client_to_server",
    carrier: "control_cbor",
    bytes: controlFrame(
      new Map<number | bigint, CborValue>([
        [1, CONTROL_KIND_OPEN_CHANNEL],
        [2, corr(99)],
        [29, 9],
        [30, 0],
        [31, "/early"],
        [4, "std_msgs/msg/String"],
        [3, schemaId()],
        [5, 1],
        [6, 1],
        [11, qosKeepLast()],
        [32, 2],
        [12, budgets()],
        [9, 0],
        [8, "H-FT"],
      ]),
    ),
    coverage: ["open_channel", "session_not_ready", "step_17"],
  });

  return events;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioEventRef = {
  event_id: string;
  session_id: string;
  expected: EventOutcome;
  state_after: CompositionState;
};

export type Scenario = {
  id: string;
  coverage: string[];
  initial: CompositionState;
  events: ScenarioEventRef[];
};

function baseProcess(row: SupportRowId): CompositionState {
  const pid = `proc-${row}`;
  const sid = `sess-${row}`;
  return {
    processes: {
      [pid]: { support_row: row, gateway_instance_id: `gateway-${row}` },
    },
    sessions: {
      [sid]: emptySession(pid, row, `gateway-${row}`, [0]),
    },
  };
}

function replay(
  initial: CompositionState,
  steps: Array<{ event_id: string; session_id: string; bytes: Uint8Array; kind: BuiltEvent["kind"] }>,
  registry: RegistryIndex,
  eventsById: Map<string, BuiltEvent>,
): ScenarioEventRef[] {
  let state = cloneState(initial);
  const out: ScenarioEventRef[] = [];
  for (const step of steps) {
    const ev = eventsById.get(step.event_id)!;
    const decoded = decodeEventBytes(ev.kind, step.bytes);
    const applied = applyEvent(state, step.session_id, decoded, registry);
    state = applied.state;
    out.push({
      event_id: step.event_id,
      session_id: step.session_id,
      expected: applied.outcome,
      state_after: cloneState(applied.state),
    });
  }
  return out;
}

export function buildScenarios(events: BuiltEvent[], registry: RegistryIndex): Scenario[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const scenarios: Scenario[] = [];

  // 1. no-common-version
  {
    const initial = baseProcess("H-FT");
    // server only supports [0], client sends [9]
    initial.sessions["sess-H-FT"]!.server_wire_versions = [0];
    const steps = [
      { event_id: "evt-client-hello-no-common", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-no-common")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-bootstrap-error-no-common", session_id: "sess-H-FT", bytes: byId.get("evt-bootstrap-error-no-common")!.bytes, kind: "bootstrap" as const },
    ];
    scenarios.push({
      id: "no-common-version",
      coverage: ["no_common_version", "bootstrap_step_11", "closed_pre_selection"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 2. fresh-open-success
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch1-reliable", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch1-reliable")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "fresh-open-success",
      coverage: ["fresh_open", "authenticate", "session_ready", "open_channel", "channel_ready", "ready_transition", "support_row_H-FT"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 3. resume-success
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-session-resume", session_id: "sess-H-FT", bytes: byId.get("evt-session-resume")!.bytes, kind: "control" as const },
      { event_id: "evt-resume-result-accept", session_id: "sess-H-FT", bytes: byId.get("evt-resume-result-accept")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "resume-success",
      coverage: ["resume_success", "session_resume", "credential", "capability_resume", "ready_transition"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 4. gateway-instance-mismatch
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-session-resume-wrong-gateway", session_id: "sess-H-FT", bytes: byId.get("evt-session-resume-wrong-gateway")!.bytes, kind: "control" as const },
      { event_id: "evt-resume-result-gateway-mismatch", session_id: "sess-H-FT", bytes: byId.get("evt-resume-result-gateway-mismatch")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "gateway-instance-mismatch",
      coverage: ["gateway_instance_mismatch", "resume_reject", "ready_false"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 5. support-row-mismatch
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-session-resume-wrong-row", session_id: "sess-H-FT", bytes: byId.get("evt-session-resume-wrong-row")!.bytes, kind: "control" as const },
      { event_id: "evt-resume-result-row-mismatch", session_id: "sess-H-FT", bytes: byId.get("evt-resume-result-row-mismatch")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "support-row-mismatch",
      coverage: ["support_row_mismatch", "resume_reject", "ready_false"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 6. multi-domain-same-row
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch1-best-effort", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch1-best-effort")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d1", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d1")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch2-d1", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch2-d1")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "multi-domain-same-row",
      coverage: ["multi_domain", "same_row", "support_row_H-FT", "domain_0", "domain_1"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 7. cross-row-independent-sessions
  {
    const initial: CompositionState = { processes: {}, sessions: {} };
    for (const row of Object.keys(PHASE_ONE_ROWS) as SupportRowId[]) {
      const pid = `proc-${row}`;
      const sid = `sess-${row}`;
      initial.processes[pid] = { support_row: row, gateway_instance_id: `gateway-${row}` };
      initial.sessions[sid] = emptySession(pid, row, `gateway-${row}`, [0]);
    }
    const steps: Array<{ event_id: string; session_id: string; bytes: Uint8Array; kind: BuiltEvent["kind"] }> = [];
    for (const row of Object.keys(PHASE_ONE_ROWS) as SupportRowId[]) {
      const sid = `sess-${row}`;
      steps.push(
        { event_id: "evt-client-hello-v0", session_id: sid, bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" },
        { event_id: "evt-server-hello-v0", session_id: sid, bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" },
        { event_id: "evt-authenticate", session_id: sid, bytes: byId.get("evt-authenticate")!.bytes, kind: "control" },
        { event_id: `evt-session-ready-${row.toLowerCase()}`, session_id: sid, bytes: byId.get(`evt-session-ready-${row.toLowerCase()}`)!.bytes, kind: "control" },
      );
    }
    scenarios.push({
      id: "cross-row-independent-sessions",
      coverage: [
        "cross_row",
        "independent_sessions",
        "support_row_H-FT",
        "support_row_H-CY",
        "support_row_J-FT",
        "support_row_J-CY",
      ],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 8. best-effort-sequence-gap
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch1-best-effort", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch1-best-effort")!.bytes, kind: "control" as const },
      { event_id: "evt-ros-sample-be-seq-0", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-0")!.bytes, kind: "application" as const },
      { event_id: "evt-ros-sample-be-seq-2", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-2")!.bytes, kind: "application" as const },
    ];
    scenarios.push({
      id: "best-effort-sequence-gap",
      coverage: ["sequence_gap", "best_effort", "step_26"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 9. best-effort-stale-sequence
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch1-best-effort", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch1-best-effort")!.bytes, kind: "control" as const },
      { event_id: "evt-ros-sample-be-seq-0", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-0")!.bytes, kind: "application" as const },
      { event_id: "evt-ros-sample-be-seq-2", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-2")!.bytes, kind: "application" as const },
      { event_id: "evt-ros-sample-be-seq-1", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-1")!.bytes, kind: "application" as const },
    ];
    scenarios.push({
      id: "best-effort-stale-sequence",
      coverage: ["stale_sequence", "best_effort", "step_27"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 10. reliable-sequence-mismatch
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      { event_id: "evt-channel-ready-ch1-reliable", session_id: "sess-H-FT", bytes: byId.get("evt-channel-ready-ch1-reliable")!.bytes, kind: "control" as const },
      { event_id: "evt-ros-sample-rel-seq-0", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-rel-seq-0")!.bytes, kind: "application" as const },
      { event_id: "evt-ros-sample-rel-seq-2", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-rel-seq-2")!.bytes, kind: "application" as const },
    ];
    scenarios.push({
      id: "reliable-sequence-mismatch",
      coverage: ["reliable_mismatch", "protocol_violation", "step_25"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 11. pre-ready open (step 17)
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-open-channel-pre-ready", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-pre-ready")!.bytes, kind: "control" as const },
    ];
    scenarios.push({
      id: "pre-ready-open-channel",
      coverage: ["session_not_ready", "step_17", "pre_ready_gating"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 12. pending-channel data (step 19)
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      { event_id: "evt-open-channel-d0", session_id: "sess-H-FT", bytes: byId.get("evt-open-channel-d0")!.bytes, kind: "control" as const },
      // data while pending
      { event_id: "evt-ros-sample-be-seq-0", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-0")!.bytes, kind: "application" as const },
    ];
    scenarios.push({
      id: "pending-channel-data",
      coverage: ["pending_channel", "step_19", "protocol_violation"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  // 13. never-opened channel data (step 20)
  {
    const initial = baseProcess("H-FT");
    const steps = [
      { event_id: "evt-client-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-client-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-server-hello-v0", session_id: "sess-H-FT", bytes: byId.get("evt-server-hello-v0")!.bytes, kind: "bootstrap" as const },
      { event_id: "evt-authenticate", session_id: "sess-H-FT", bytes: byId.get("evt-authenticate")!.bytes, kind: "control" as const },
      { event_id: "evt-session-ready-h-ft", session_id: "sess-H-FT", bytes: byId.get("evt-session-ready-h-ft")!.bytes, kind: "control" as const },
      // sample on channel 1 never opened
      { event_id: "evt-ros-sample-be-seq-0", session_id: "sess-H-FT", bytes: byId.get("evt-ros-sample-be-seq-0")!.bytes, kind: "application" as const },
    ];
    scenarios.push({
      id: "never-opened-channel-data",
      coverage: ["unknown_channel", "step_20", "never_opened"],
      initial,
      events: replay(initial, steps, registry, byId),
    });
  }

  return scenarios.sort((a, b) => asciiCompare(a.id, b.id));
}

export const REQUIRED_COVERAGE = [
  "no_common_version",
  "bootstrap_step_11",
  "fresh_open",
  "resume_success",
  "gateway_instance_mismatch",
  "support_row_mismatch",
  "multi_domain",
  "cross_row",
  "independent_sessions",
  "support_row_H-FT",
  "support_row_H-CY",
  "support_row_J-FT",
  "support_row_J-CY",
  "sequence_gap",
  "stale_sequence",
  "reliable_mismatch",
  "step_17",
  "step_19",
  "step_20",
  "step_25",
  "step_26",
  "step_27",
  "session_not_ready",
  "ready_transition",
  "credential",
  "capability_resume",
] as const;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type ManifestEvent = {
  id: string;
  kind: string;
  direction: string;
  carrier: string;
  path: string;
  byte_length: number;
  sha256: string;
  coverage: string[];
};

export type ManifestScenario = {
  id: string;
  path: string;
  byte_length: number;
  sha256: string;
  event_ids: string[];
  coverage: string[];
};

export type Manifest = {
  schema_version: number;
  protocol: string;
  byte_order: "network";
  generated_by: string;
  scenarios: ManifestScenario[];
  events: ManifestEvent[];
};

export function buildCorpus(registry: RegistryIndex): {
  manifest: Manifest;
  scenarios: Scenario[];
  events: BuiltEvent[];
} {
  const events = buildEventLibrary().sort((a, b) => asciiCompare(a.id, b.id));
  const scenarios = buildScenarios(events, registry);
  const manifestEvents: ManifestEvent[] = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    direction: e.direction,
    carrier: e.carrier,
    path: `events/${e.id}.bin`,
    byte_length: e.bytes.length,
    sha256: sha256Hex(e.bytes),
    coverage: sortAscii(e.coverage),
  }));
  const manifestScenarios: ManifestScenario[] = scenarios.map((s) => {
    const body = stableJson({
      id: s.id,
      coverage: sortAscii(s.coverage),
      initial: s.initial,
      events: s.events,
    });
    const bytes = new TextEncoder().encode(body);
    return {
      id: s.id,
      path: `scenarios/${s.id}.json`,
      byte_length: bytes.length,
      sha256: sha256Hex(bytes),
      event_ids: s.events.map((e) => e.event_id),
      coverage: sortAscii(s.coverage),
    };
  });
  return {
    manifest: {
      schema_version: SCHEMA_VERSION,
      protocol: PROTOCOL_ID,
      byte_order: "network",
      generated_by: GENERATED_BY,
      scenarios: manifestScenarios,
      events: manifestEvents,
    },
    scenarios,
    events,
  };
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

async function loadRegistryFromRoot(root: string): Promise<RegistryIndex> {
  await ensureRealDirectoryChain(root, ["protocol", "registry"], false);
  const regAbs = resolveUnderRoot(root, REGISTRY_REL);
  const read = await readBoundedFile(regAbs, REGISTRY_MAX_BYTES);
  if (!read.ok) throw new Error(`registry: ${read.error}`);
  return loadRegistryIndex(JSON.parse(read.text));
}

/** Prune stale regular files/symlinks; reject unsafe directory/nonregular entries. */
async function closeStaleDirEntries(
  dirAbs: string,
  wantNames: Set<string>,
  label: string,
): Promise<void> {
  const ents = await readdir(dirAbs, { withFileTypes: true });
  for (const ent of ents) {
    if (wantNames.has(ent.name)) continue;
    const abs = path.join(dirAbs, ent.name);
    // lstat via Dirent: isSymbolicLink checked first (isFile follows on some platforms).
    if (ent.isSymbolicLink()) {
      await unlink(abs);
      continue;
    }
    if (ent.isFile()) {
      await unlink(abs);
      continue;
    }
    if (ent.isDirectory()) {
      throw new Error(`unsafe directory entry in ${label}/: ${ent.name}`);
    }
    throw new Error(`unsafe nonregular entry in ${label}/: ${ent.name}`);
  }
}

/** Close sequences root: exact {manifest.json, README.md, events/, scenarios/}. */
async function closeSequencesRoot(seqDir: string): Promise<void> {
  const want = new Set<string>([...SEQUENCES_ROOT_FILES, ...SEQUENCES_ROOT_DIRS]);
  const ents = await readdir(seqDir, { withFileTypes: true });
  for (const ent of ents) {
    if (!want.has(ent.name)) {
      const abs = path.join(seqDir, ent.name);
      if (ent.isSymbolicLink() || ent.isFile()) {
        await unlink(abs);
        continue;
      }
      if (ent.isDirectory()) {
        throw new Error(`unsafe directory entry in sequences/: ${ent.name}`);
      }
      throw new Error(`unsafe nonregular entry in sequences/: ${ent.name}`);
    }
    // Expected entry type checks.
    if ((SEQUENCES_ROOT_FILES as readonly string[]).includes(ent.name)) {
      if (ent.isSymbolicLink()) throw new Error(`sequences/${ent.name} must not be a symlink`);
      if (!ent.isFile()) throw new Error(`sequences/${ent.name} must be a regular file`);
    }
    if ((SEQUENCES_ROOT_DIRS as readonly string[]).includes(ent.name)) {
      if (ent.isSymbolicLink()) throw new Error(`sequences/${ent.name} must not be a symlink`);
      if (!ent.isDirectory()) throw new Error(`sequences/${ent.name} must be a directory`);
    }
  }
}

export async function writeSequenceFixtures(root: string): Promise<Manifest> {
  const registry = await loadRegistryFromRoot(root);
  const { manifest, scenarios, events } = buildCorpus(registry);

  await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences", "scenarios"], true);
  await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences", "events"], true);

  const seqDir = resolveUnderRoot(root, SEQUENCES_DIR_REL);
  const scenDir = resolveUnderRoot(root, SCENARIOS_DIR_REL);
  const evtDir = resolveUnderRoot(root, EVENTS_DIR_REL);

  const wantEvents = new Set(events.map((e) => `${e.id}.bin`));
  const wantScenarios = new Set(scenarios.map((s) => `${s.id}.json`));

  for (const e of events) {
    const abs = resolveUnderRoot(root, path.posix.join(SEQUENCES_DIR_REL, `events/${e.id}.bin`));
    await writeArtifactBytes(abs, e.bytes);
  }
  for (const s of scenarios) {
    const body = stableJson({
      id: s.id,
      coverage: sortAscii(s.coverage),
      initial: s.initial,
      events: s.events,
    });
    const abs = resolveUnderRoot(root, path.posix.join(SEQUENCES_DIR_REL, `scenarios/${s.id}.json`));
    await writeArtifactBytes(abs, new TextEncoder().encode(body));
  }
  await writeArtifactBytes(
    resolveUnderRoot(root, MANIFEST_REL),
    new TextEncoder().encode(stableJson(manifest)),
  );

  // Deterministic README owned by the writer.
  await writeArtifactBytes(
    resolveUnderRoot(root, path.posix.join(SEQUENCES_DIR_REL, "README.md")),
    new TextEncoder().encode(SEQUENCES_README),
  );

  // Close stale output safely: prune explicit stale regular files/symlinks of any
  // extension; never traverse/delete unknown directories (reject instead).
  await closeStaleDirEntries(evtDir, wantEvents, "events");
  await closeStaleDirEntries(scenDir, wantScenarios, "scenarios");
  await closeSequencesRoot(seqDir);

  return manifest;
}

/** Canonical sequences README content (writer-owned; check verifies byte identity). */
export const SEQUENCES_README = [
  "# R2WP v0 receiver state-sequence fixtures",
  "",
  "State-sequence corpus for session, channel, and sequence receiver behavior (M0-03e2).",
  "Generated and checked by [`scripts/protocol-sequence-fixtures.ts`](../../../scripts/protocol-sequence-fixtures.ts).",
  "",
  "## Layout",
  "",
  "| Path | Role |",
  "|---|---|",
  "| `manifest.json` | Versioned index of scenarios and reusable events |",
  "| `scenarios/*.json` | Ordered events, expected outcomes, full state projections |",
  "| `events/*.bin` | Exact wire event bytes (bootstrap / CONTROL_CBOR / ROS_SAMPLE) |",
  "",
  "## Phase 1 support rows",
  "",
  "| Row | ROS distro | RMW |",
  "|---|---|---|",
  "| H-FT | humble | rmw_fastrtps_cpp |",
  "| H-CY | humble | rmw_cyclonedds_cpp |",
  "| J-FT | jazzy | rmw_fastrtps_cpp |",
  "| J-CY | jazzy | rmw_cyclonedds_cpp |",
  "",
  "Each gateway process binds one row. Multiple domain ids share that row. Cross-row composition uses independent sessions.",
  "",
  "## Commands",
  "",
  "```bash",
  "bun run protocol-sequence-fixtures:write",
  "bun run protocol-sequence-fixtures:check",
  "bun test scripts/protocol-sequence-fixtures.test.ts",
  "```",
  "",
  "Oracle outcomes are hard-coded from a deterministic state machine and cross-bound to",
  "[`protocol/registry/r2wp-v0.json`](../../registry/r2wp-v0.json) error, disposition, and validation_order tables.",
  "",
].join("\n");

export type CheckResult = { diags: string[]; manifest: Manifest | null };

export async function checkSequenceFixtures(root: string): Promise<CheckResult> {
  const diags: string[] = [];

  // Check mode is filesystem read-only.
  try {
    await ensureRealDirectoryChain(root, ["protocol", "registry"], false);
  } catch (e) {
    return {
      diags: [`disk: registry path chain invalid: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }
  try {
    await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences"], false);
  } catch (e) {
    return {
      diags: [`disk: sequences path chain invalid: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }
  try {
    await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences", "scenarios"], false);
    await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences", "events"], false);
  } catch (e) {
    return {
      diags: [`disk: sequences subdir chain invalid: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }

  // Sequences root closure: exact {manifest.json, README.md, events/, scenarios/}.
  {
    const seqDir = resolveUnderRoot(root, SEQUENCES_DIR_REL);
    const rootDiags = await diagnoseSequencesRoot(seqDir);
    if (rootDiags.length) {
      // Continue collecting other diags only after root is closed enough to read artifacts;
      // hard-fail early when root itself is wrong so probes like ignored.txt surface cleanly.
      diags.push(...rootDiags);
    }
  }

  let registry: RegistryIndex;
  try {
    registry = await loadRegistryFromRoot(root);
  } catch (e) {
    return { diags: [`registry: ${e instanceof Error ? e.message : String(e)}`], manifest: null };
  }

  // 1) Bounded no-follow read + parse manifest as data.
  const manAbs = resolveUnderRoot(root, MANIFEST_REL);
  const manRead = await readBoundedFile(manAbs, MANIFEST_MAX_BYTES);
  if (!manRead.ok) return { diags: [`manifest: ${manRead.error}`], manifest: null };
  let raw: unknown;
  try {
    raw = JSON.parse(manRead.text);
  } catch (e) {
    return {
      diags: [`manifest: malformed JSON: ${e instanceof Error ? e.message : String(e)}`],
      manifest: null,
    };
  }

  const schemaDiags = diagnoseManifestValue(raw);
  if (schemaDiags.length) return { diags: sortAscii(schemaDiags), manifest: null };

  const manifest = raw as Manifest;
  // Raw canonical form.
  if (manRead.text !== stableJson(manifest)) {
    diags.push("manifest: raw text is not canonical stableJson format");
    return { diags: sortAscii(diags), manifest: null };
  }

  // Optional writer-reference identity only. Disk remains the data source for parse/replay.
  // Never let a broken registry/oracle throw out of check; surface a diagnostic instead.
  try {
    const rebuilt = buildCorpus(registry);
    if (stableJson(manifest) !== stableJson(rebuilt.manifest)) {
      diags.push("manifest: not identical to deterministic writer reference");
    }
  } catch (e) {
    diags.push(
      `writer reference rebuild failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2) Load events from disk via manifest entries.
  const diskEvents = new Map<string, { meta: ManifestEvent; bytes: Uint8Array }>();
  const expectedEventFiles = new Set<string>();
  for (const ev of manifest.events) {
    if (!isCanonicalEventPath(ev.id, ev.path)) {
      diags.push(`event ${ev.id}: path must be events/<id>.bin`);
      continue;
    }
    expectedEventFiles.add(path.posix.basename(ev.path));
    const abs = resolveUnderRoot(root, path.posix.join(SEQUENCES_DIR_REL, ev.path));
    const read = await readArtifactBytes(abs, PER_EVENT_ALLOC_MAX);
    if (!read.ok) {
      diags.push(`event ${ev.id}: ${read.error}`);
      continue;
    }
    if (read.bytes.length !== ev.byte_length) {
      diags.push(`event ${ev.id}: disk length ${read.bytes.length} != ${ev.byte_length}`);
    }
    if (sha256Hex(read.bytes) !== ev.sha256) {
      diags.push(`event ${ev.id}: disk sha256 mismatch`);
    }
    // Decode through codecs; kind/carrier consistency (strict).
    try {
      const decoded = decodeEventBytes(ev.kind as "bootstrap" | "control" | "application", read.bytes);
      if (ev.kind === "bootstrap" && decoded.kind !== "bootstrap") {
        diags.push(`event ${ev.id}: kind bootstrap but decoded ${decoded.kind}`);
      }
      if (ev.kind === "control" && decoded.kind !== "control") {
        diags.push(`event ${ev.id}: kind control but decoded ${decoded.kind}`);
      }
      if (ev.kind === "application" && decoded.kind !== "application") {
        diags.push(`event ${ev.id}: kind application but decoded ${decoded.kind}`);
      }
      if (ev.carrier === "bootstrap" && decoded.kind !== "bootstrap") {
        diags.push(`event ${ev.id}: carrier bootstrap but decoded ${decoded.kind}`);
      }
      if (ev.carrier === "control_cbor" && decoded.kind !== "control") {
        diags.push(`event ${ev.id}: carrier control_cbor but decoded ${decoded.kind}`);
      }
      if (ev.carrier === "ros_sample") {
        if (decoded.kind !== "application") {
          diags.push(`event ${ev.id}: carrier ros_sample but decoded ${decoded.kind}`);
        } else if (decoded.frame.opcode !== OPCODE_ROS_SAMPLE) {
          diags.push(
            `event ${ev.id}: carrier ros_sample requires opcode ROS_SAMPLE got ${decoded.frame.opcode}`,
          );
        }
      }
    } catch (e) {
      diags.push(
        `event ${ev.id}: decode failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    diskEvents.set(ev.id, { meta: ev, bytes: read.bytes });
  }

  // Directory closure for events: every entry must match the exact manifest file set.
  const evtDir = resolveUnderRoot(root, EVENTS_DIR_REL);
  diags.push(...(await diagnoseDirClosure(evtDir, expectedEventFiles, "events")));

  // 3) Load scenarios from disk via manifest; closed-validate; replay with disk event bytes.
  const usedEvents = new Set<string>();
  const expectedScenarioFiles = new Set<string>();
  const cov = new Set<string>();

  for (const scMeta of manifest.scenarios) {
    if (!isCanonicalScenarioPath(scMeta.id, scMeta.path)) {
      diags.push(`scenario ${scMeta.id}: path must be scenarios/<id>.json`);
      continue;
    }
    expectedScenarioFiles.add(path.posix.basename(scMeta.path));
    const abs = resolveUnderRoot(root, path.posix.join(SEQUENCES_DIR_REL, scMeta.path));
    const read = await readBoundedFile(abs, SCENARIO_MAX_BYTES);
    if (!read.ok) {
      diags.push(`scenario ${scMeta.id}: ${read.error}`);
      continue;
    }
    const utf8Len = new TextEncoder().encode(read.text).length;
    if (utf8Len !== scMeta.byte_length) {
      diags.push(`scenario ${scMeta.id}: disk length ${utf8Len} != ${scMeta.byte_length}`);
    }
    if (sha256Hex(new TextEncoder().encode(read.text)) !== scMeta.sha256) {
      diags.push(`scenario ${scMeta.id}: disk sha256 mismatch`);
    }
    let scenRaw: unknown;
    try {
      scenRaw = JSON.parse(read.text);
    } catch (e) {
      diags.push(
        `scenario ${scMeta.id}: malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const scenDiags = diagnoseScenarioValue(scenRaw, scMeta.id);
    if (scenDiags.length) {
      for (const d of scenDiags) diags.push(d);
      continue;
    }
    if (read.text !== stableJson(scenRaw)) {
      diags.push(`scenario ${scMeta.id}: raw text is not canonical stableJson format`);
      continue;
    }
    const scenario = scenRaw as {
      id: string;
      coverage: string[];
      initial: CompositionState;
      events: ScenarioEventRef[];
    };
    if (scenario.id !== scMeta.id) {
      diags.push(`scenario ${scMeta.id}: body id mismatch`);
    }
    // manifest event_ids must exactly equal scenario event order
    const bodyIds = scenario.events.map((e) => e.event_id);
    if (JSON.stringify(bodyIds) !== JSON.stringify(scMeta.event_ids)) {
      diags.push(`scenario ${scMeta.id}: manifest event_ids != scenario event order`);
    }
    for (const c of scenario.coverage) cov.add(c);

    // Replay using on-disk event bytes only.
    let state = cloneState(scenario.initial);
    for (let i = 0; i < scenario.events.length; i++) {
      const ref = scenario.events[i]!;
      usedEvents.add(ref.event_id);
      const diskEv = diskEvents.get(ref.event_id);
      if (!diskEv) {
        diags.push(`scenario ${scMeta.id} event ${i}: unresolved event ${ref.event_id}`);
        continue;
      }
      const manEv = diskEv.meta;
      let decoded: DecodedEvent;
      try {
        decoded = decodeEventBytes(
          manEv.kind as "bootstrap" | "control" | "application",
          diskEv.bytes,
        );
      } catch (e) {
        diags.push(
          `scenario ${scMeta.id} event ${i}: decode failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }
      // Kind/carrier/direction consistency against decoded wire + transition side.
      if (manEv.kind === "bootstrap" && decoded.kind !== "bootstrap") {
        diags.push(`scenario ${scMeta.id} event ${i}: kind bootstrap but decoded ${decoded.kind}`);
      }
      if (manEv.kind === "control" && decoded.kind !== "control") {
        diags.push(`scenario ${scMeta.id} event ${i}: kind control but decoded ${decoded.kind}`);
      }
      if (manEv.kind === "application" && decoded.kind !== "application") {
        diags.push(`scenario ${scMeta.id} event ${i}: kind application but decoded ${decoded.kind}`);
      }
      if (manEv.carrier === "bootstrap" && decoded.kind !== "bootstrap") {
        diags.push(`scenario ${scMeta.id} event ${i}: carrier/bootstrap mismatch`);
      }
      if (manEv.carrier === "control_cbor" && decoded.kind !== "control") {
        diags.push(`scenario ${scMeta.id} event ${i}: carrier/control_cbor mismatch`);
      }
      if (manEv.carrier === "ros_sample") {
        if (decoded.kind !== "application") {
          diags.push(`scenario ${scMeta.id} event ${i}: carrier/ros_sample mismatch`);
        } else if (decoded.frame.opcode !== OPCODE_ROS_SAMPLE) {
          diags.push(`scenario ${scMeta.id} event ${i}: ros_sample opcode mismatch`);
        }
      }
      const expectedDir = expectedDirectionForDecoded(decoded);
      if (expectedDir && manEv.direction !== expectedDir) {
        diags.push(
          `scenario ${scMeta.id} event ${i}: direction ${manEv.direction} != wire-side ${expectedDir}`,
        );
      }
      // Session id must exist in the on-disk initial/projected state graph.
      if (!state.sessions[ref.session_id]) {
        diags.push(`scenario ${scMeta.id} event ${i}: unknown session_id ${ref.session_id}`);
        continue;
      }
      // Process binding immutability: capture before transition.
      const procId = state.sessions[ref.session_id]!.process_id;
      const procBefore = state.processes[procId]
        ? { ...state.processes[procId]! }
        : null;
      let applied: { outcome: EventOutcome; state: CompositionState };
      try {
        applied = applyEvent(state, ref.session_id, decoded, registry);
      } catch (e) {
        diags.push(
          `scenario ${scMeta.id} event ${i}: oracle threw: ${e instanceof Error ? e.message : String(e)}`,
        );
        // Still cross-bind the stored expected outcome against the registry.
        diags.push(
          ...crossBindOutcome(ref.expected, registry, `scenario ${scMeta.id} event ${i}`),
        );
        continue;
      }
      state = applied.state;
      // Process support_row / gateway_instance_id are immutable.
      if (procBefore) {
        const after = state.processes[procId];
        if (
          !after ||
          after.support_row !== procBefore.support_row ||
          after.gateway_instance_id !== procBefore.gateway_instance_id
        ) {
          diags.push(`scenario ${scMeta.id} event ${i}: process binding mutated`);
        }
      }
      // Cross-bind stored expected outcome to registry.
      const bindDiags = crossBindOutcome(ref.expected, registry, `scenario ${scMeta.id} event ${i}`);
      diags.push(...bindDiags);
      if (JSON.stringify(applied.outcome) !== JSON.stringify(ref.expected)) {
        diags.push(`scenario ${scMeta.id} event ${i}: outcome mismatch vs disk projection`);
      }
      if (JSON.stringify(applied.state) !== JSON.stringify(ref.state_after)) {
        diags.push(`scenario ${scMeta.id} event ${i}: state_after mismatch vs disk projection`);
      }
      // Serialized state must not contain undeclared fields (e.g. _pending_acks).
      const undeclared = findUndeclaredStateKeys(ref.state_after);
      for (const u of undeclared) {
        diags.push(`scenario ${scMeta.id} event ${i}: undeclared state key ${u}`);
      }
    }
  }

  // Scenario directory closure: every entry must match the exact manifest file set.
  const scenDir = resolveUnderRoot(root, SCENARIOS_DIR_REL);
  diags.push(...(await diagnoseDirClosure(scenDir, expectedScenarioFiles, "scenarios")));

  // Every indexed event must be used.
  for (const ev of manifest.events) {
    if (!usedEvents.has(ev.id)) diags.push(`event ${ev.id}: unused (not referenced by any scenario)`);
  }

  for (const req of REQUIRED_COVERAGE) {
    if (!cov.has(req)) diags.push(`coverage: missing ${req}`);
  }

  const sorted = sortAscii(diags);
  return { diags: sorted, manifest: sorted.length === 0 ? manifest : null };
}

function crossBindOutcome(
  expected: EventOutcome,
  registry: RegistryIndex,
  path: string,
): string[] {
  const diags: string[] = [];
  // Shape first.
  diags.push(...diagnoseEventOutcome(expected, path));
  if (expected.status === "success") {
    // All nulls already enforced by diagnoseEventOutcome.
    return diags;
  }
  if (expected.status === "error") {
    if (expected.registry_code === null || expected.registry_name === null) return diags;
    const name = registry.errors[String(expected.registry_code)]?.name;
    if (name !== expected.registry_name) {
      diags.push(
        `${path}: registry code ${expected.registry_code} name ${name} != ${expected.registry_name}`,
      );
    }
    if (expected.plane !== null && expected.step !== null) {
      const row =
        expected.plane === "bootstrap"
          ? registry.bootstrapSteps.get(expected.step)
          : registry.frameSteps.get(expected.step);
      if (!row) diags.push(`${path}: unknown ${expected.plane} step ${expected.step}`);
      else {
        if (row.code !== null && row.code !== expected.registry_code) {
          diags.push(`${path}: step code ${row.code} != ${expected.registry_code}`);
        }
        if (row.error !== null && row.error !== expected.registry_name) {
          diags.push(`${path}: step error ${row.error} != ${expected.registry_name}`);
        }
      }
    }
  } else if (expected.status === "disposition") {
    if (expected.disposition_code === null || expected.disposition_name === null) return diags;
    const name = registry.dispositions[String(expected.disposition_code)];
    if (name !== expected.disposition_name) {
      diags.push(
        `${path}: disposition code ${expected.disposition_code} name ${name} != ${expected.disposition_name}`,
      );
    }
    if (expected.plane === "selected_frame" && expected.step !== null) {
      const row = registry.frameSteps.get(expected.step);
      if (!row || row.disposition !== expected.disposition_name) {
        diags.push(`${path}: disposition step ${expected.step} mismatch`);
      }
    }
  }
  return diags;
}

/** Compare every directory entry against the exact expected file name set. */
async function diagnoseDirClosure(
  dirAbs: string,
  expectedNames: Set<string>,
  label: string,
): Promise<string[]> {
  const diags: string[] = [];
  let ents: Awaited<ReturnType<typeof readdir>>;
  try {
    ents = await readdir(dirAbs, { withFileTypes: true });
  } catch (e) {
    return [`disk: ${label} readdir failed: ${e instanceof Error ? e.message : String(e)}`];
  }
  const seen = new Set<string>();
  for (const ent of ents) {
    seen.add(ent.name);
    if (!expectedNames.has(ent.name)) {
      if (ent.isDirectory()) diags.push(`disk: extra ${label} directory ${ent.name}`);
      else if (ent.isSymbolicLink()) diags.push(`disk: extra ${label} symlink ${ent.name}`);
      else if (!ent.isFile()) diags.push(`disk: extra ${label} nonregular ${ent.name}`);
      else diags.push(`disk: extra ${label} file ${ent.name}`);
      continue;
    }
    // Expected name present: must be a regular file (not symlink/dir).
    if (ent.isSymbolicLink()) diags.push(`disk: ${label} ${ent.name} is symlink`);
    else if (ent.isDirectory()) diags.push(`disk: ${label} ${ent.name} is directory`);
    else if (!ent.isFile()) diags.push(`disk: ${label} ${ent.name} is not a regular file`);
  }
  for (const n of expectedNames) {
    if (!seen.has(n)) diags.push(`disk: missing ${label} file ${n}`);
  }
  return diags;
}

/** Exact sequences root: manifest.json, README.md, events/, scenarios/ with types. */
export async function diagnoseSequencesRoot(seqDir: string): Promise<string[]> {
  const diags: string[] = [];
  let ents: Awaited<ReturnType<typeof readdir>>;
  try {
    ents = await readdir(seqDir, { withFileTypes: true });
  } catch (e) {
    return [`disk: sequences readdir failed: ${e instanceof Error ? e.message : String(e)}`];
  }
  const want = new Set<string>([...SEQUENCES_ROOT_FILES, ...SEQUENCES_ROOT_DIRS]);
  const seen = new Set<string>();
  for (const ent of ents) {
    seen.add(ent.name);
    if (!want.has(ent.name)) {
      if (ent.isDirectory()) diags.push(`disk: extra sequences directory ${ent.name}`);
      else if (ent.isSymbolicLink()) diags.push(`disk: extra sequences symlink ${ent.name}`);
      else if (!ent.isFile()) diags.push(`disk: extra sequences nonregular ${ent.name}`);
      else diags.push(`disk: extra sequences file ${ent.name}`);
      continue;
    }
    if ((SEQUENCES_ROOT_FILES as readonly string[]).includes(ent.name)) {
      if (ent.isSymbolicLink()) diags.push(`disk: sequences ${ent.name} is symlink`);
      else if (!ent.isFile()) diags.push(`disk: sequences ${ent.name} is not a regular file`);
    }
    if ((SEQUENCES_ROOT_DIRS as readonly string[]).includes(ent.name)) {
      if (ent.isSymbolicLink()) diags.push(`disk: sequences ${ent.name} is symlink`);
      else if (!ent.isDirectory()) diags.push(`disk: sequences ${ent.name} is not a directory`);
    }
  }
  for (const n of want) {
    if (!seen.has(n)) diags.push(`disk: missing sequences entry ${n}`);
  }
  // Deterministic README content when present and regular.
  if (seen.has("README.md")) {
    const readmeAbs = path.join(seqDir, "README.md");
    const read = await readBoundedFile(readmeAbs, 64 * 1024);
    if (!read.ok) diags.push(`disk: README.md ${read.error}`);
    else if (read.text !== SEQUENCES_README) {
      diags.push("disk: README.md is not the canonical SEQUENCES_README content");
    }
  }
  return diags;
}

/** Closed structural validation of parsed manifest. */
export function diagnoseManifestValue(value: unknown): string[] {
  const diags: string[] = [];
  if (value === null) return ["manifest: root is null"];
  if (!isPlainObject(value)) return ["manifest: root must be object"];
  exactKeys(value, MANIFEST_KEYS, "manifest", diags);
  requireKeys(value, MANIFEST_KEYS, "manifest", diags);
  if (value.schema_version !== SCHEMA_VERSION) diags.push("manifest: bad schema_version");
  if (value.protocol !== PROTOCOL_ID) diags.push("manifest: bad protocol");
  if (value.byte_order !== "network") diags.push("manifest: bad byte_order");
  if (value.generated_by !== GENERATED_BY) diags.push("manifest: bad generated_by");
  if (
    !Array.isArray(value.scenarios) ||
    value.scenarios.length === 0 ||
    value.scenarios.length > SCENARIO_COUNT_MAX
  ) {
    diags.push("manifest: scenarios array invalid (require positive bounded count)");
    return sortAscii(diags);
  }
  if (
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    value.events.length > EVENT_COUNT_MAX
  ) {
    diags.push("manifest: events array invalid (require positive bounded count)");
    return sortAscii(diags);
  }
  const scenIds = new Set<string>();
  const evtIds = new Set<string>();
  const scenPaths = new Set<string>();
  const evtPaths = new Set<string>();
  let prevS = "";
  let prevE = "";
  const SCENARIO_ENTRY_KEYS = ["id", "path", "byte_length", "sha256", "event_ids", "coverage"] as const;
  const EVENT_ENTRY_KEYS = [
    "id",
    "kind",
    "direction",
    "carrier",
    "path",
    "byte_length",
    "sha256",
    "coverage",
  ] as const;
  for (let i = 0; i < value.scenarios.length; i++) {
    const s = value.scenarios[i];
    const p = `manifest.scenarios/${i}`;
    if (!isPlainObject(s)) {
      diags.push(`${p}: must be object`);
      continue;
    }
    exactKeys(s, SCENARIO_ENTRY_KEYS, p, diags);
    requireKeys(s, SCENARIO_ENTRY_KEYS, p, diags);
    if (typeof s.id !== "string" || !ID_PATTERN.test(s.id)) diags.push(`${p}: bad id`);
    else {
      if (scenIds.has(s.id)) diags.push(`${p}: duplicate id`);
      scenIds.add(s.id);
      if (prevS && asciiCompare(prevS, s.id) >= 0) diags.push(`${p}: scenarios not sorted`);
      prevS = s.id;
    }
    if (typeof s.path !== "string" || (typeof s.id === "string" && !isCanonicalScenarioPath(s.id, s.path))) {
      diags.push(`${p}: bad path`);
    } else if (scenPaths.has(s.path)) diags.push(`${p}: duplicate path`);
    else scenPaths.add(s.path as string);
    if (
      typeof s.byte_length !== "number" ||
      !Number.isSafeInteger(s.byte_length) ||
      s.byte_length <= 0 ||
      s.byte_length > SCENARIO_MAX_BYTES
    ) {
      diags.push(`${p}: bad byte_length`);
    }
    if (typeof s.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.sha256)) diags.push(`${p}: bad sha256`);
    if (!Array.isArray(s.event_ids)) diags.push(`${p}: event_ids must be array`);
    else if (s.event_ids.length > EVENT_COUNT_MAX) diags.push(`${p}: event_ids too long`);
    else {
      for (const eid of s.event_ids) {
        if (typeof eid !== "string" || !ID_PATTERN.test(eid)) diags.push(`${p}: bad event_id ref`);
      }
    }
    if (!Array.isArray(s.coverage) || s.coverage.length > COVERAGE_MAX) {
      diags.push(`${p}: coverage must be bounded array`);
    } else {
      let pc = "";
      const seen = new Set<string>();
      for (const c of s.coverage) {
        if (typeof c !== "string" || !c || c.length > STRING_FIELD_MAX) diags.push(`${p}: bad coverage token`);
        else {
          if (seen.has(c)) diags.push(`${p}: duplicate coverage`);
          seen.add(c);
          if (pc && asciiCompare(pc, c) >= 0) diags.push(`${p}: coverage not sorted`);
          pc = c;
        }
      }
    }
  }
  for (let i = 0; i < value.events.length; i++) {
    const e = value.events[i];
    const p = `manifest.events/${i}`;
    if (!isPlainObject(e)) {
      diags.push(`${p}: must be object`);
      continue;
    }
    exactKeys(e, EVENT_ENTRY_KEYS, p, diags);
    requireKeys(e, EVENT_ENTRY_KEYS, p, diags);
    if (typeof e.id !== "string" || !ID_PATTERN.test(e.id)) diags.push(`${p}: bad id`);
    else {
      if (evtIds.has(e.id)) diags.push(`${p}: duplicate id`);
      evtIds.add(e.id);
      if (prevE && asciiCompare(prevE, e.id) >= 0) diags.push(`${p}: events not sorted`);
      prevE = e.id;
    }
    if (typeof e.path !== "string" || (typeof e.id === "string" && !isCanonicalEventPath(e.id, e.path))) {
      diags.push(`${p}: bad path`);
    } else if (evtPaths.has(e.path)) diags.push(`${p}: duplicate path`);
    else evtPaths.add(e.path as string);
    if (typeof e.kind !== "string" || !["bootstrap", "control", "application"].includes(e.kind)) {
      diags.push(`${p}: bad kind`);
    }
    if (
      typeof e.direction !== "string" ||
      !["client_to_server", "server_to_client"].includes(e.direction)
    ) {
      diags.push(`${p}: bad direction`);
    }
    if (
      typeof e.carrier !== "string" ||
      !["bootstrap", "control_cbor", "ros_sample"].includes(e.carrier)
    ) {
      diags.push(`${p}: bad carrier`);
    }
    // kind/carrier pairing
    if (e.kind === "bootstrap" && e.carrier !== "bootstrap") diags.push(`${p}: kind/carrier mismatch`);
    if (e.kind === "control" && e.carrier !== "control_cbor") diags.push(`${p}: kind/carrier mismatch`);
    if (e.kind === "application" && e.carrier !== "ros_sample") diags.push(`${p}: kind/carrier mismatch`);
    if (
      typeof e.byte_length !== "number" ||
      !Number.isSafeInteger(e.byte_length) ||
      e.byte_length <= 0 ||
      e.byte_length > PER_EVENT_ALLOC_MAX
    ) {
      diags.push(`${p}: bad byte_length`);
    }
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) diags.push(`${p}: bad sha256`);
    if (!Array.isArray(e.coverage) || e.coverage.length > COVERAGE_MAX) {
      diags.push(`${p}: coverage must be bounded array`);
    } else {
      let pc = "";
      const seen = new Set<string>();
      for (const c of e.coverage) {
        if (typeof c !== "string" || !c || c.length > STRING_FIELD_MAX) diags.push(`${p}: bad coverage token`);
        else {
          if (seen.has(c)) diags.push(`${p}: duplicate coverage`);
          seen.add(c);
          if (pc && asciiCompare(pc, c) >= 0) diags.push(`${p}: coverage not sorted`);
          pc = c;
        }
      }
    }
  }
  // Referential: every scenario event_id must resolve to a known event id.
  for (let i = 0; i < value.scenarios.length; i++) {
    const s = value.scenarios[i];
    if (!isPlainObject(s) || !Array.isArray(s.event_ids)) continue;
    for (const eid of s.event_ids) {
      if (typeof eid === "string" && !evtIds.has(eid)) {
        diags.push(`manifest.scenarios/${i}: unresolved event_id ${eid}`);
      }
    }
  }
  return sortAscii(diags);
}

export function diagnoseScenarioValue(value: unknown, expectedId: string): string[] {
  const diags: string[] = [];
  const root = `scenario ${expectedId}`;
  if (value === null) return [`${root}: root is null`];
  if (Array.isArray(value)) return [`${root}: root must be object not array`];
  if (!isPlainObject(value)) return [`${root}: root must be object`];
  const SCENARIO_KEYS = ["id", "coverage", "initial", "events"] as const;
  exactKeys(value, SCENARIO_KEYS, root, diags);
  requireKeys(value, SCENARIO_KEYS, root, diags);
  if (value.id !== expectedId) diags.push(`${root}: id mismatch`);
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) diags.push(`${root}: bad id`);

  if (!Array.isArray(value.coverage) || value.coverage.length > COVERAGE_MAX) {
    diags.push(`${root}: coverage must be bounded array`);
  } else {
    let pc = "";
    const seen = new Set<string>();
    for (const c of value.coverage) {
      if (typeof c !== "string" || !c || c.length > STRING_FIELD_MAX) {
        diags.push(`${root}: bad coverage token`);
      } else {
        if (seen.has(c)) diags.push(`${root}: duplicate coverage`);
        seen.add(c);
        if (pc && asciiCompare(pc, c) >= 0) diags.push(`${root}: coverage not sorted`);
        pc = c;
      }
    }
  }

  diags.push(...diagnoseCompositionState(value.initial, `${root}.initial`));

  if (!Array.isArray(value.events) || value.events.length > EVENT_COUNT_MAX) {
    diags.push(`${root}: events must be bounded array`);
  } else {
    const sessionIds =
      isPlainObject(value.initial) && isPlainObject(value.initial.sessions)
        ? new Set(Object.keys(value.initial.sessions))
        : new Set<string>();
    value.events.forEach((ev, i) => {
      const p = `${root}.events/${i}`;
      if (!isPlainObject(ev)) {
        diags.push(`${p}: must be object`);
        return;
      }
      const REF_KEYS = ["event_id", "session_id", "expected", "state_after"] as const;
      exactKeys(ev, REF_KEYS, p, diags);
      requireKeys(ev, REF_KEYS, p, diags);
      if (typeof ev.event_id !== "string" || !ID_PATTERN.test(ev.event_id)) {
        diags.push(`${p}: bad event_id`);
      }
      if (typeof ev.session_id !== "string" || !COMPOSITION_KEY_PATTERN.test(ev.session_id)) {
        diags.push(`${p}: bad session_id`);
      } else if (sessionIds.size && !sessionIds.has(ev.session_id)) {
        // Session must exist in initial composition (scenarios do not create sessions).
        diags.push(`${p}: session_id not in initial.sessions`);
      }
      diags.push(...diagnoseEventOutcome(ev.expected, `${p}.expected`));
      diags.push(...diagnoseCompositionState(ev.state_after, `${p}.state_after`));
    });
  }
  return sortAscii(diags);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseCliMode(argv: string[]): "write" | "check" | null {
  if (argv.length !== 1) return null;
  if (argv[0] === "--write") return "write";
  if (argv[0] === "--check") return "check";
  return null;
}

export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const mode = parseCliMode(argv);
  if (!mode) {
    console.error("usage: bun run scripts/protocol-sequence-fixtures.ts --write|--check");
    return 2;
  }
  if (mode === "write") {
    try {
      const m = await writeSequenceFixtures(root);
      console.log(`status=ok mode=write scenarios=${m.scenarios.length} events=${m.events.length} schema_version=${m.schema_version}`);
      return 0;
    } catch (e) {
      console.error(`status=fail write: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  const { diags, manifest } = await checkSequenceFixtures(root);
  if (diags.length || !manifest) {
    for (const d of diags) console.error(d);
    console.error(`status=fail diagnostics=${diags.length}`);
    return 1;
  }
  console.log(`status=ok mode=check scenarios=${manifest.scenarios.length} events=${manifest.events.length} schema_version=${manifest.schema_version}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
