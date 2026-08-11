#!/usr/bin/env bun
/**
 * R2WP v0 → MoonBit white-box fixture bridge (M0-03g1).
 *
 * Reads committed valid/boundary and malformed manifests and binaries under
 * protocol/testdata/ and emits a deterministic MoonBit white-box source file
 * at rclmbt/protocol/fixture_data_wbtest.mbt.
 *
 * --write  regenerate the committed MoonBit source
 * --check  regenerate in memory and byte-compare the committed source
 *
 * Offline and deterministic: every binary length and SHA-256 is verified
 * against its manifest before emission. The 64 MiB segment recipe stays a
 * descriptor; this batch validates recipe metadata only.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Paths and counts
// ---------------------------------------------------------------------------

export const VALID_MANIFEST_REL = "protocol/testdata/manifest.json";
export const MALFORMED_MANIFEST_REL = "protocol/testdata/malformed/manifest.json";
export const TESTDATA_REL = "protocol/testdata";
export const OUTPUT_REL = "rclmbt/protocol/fixture_data_wbtest.mbt";
export const GENERATED_BY = "scripts/protocol-moonbit-fixtures.ts";
export const PROTOCOL_ID = "r2wp-v0";
export const SCHEMA_VERSION = 1;

/** Exact corpus totals locked to the committed R2WP fixtures. */
export const VALID_TOTAL = 20;
export const VALID_BOOTSTRAP = 3;
export const VALID_FRAME_BINARY = 16;
export const VALID_SEGMENT_RECIPE = 1;
export const VALID_FRAME_TOTAL = VALID_FRAME_BINARY + VALID_SEGMENT_RECIPE; // 17
export const MALFORMED_TOTAL = 55;
export const MALFORMED_BOOTSTRAP = 14;
export const MALFORMED_FRAME = 41;
export const MATERIALIZED_BINARY_TOTAL =
  VALID_BOOTSTRAP + VALID_FRAME_BINARY + MALFORMED_BOOTSTRAP + MALFORMED_FRAME; // 74
export const FRAME_TOTAL = VALID_FRAME_TOTAL + MALFORMED_FRAME; // 58

/** Parser contract defaults (matches rclwebd FrameOptions::default). */
export const DEFAULT_SELECTED_VERSION = 0;
export const DEFAULT_EXPERIMENTAL_OPCODES_ENABLED = false;
export const DEFAULT_AVAILABLE_CLOCK_IDS = [0, 1, 2, 3, 4] as const;
/** Malformed fixtures that narrow clocks to [0, 1] in the committed corpus. */
export const NARROW_CLOCK_IDS = [0, 1] as const;
export const FRAME_NARROW_CLOCK_COUNT = 2;
export const FRAME_DEFAULT_CLOCK_COUNT = FRAME_TOTAL - FRAME_NARROW_CLOCK_COUNT; // 56

/** Segment recipe constants from the committed valid manifest. */
export const RECIPE_ID = "frame-app-payload-64mib-recipe";
export const RECIPE_BYTE_LENGTH = 67_108_896;
export const RECIPE_PAYLOAD_LENGTH = 67_108_864;
export const RECIPE_PATTERN_HEX = "a55a";
export const RECIPE_OPCODE = 2;
export const RECIPE_CHANNEL_ID = 13;
export const RECIPE_SEQUENCE = 0;
export const RECIPE_PRIORITY = 2;
export const RECIPE_CLOCK_ID = 0;
export const RECIPE_SHA256 =
  "2c62aac0b2979ca2cb898e05222295c0758acf6473cbaeebd9da04c859978bd5";

export const PLANE_BOOTSTRAP = "bootstrap";
export const PLANE_SELECTED_FRAME = "selected_frame";
export const ORACLE_BOOTSTRAP_COUNT = MALFORMED_BOOTSTRAP;
export const ORACLE_SELECTED_FRAME_COUNT = MALFORMED_FRAME;

/**
 * Generated-source size ceiling (bytes, UTF-8).
 *
 * Reasoned value: 256 KiB. Compact raw-hex + repeat chunks compress the ~1 MiB
 * on-disk binary corpus (including the 1 MiB control payload) into a few
 * kilobytes of chunk text. MoonBit struct/metadata overhead for 75 entries
 * fits well under 64 KiB today. 256 KiB leaves headroom for modest corpus
 * growth and keeps the committed source well below a naive full-payload hex dump.
 */
export const GENERATED_SOURCE_MAX_BYTES = 256 * 1024;

export const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const BINARY_MAX_BYTES = 2 * 1024 * 1024;

/** Safe fixture id pattern (valid and malformed committed corpora). */
export const FIXTURE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
/** Oracle name/reason/plane tokens. */
export const ORACLE_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const HEX_PATTERN = /^[0-9a-f]+$/;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ByteChunk =
  | { kind: "raw"; hex: string }
  | { kind: "rep"; hex: string; count: number };

export type FrameDecoderContext = {
  selectedVersion: number;
  experimentalOpcodesEnabled: boolean;
  availableClockIds: number[];
};

export type MalformedOracle = {
  code: number;
  name: string;
  reason: string;
  offset: number;
  plane: string;
  step: number;
};

export type RecipeDescriptor = {
  patternHex: string;
  length: number;
  opcode: number;
  channelId: number;
  sequence: number;
  priority: number;
  clockId: number;
};

export type BridgeFixture = {
  id: string;
  kind: "bootstrap" | "frame";
  corpus: "valid" | "malformed";
  representation: "binary" | "segment_recipe";
  byteLength: number;
  sourceSha256: string;
  /** FNV-1a 64-bit of expanded bytes (binary) or recipe descriptor bytes. */
  fingerprintHex: string;
  chunks: ByteChunk[] | null;
  recipe: RecipeDescriptor | null;
  oracle: MalformedOracle | null;
  decoderContext: FrameDecoderContext | null;
};

export type BridgeModel = {
  fixtures: BridgeFixture[];
  sourceText: string;
};

type ManifestFixture = {
  id: string;
  kind: string;
  path: string | null;
  representation: string;
  byte_length: number;
  sha256: string;
  payload_length?: number;
  source?: unknown;
  decoder_context?: Record<string, unknown>;
  expected?: Record<string, unknown>;
};

type Manifest = {
  schema_version: number;
  protocol: string;
  fixtures: ManifestFixture[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function repoRootFrom(importMetaDir: string): string {
  return path.resolve(importMetaDir, "..");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd hex length ${hex.length}`);
  if (hex.length === 0) return new Uint8Array(0);
  if (!HEX_PATTERN.test(hex)) throw new Error("hex must be lowercase [0-9a-f]");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** FNV-1a 64-bit, lowercase 16-char hex (matches MoonBit white-box helper). */
export function fingerprintHex(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function parseCliMode(argv: string[]): "write" | "check" | null {
  if (argv.length !== 1) return null;
  if (argv[0] === "--write") return "write";
  if (argv[0] === "--check") return "check";
  return null;
}

function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isSafeIntegerNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Emit a MoonBit string literal. Values matching the allowlist are quoted as-is;
 * every other value is escaped with a tested helper.
 */
export function moonStringLiteral(value: string): string {
  if (
    FIXTURE_ID_PATTERN.test(value) ||
    ORACLE_TOKEN_PATTERN.test(value) ||
    SHA256_PATTERN.test(value) ||
    HEX_PATTERN.test(value) ||
    value === "valid" ||
    value === "malformed" ||
    value === "bootstrap" ||
    value === "frame" ||
    value === "binary" ||
    value === "segment_recipe"
  ) {
    return `"${value}"`;
  }
  return `"${escapeMoonString(value)}"`;
}

/** Escape backslash, quote, and non-printable bytes for MoonBit string content. */
export function escapeMoonString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u{${code.toString(16)}}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function patternEquals(
  data: Uint8Array,
  offset: number,
  plen: number,
  countIndex: number,
): boolean {
  const base = offset;
  const other = offset + plen * countIndex;
  for (let k = 0; k < plen; k++) {
    if (data[base + k] !== data[other + k]) return false;
  }
  return true;
}

/**
 * Deterministic compact encoding: raw-hex pieces plus maximal repeat chunks.
 * Pattern length 1..16; at each index prefer the coverage that ends farthest,
 * then smaller pattern length.
 */
export function compactBytes(data: Uint8Array): ByteChunk[] {
  const chunks: ByteChunk[] = [];
  let i = 0;
  const n = data.length;
  while (i < n) {
    let best: { end: number; plen: number; count: number } | null = null;
    for (let plen = 1; plen <= 16; plen++) {
      if (i + plen * 2 > n) break;
      let count = 1;
      while (i + plen * (count + 1) <= n && patternEquals(data, i, plen, count)) {
        count++;
      }
      if (count >= 2) {
        const end = i + plen * count;
        if (
          best === null ||
          end > best.end ||
          (end === best.end && plen < best.plen)
        ) {
          best = { end, plen, count };
        }
      }
    }
    if (best !== null) {
      chunks.push({
        kind: "rep",
        hex: toHex(data.subarray(i, i + best.plen)),
        count: best.count,
      });
      i = best.end;
      continue;
    }
    let j = i + 1;
    while (j < n) {
      let found = false;
      for (let plen = 1; plen <= 16; plen++) {
        if (j + plen * 2 > n) break;
        if (patternEquals(data, j, plen, 1)) {
          found = true;
          break;
        }
      }
      if (found) break;
      j++;
    }
    const raw = data.subarray(i, j);
    for (let off = 0; off < raw.length; off += 64) {
      chunks.push({
        kind: "raw",
        hex: toHex(raw.subarray(off, Math.min(off + 64, raw.length))),
      });
    }
    i = j;
  }
  return chunks;
}

export function expandChunks(chunks: ByteChunk[]): Uint8Array {
  const parts: number[] = [];
  for (const c of chunks) {
    if (c.kind === "raw") {
      parts.push(...fromHex(c.hex));
    } else {
      const pat = fromHex(c.hex);
      for (let n = 0; n < c.count; n++) parts.push(...pat);
    }
  }
  return new Uint8Array(parts);
}

/** Parser-contract default decoder context. */
export function defaultDecoderContext(): FrameDecoderContext {
  return {
    selectedVersion: DEFAULT_SELECTED_VERSION,
    experimentalOpcodesEnabled: DEFAULT_EXPERIMENTAL_OPCODES_ENABLED,
    availableClockIds: [...DEFAULT_AVAILABLE_CLOCK_IDS],
  };
}

export function parseDecoderContext(
  raw: Record<string, unknown> | undefined,
): FrameDecoderContext {
  const base = defaultDecoderContext();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  if (Object.prototype.hasOwnProperty.call(raw, "selectedVersion")) {
    if (
      typeof raw.selectedVersion !== "number" ||
      !Number.isInteger(raw.selectedVersion) ||
      raw.selectedVersion < 0 ||
      raw.selectedVersion > 255
    ) {
      throw new Error("selectedVersion must be integer 0..255");
    }
    base.selectedVersion = raw.selectedVersion;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "experimentalOpcodesEnabled")) {
    if (typeof raw.experimentalOpcodesEnabled !== "boolean") {
      throw new Error("experimentalOpcodesEnabled must be boolean");
    }
    base.experimentalOpcodesEnabled = raw.experimentalOpcodesEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "availableClockIds")) {
    if (!Array.isArray(raw.availableClockIds)) {
      throw new Error("availableClockIds must be array");
    }
    if (raw.availableClockIds.length > 5) {
      throw new Error("availableClockIds max length 5");
    }
    const ids: number[] = [];
    for (const x of raw.availableClockIds) {
      if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 4) {
        throw new Error("availableClockIds entries must be integers 0..4");
      }
      ids.push(x);
    }
    for (let i = 1; i < ids.length; i++) {
      if (ids[i]! <= ids[i - 1]!) {
        throw new Error("availableClockIds must be strictly ascending");
      }
    }
    base.availableClockIds = ids;
  }
  return base;
}

export function clocksKey(ids: readonly number[]): string {
  return ids.join(",");
}

export function assertDecoderDistribution(fixtures: BridgeFixture[]): void {
  const frames = fixtures.filter((f) => f.kind === "frame");
  if (frames.length !== FRAME_TOTAL) {
    throw new Error(`frame total ${frames.length} != ${FRAME_TOTAL}`);
  }
  let narrow = 0;
  let defaults = 0;
  for (const f of frames) {
    const ctx = f.decoderContext;
    if (!ctx) throw new Error(`${f.id}: missing decoder context`);
    if (ctx.selectedVersion !== DEFAULT_SELECTED_VERSION) {
      throw new Error(`${f.id}: selectedVersion ${ctx.selectedVersion}`);
    }
    if (ctx.experimentalOpcodesEnabled !== DEFAULT_EXPERIMENTAL_OPCODES_ENABLED) {
      throw new Error(`${f.id}: experimentalOpcodesEnabled`);
    }
    const key = clocksKey(ctx.availableClockIds);
    if (key === clocksKey(NARROW_CLOCK_IDS)) {
      if (f.corpus !== "malformed") {
        throw new Error(`${f.id}: narrow clocks only on malformed frames`);
      }
      narrow++;
    } else if (key === clocksKey(DEFAULT_AVAILABLE_CLOCK_IDS)) {
      defaults++;
    } else {
      throw new Error(`${f.id}: unexpected availableClockIds [${key}]`);
    }
  }
  if (narrow !== FRAME_NARROW_CLOCK_COUNT) {
    throw new Error(`narrow clock frames ${narrow} != ${FRAME_NARROW_CLOCK_COUNT}`);
  }
  if (defaults !== FRAME_DEFAULT_CLOCK_COUNT) {
    throw new Error(`default clock frames ${defaults} != ${FRAME_DEFAULT_CLOCK_COUNT}`);
  }
}

function recipeFingerprint(recipe: RecipeDescriptor): string {
  const text = [
    recipe.patternHex,
    String(recipe.length),
    String(recipe.opcode),
    String(recipe.channelId),
    String(recipe.sequence),
    String(recipe.priority),
    String(recipe.clockId),
  ].join("|");
  return fingerprintHex(new TextEncoder().encode(text));
}

function parseRecipe(entry: ManifestFixture): RecipeDescriptor {
  if (entry.id !== RECIPE_ID) {
    throw new Error(`unexpected segment_recipe id ${entry.id}`);
  }
  if (entry.byte_length !== RECIPE_BYTE_LENGTH) {
    throw new Error(`recipe byte_length mismatch for ${entry.id}`);
  }
  if (entry.payload_length !== RECIPE_PAYLOAD_LENGTH) {
    throw new Error(`recipe payload_length mismatch for ${entry.id}`);
  }
  if (entry.sha256 !== RECIPE_SHA256) {
    throw new Error(`recipe sha256 mismatch for ${entry.id}`);
  }
  const source = entry.source as Record<string, unknown>;
  if (!source || source.$type !== "frame") {
    throw new Error(`recipe source must be frame for ${entry.id}`);
  }
  const payload = source.payload as Record<string, unknown>;
  if (!payload || payload.$type !== "recipe" || payload.kind !== "pattern_fill") {
    throw new Error(`recipe payload missing pattern_fill for ${entry.id}`);
  }
  const patternHex = payload.pattern_hex;
  const length = payload.length;
  if (typeof patternHex !== "string" || !HEX_PATTERN.test(patternHex) || patternHex.length % 2) {
    throw new Error(`invalid pattern_hex for ${entry.id}`);
  }
  if (patternHex !== RECIPE_PATTERN_HEX) {
    throw new Error(`recipe pattern_hex mismatch for ${entry.id}`);
  }
  if (typeof length !== "number" || length !== RECIPE_PAYLOAD_LENGTH) {
    throw new Error(`invalid recipe length for ${entry.id}`);
  }
  for (const key of ["opcode", "channelId", "sequence", "priority", "clockId"] as const) {
    if (typeof source[key] !== "number" || !Number.isInteger(source[key])) {
      throw new Error(`recipe field ${key} missing for ${entry.id}`);
    }
  }
  const recipe: RecipeDescriptor = {
    patternHex,
    length,
    opcode: source.opcode as number,
    channelId: source.channelId as number,
    sequence: source.sequence as number,
    priority: source.priority as number,
    clockId: source.clockId as number,
  };
  if (
    recipe.opcode !== RECIPE_OPCODE ||
    recipe.channelId !== RECIPE_CHANNEL_ID ||
    recipe.sequence !== RECIPE_SEQUENCE ||
    recipe.priority !== RECIPE_PRIORITY ||
    recipe.clockId !== RECIPE_CLOCK_ID
  ) {
    throw new Error(`recipe header fields mismatch for ${entry.id}`);
  }
  return recipe;
}

function parseOracle(entry: ManifestFixture): MalformedOracle {
  const e = entry.expected;
  if (!e) throw new Error(`malformed entry ${entry.id} missing expected`);
  const code = e.registry_code;
  const name = e.registry_name;
  const reason = e.reason;
  const offset = e.offset;
  const plane = e.plane;
  const step = e.step;
  if (typeof code !== "number" || !Number.isSafeInteger(code) || code < 1) {
    throw new Error(`${entry.id}: registry_code must be positive safe integer`);
  }
  if (typeof name !== "string" || !ORACLE_TOKEN_PATTERN.test(name)) {
    throw new Error(`${entry.id}: registry_name token`);
  }
  if (typeof reason !== "string" || !ORACLE_TOKEN_PATTERN.test(reason)) {
    throw new Error(`${entry.id}: reason token`);
  }
  if (plane !== PLANE_BOOTSTRAP && plane !== PLANE_SELECTED_FRAME) {
    throw new Error(`${entry.id}: plane must be bootstrap|selected_frame`);
  }
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`${entry.id}: offset`);
  }
  if (typeof step !== "number" || !Number.isSafeInteger(step)) {
    throw new Error(`${entry.id}: step`);
  }
  if (plane === PLANE_BOOTSTRAP) {
    if (step < 1 || step > 9) throw new Error(`${entry.id}: bootstrap step 1..9`);
  } else if (step < 1 || step > 16) {
    throw new Error(`${entry.id}: selected_frame step 1..16`);
  }
  return { code, name, reason, offset, plane, step };
}

// ---------------------------------------------------------------------------
// Bounded path I/O
// ---------------------------------------------------------------------------

export function resolveUnderTestdata(root: string, relPath: string): string {
  if (
    !relPath ||
    relPath.includes("\0") ||
    path.isAbsolute(relPath) ||
    relPath.includes("\\") ||
    relPath.split("/").some((p) => p === "" || p === "." || p === "..")
  ) {
    throw new Error(`fixture path escapes protocol/testdata: ${relPath}`);
  }
  if (!(relPath.startsWith("valid/") || relPath.startsWith("malformed/"))) {
    throw new Error(`fixture path escapes protocol/testdata: ${relPath}`);
  }
  const testdataRoot = path.resolve(root, TESTDATA_REL);
  const resolved = path.resolve(testdataRoot, relPath);
  const prefix = testdataRoot.endsWith(path.sep) ? testdataRoot : testdataRoot + path.sep;
  if (!resolved.startsWith(prefix)) {
    throw new Error(`fixture path escapes protocol/testdata: ${relPath}`);
  }
  return resolved;
}

export function resolveUnderRoot(root: string, rel: string): string {
  if (!rel || rel.includes("\0") || path.isAbsolute(rel) || rel.includes("\\")) {
    throw new Error(`path escapes root: ${rel}`);
  }
  if (rel.split(/[/\\]/).some((p) => p === ".." || p === "")) {
    throw new Error(`path escapes root: ${rel}`);
  }
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, rel);
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (resolved !== rootAbs && !resolved.startsWith(prefix)) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return resolved;
}

export async function lstatRegularFile(
  absPath: string,
  maxBytes: number,
): Promise<{ size: number }> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(absPath);
  } catch (e) {
    throw new Error(
      `missing regular file ${absPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (st.isSymbolicLink()) throw new Error(`symlink file rejected: ${absPath}`);
  if (!st.isFile()) throw new Error(`not a regular file: ${absPath}`);
  if (st.size > maxBytes) {
    throw new Error(`file size ${st.size} exceeds max ${maxBytes}: ${absPath}`);
  }
  return { size: st.size };
}

export async function readBoundedText(absPath: string, maxBytes: number): Promise<string> {
  await lstatRegularFile(absPath, maxBytes);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fh = await open(absPath, flags);
  try {
    const st2 = await fh.stat();
    if (!st2.isFile() || st2.size > maxBytes) {
      throw new Error(`opened handle invalid: ${absPath}`);
    }
    const buf = await fh.readFile();
    if (buf.byteLength > maxBytes) {
      throw new Error(`read size exceeds max ${maxBytes}: ${absPath}`);
    }
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

export async function readBoundedBytes(absPath: string, maxBytes: number): Promise<Uint8Array> {
  await lstatRegularFile(absPath, maxBytes);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fh = await open(absPath, flags);
  try {
    const st2 = await fh.stat();
    if (!st2.isFile() || st2.size > maxBytes) {
      throw new Error(`opened handle invalid: ${absPath}`);
    }
    const buf = await fh.readFile();
    if (buf.byteLength > maxBytes) {
      throw new Error(`read size exceeds max ${maxBytes}: ${absPath}`);
    }
    return new Uint8Array(buf);
  } finally {
    await fh.close();
  }
}

export async function writeBoundedText(absPath: string, text: string, maxBytes: number): Promise<void> {
  const size = Buffer.byteLength(text, "utf8");
  if (size > maxBytes) throw new Error(`write size ${size} exceeds max ${maxBytes}`);
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) throw new Error(`refusing to write symlink ${absPath}`);
    if (!st.isFile()) throw new Error(`refusing to write non-regular ${absPath}`);
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
    await fh.writeFile(text, "utf8");
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

export function validateManifestShape(m: unknown, label: string): Manifest {
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    throw new Error(`${label}: root must be object`);
  }
  const root = m as Record<string, unknown>;
  if (root.schema_version !== SCHEMA_VERSION) {
    throw new Error(`${label}: schema_version must be ${SCHEMA_VERSION}`);
  }
  if (root.protocol !== PROTOCOL_ID) {
    throw new Error(`${label}: protocol must be ${PROTOCOL_ID}`);
  }
  if (!Array.isArray(root.fixtures)) {
    throw new Error(`${label}: fixtures must be array`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    fixtures: root.fixtures as ManifestFixture[],
  };
}

export function validateManifestEntry(
  entry: unknown,
  corpus: "valid" | "malformed",
  label: string,
): ManifestFixture {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label}: entry must be object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || !FIXTURE_ID_PATTERN.test(e.id)) {
    throw new Error(`${label}: invalid id`);
  }
  if (e.kind !== "bootstrap" && e.kind !== "frame") {
    throw new Error(`${label}: kind must be bootstrap|frame`);
  }
  if (e.representation !== "binary" && e.representation !== "segment_recipe") {
    throw new Error(`${label}: representation must be binary|segment_recipe`);
  }
  if (!isSafeIntegerNonNeg(e.byte_length)) {
    throw new Error(`${label}: byte_length must be non-negative safe integer`);
  }
  if (typeof e.sha256 !== "string" || !SHA256_PATTERN.test(e.sha256)) {
    throw new Error(`${label}: sha256 must be 64 lowercase hex chars`);
  }
  if (e.representation === "binary") {
    if (typeof e.path !== "string") throw new Error(`${label}: binary requires path`);
    // Path confinement checked at load time.
  } else {
    if (e.path !== null) throw new Error(`${label}: segment_recipe path must be null`);
    if (corpus !== "valid") throw new Error(`${label}: segment_recipe only on valid corpus`);
  }
  if (corpus === "malformed") {
    if (!e.expected || typeof e.expected !== "object") {
      throw new Error(`${label}: malformed requires expected oracle`);
    }
  }
  return e as ManifestFixture;
}

async function readManifest(root: string, rel: string): Promise<Manifest> {
  const abs = resolveUnderRoot(root, rel);
  const text = await readBoundedText(abs, MANIFEST_MAX_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${rel}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateManifestShape(parsed, rel);
}

async function loadBinary(
  root: string,
  relPath: string,
  expectedLen: number,
  expectedSha: string,
): Promise<Uint8Array> {
  const resolved = resolveUnderTestdata(root, relPath);
  // Enforce size ceiling before allocation via lstat.
  const meta = await lstatRegularFile(resolved, BINARY_MAX_BYTES);
  if (meta.size !== expectedLen) {
    throw new Error(`${relPath}: length ${meta.size} != manifest ${expectedLen}`);
  }
  const bytes = await readBoundedBytes(resolved, BINARY_MAX_BYTES);
  if (bytes.length !== expectedLen) {
    throw new Error(`${relPath}: length ${bytes.length} != manifest ${expectedLen}`);
  }
  const hash = sha256Hex(bytes);
  if (hash !== expectedSha) {
    throw new Error(`${relPath}: sha256 ${hash} != manifest ${expectedSha}`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildBridge(root: string): Promise<BridgeModel> {
  const validMan = await readManifest(root, VALID_MANIFEST_REL);
  const malMan = await readManifest(root, MALFORMED_MANIFEST_REL);

  if (validMan.fixtures.length !== VALID_TOTAL) {
    throw new Error(`valid fixtures ${validMan.fixtures.length} != ${VALID_TOTAL}`);
  }
  if (malMan.fixtures.length !== MALFORMED_TOTAL) {
    throw new Error(`malformed fixtures ${malMan.fixtures.length} != ${MALFORMED_TOTAL}`);
  }

  const fixtures: BridgeFixture[] = [];

  for (let i = 0; i < validMan.fixtures.length; i++) {
    const raw = validateManifestEntry(validMan.fixtures[i], "valid", `valid[${i}]`);
    fixtures.push(await materializeEntry(root, raw, "valid"));
  }
  for (let i = 0; i < malMan.fixtures.length; i++) {
    const raw = validateManifestEntry(malMan.fixtures[i], "malformed", `malformed[${i}]`);
    fixtures.push(await materializeEntry(root, raw, "malformed"));
  }

  assertCounts(fixtures);
  assertDecoderDistribution(fixtures);
  assertOraclePlanes(fixtures);

  const sourceText = renderMoonBitSource(fixtures);
  const size = Buffer.byteLength(sourceText, "utf8");
  if (size > GENERATED_SOURCE_MAX_BYTES) {
    throw new Error(
      `generated source ${size} bytes exceeds ceiling ${GENERATED_SOURCE_MAX_BYTES}`,
    );
  }

  return { fixtures, sourceText };
}

async function materializeEntry(
  root: string,
  entry: ManifestFixture,
  corpus: "valid" | "malformed",
): Promise<BridgeFixture> {
  if (entry.kind !== "bootstrap" && entry.kind !== "frame") {
    throw new Error(`${entry.id}: unknown kind ${entry.kind}`);
  }
  if (entry.representation === "segment_recipe") {
    if (corpus !== "valid") throw new Error(`${entry.id}: recipe only on valid corpus`);
    const recipe = parseRecipe(entry);
    return {
      id: entry.id,
      kind: "frame",
      corpus,
      representation: "segment_recipe",
      byteLength: entry.byte_length,
      sourceSha256: entry.sha256,
      fingerprintHex: recipeFingerprint(recipe),
      chunks: null,
      recipe,
      oracle: null,
      decoderContext: parseDecoderContext(entry.decoder_context),
    };
  }
  if (entry.representation !== "binary") {
    throw new Error(`${entry.id}: representation ${entry.representation}`);
  }
  if (typeof entry.path !== "string") {
    throw new Error(`${entry.id}: binary requires path`);
  }
  const bytes = await loadBinary(root, entry.path, entry.byte_length, entry.sha256);
  const chunks = compactBytes(bytes);
  const expanded = expandChunks(chunks);
  if (expanded.length !== bytes.length || sha256Hex(expanded) !== entry.sha256) {
    throw new Error(`${entry.id}: compact roundtrip failed`);
  }
  return {
    id: entry.id,
    kind: entry.kind,
    corpus,
    representation: "binary",
    byteLength: entry.byte_length,
    sourceSha256: entry.sha256,
    fingerprintHex: fingerprintHex(bytes),
    chunks,
    recipe: null,
    oracle: corpus === "malformed" ? parseOracle(entry) : null,
    decoderContext:
      entry.kind === "frame" ? parseDecoderContext(entry.decoder_context) : null,
  };
}

function assertCounts(fixtures: BridgeFixture[]): void {
  const valid = fixtures.filter((f) => f.corpus === "valid");
  const mal = fixtures.filter((f) => f.corpus === "malformed");
  if (valid.length !== VALID_TOTAL) throw new Error(`valid count ${valid.length}`);
  if (mal.length !== MALFORMED_TOTAL) throw new Error(`malformed count ${mal.length}`);

  const vb = valid.filter((f) => f.kind === "bootstrap" && f.representation === "binary");
  const vf = valid.filter((f) => f.kind === "frame" && f.representation === "binary");
  const vr = valid.filter((f) => f.representation === "segment_recipe");
  const mb = mal.filter((f) => f.kind === "bootstrap");
  const mf = mal.filter((f) => f.kind === "frame");
  if (vb.length !== VALID_BOOTSTRAP) throw new Error(`valid bootstrap ${vb.length}`);
  if (vf.length !== VALID_FRAME_BINARY) throw new Error(`valid frame binary ${vf.length}`);
  if (vr.length !== VALID_SEGMENT_RECIPE) throw new Error(`segment recipe ${vr.length}`);
  if (mb.length !== MALFORMED_BOOTSTRAP) throw new Error(`mal bootstrap ${mb.length}`);
  if (mf.length !== MALFORMED_FRAME) throw new Error(`mal frame ${mf.length}`);

  const ids = fixtures.map((f) => f.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate fixture ids");
  const validIds = valid.map((f) => f.id);
  const malIds = mal.map((f) => f.id);
  for (let i = 1; i < validIds.length; i++) {
    if (asciiCompare(validIds[i - 1]!, validIds[i]!) > 0) {
      throw new Error("valid ids out of order");
    }
  }
  for (let i = 1; i < malIds.length; i++) {
    if (asciiCompare(malIds[i - 1]!, malIds[i]!) > 0) {
      throw new Error("malformed ids out of order");
    }
  }
}

function assertOraclePlanes(fixtures: BridgeFixture[]): void {
  let bootstrap = 0;
  let selected = 0;
  for (const f of fixtures) {
    if (f.corpus !== "malformed") continue;
    if (!f.oracle) throw new Error(`${f.id}: missing oracle`);
    if (f.oracle.plane === PLANE_BOOTSTRAP) bootstrap++;
    else if (f.oracle.plane === PLANE_SELECTED_FRAME) selected++;
    else throw new Error(`${f.id}: unexpected plane ${f.oracle.plane}`);
  }
  if (bootstrap !== ORACLE_BOOTSTRAP_COUNT) {
    throw new Error(`bootstrap plane count ${bootstrap}`);
  }
  if (selected !== ORACLE_SELECTED_FRAME_COUNT) {
    throw new Error(`selected_frame plane count ${selected}`);
  }
}

// ---------------------------------------------------------------------------
// MoonBit source rendering
// ---------------------------------------------------------------------------

function renderMoonBitSource(fixtures: BridgeFixture[]): string {
  const lines: string[] = [];
  lines.push(`// Generated by ${GENERATED_BY}.`);
  lines.push("// Regenerate with bun run protocol-moonbit-fixtures:write.");
  lines.push(`// protocol: ${PROTOCOL_ID}`);
  lines.push(`// sources: ${VALID_MANIFEST_REL}, ${MALFORMED_MANIFEST_REL}`);
  lines.push("//");
  lines.push("// White-box fixture bridge for M0-03g1: reconstructs committed R2WP");
  lines.push("// valid/boundary and malformed binaries from compact raw-hex + repeat");
  lines.push("// chunks, validates length and FNV-1a fingerprint, and keeps the 64 MiB");
  lines.push("// segment recipe as a descriptor with metadata-only validation.");
  lines.push("");
  lines.push("///|");
  lines.push("priv enum ByteChunk {");
  lines.push("  Raw(String)");
  lines.push("  Rep(String, Int)");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct FrameDecoderContext {");
  lines.push("  selected_version : Int");
  lines.push("  experimental_opcodes_enabled : Bool");
  lines.push("  available_clock_ids : Array[Int]");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct MalformedOracle {");
  lines.push("  code : Int");
  lines.push("  name : String");
  lines.push("  reason : String");
  lines.push("  offset : Int");
  lines.push("  plane : String");
  lines.push("  step : Int");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct RecipeDescriptor {");
  lines.push("  pattern_hex : String");
  lines.push("  length : Int");
  lines.push("  opcode : Int");
  lines.push("  channel_id : Int");
  lines.push("  sequence : Int");
  lines.push("  priority : Int");
  lines.push("  clock_id : Int");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv enum FixtureBody {");
  lines.push("  Binary(Array[ByteChunk])");
  lines.push("  SegmentRecipe(RecipeDescriptor)");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct BridgeFixture {");
  lines.push("  id : String");
  lines.push("  kind : String");
  lines.push("  corpus : String");
  lines.push("  representation : String");
  lines.push("  byte_length : Int");
  lines.push("  source_sha256 : String");
  lines.push("  fingerprint_hex : String");
  lines.push("  body : FixtureBody");
  lines.push("  oracle : MalformedOracle?");
  lines.push("  decoder_context : FrameDecoderContext?");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn hex_nibble(code : Int) -> Int {");
  lines.push("  if code >= 48 && code <= 57 {");
  lines.push("    code - 48");
  lines.push("  } else if code >= 97 && code <= 102 {");
  lines.push("    code - 97 + 10");
  lines.push("  } else {");
  lines.push('    abort("bad hex nibble")');
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn decode_hex(hex : String) -> Array[Byte] {");
  lines.push("  let n = hex.length()");
  lines.push("  if n % 2 != 0 {");
  lines.push('    abort("odd hex length")');
  lines.push("  }");
  lines.push("  let out : Array[Byte] = []");
  lines.push("  let mut i = 0");
  lines.push("  while i < n {");
  lines.push("    let hi = hex_nibble(hex[i].to_int())");
  lines.push("    let lo = hex_nibble(hex[i + 1].to_int())");
  lines.push("    out.push(((hi << 4) | lo).to_byte())");
  lines.push("    i = i + 2");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn expand_chunks(chunks : Array[ByteChunk]) -> Array[Byte] {");
  lines.push("  let out : Array[Byte] = []");
  lines.push("  for chunk in chunks {");
  lines.push("    match chunk {");
  lines.push("      Raw(h) => {");
  lines.push("        let b = decode_hex(h)");
  lines.push("        for x in b {");
  lines.push("          out.push(x)");
  lines.push("        }");
  lines.push("      }");
  lines.push("      Rep(h, count) => {");
  lines.push("        let pat = decode_hex(h)");
  lines.push("        let mut c = 0");
  lines.push("        while c < count {");
  lines.push("          for x in pat {");
  lines.push("            out.push(x)");
  lines.push("          }");
  lines.push("          c = c + 1");
  lines.push("        }");
  lines.push("      }");
  lines.push("    }");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn fingerprint_u64(bytes : Array[Byte]) -> UInt64 {");
  lines.push("  let mut hash : UInt64 = 0xcbf29ce484222325UL");
  lines.push("  let prime : UInt64 = 0x100000001b3UL");
  lines.push("  for b in bytes {");
  lines.push("    hash = (hash ^ b.to_uint64()) * prime");
  lines.push("  }");
  lines.push("  hash");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn nibble_char(n : Int) -> Char {");
  lines.push("  if n < 10 {");
  lines.push("    (48 + n).unsafe_to_char()");
  lines.push("  } else {");
  lines.push("    (87 + n).unsafe_to_char()");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn u64_to_hex16(v : UInt64) -> String {");
  lines.push('  let mut out = ""');
  lines.push("  let mut i = 0");
  lines.push("  while i < 16 {");
  lines.push("    let shift = (15 - i) * 4");
  lines.push("    let nib = ((v >> shift) & 0xfUL).to_int()");
  lines.push("    out = out + nibble_char(nib).to_string()");
  lines.push("    i = i + 1");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn fingerprint_hex(bytes : Array[Byte]) -> String {");
  lines.push("  u64_to_hex16(fingerprint_u64(bytes))");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn recipe_fingerprint(recipe : RecipeDescriptor) -> String {");
  lines.push("  // Same field join as the Bun generator (UTF-8 of the joined text).");
  lines.push("  let text = recipe.pattern_hex +");
  lines.push('    "|" +');
  lines.push("    recipe.length.to_string() +");
  lines.push('    "|" +');
  lines.push("    recipe.opcode.to_string() +");
  lines.push('    "|" +');
  lines.push("    recipe.channel_id.to_string() +");
  lines.push('    "|" +');
  lines.push("    recipe.sequence.to_string() +");
  lines.push('    "|" +');
  lines.push("    recipe.priority.to_string() +");
  lines.push('    "|" +');
  lines.push("    recipe.clock_id.to_string()");
  lines.push("  let bytes : Array[Byte] = []");
  lines.push("  let mut i = 0");
  lines.push("  while i < text.length() {");
  lines.push("    // ASCII-only join text.");
  lines.push("    bytes.push(text[i].to_int().to_byte())");
  lines.push("    i = i + 1");
  lines.push("  }");
  lines.push("  fingerprint_hex(bytes)");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn clocks_key(ids : Array[Int]) -> String {");
  lines.push('  let mut out = ""');
  lines.push("  let mut i = 0");
  lines.push("  while i < ids.length() {");
  lines.push("    if i > 0 {");
  lines.push('      out = out + ","');
  lines.push("    }");
  lines.push("    out = out + ids[i].to_string()");
  lines.push("    i = i + 1");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push(`const VALID_TOTAL = ${VALID_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const VALID_BOOTSTRAP = ${VALID_BOOTSTRAP}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const VALID_FRAME_BINARY = ${VALID_FRAME_BINARY}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const VALID_SEGMENT_RECIPE = ${VALID_SEGMENT_RECIPE}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const MALFORMED_TOTAL = ${MALFORMED_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const MALFORMED_BOOTSTRAP = ${MALFORMED_BOOTSTRAP}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const MALFORMED_FRAME = ${MALFORMED_FRAME}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const MATERIALIZED_BINARY_TOTAL = ${MATERIALIZED_BINARY_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const FRAME_TOTAL = ${FRAME_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const FRAME_NARROW_CLOCK_COUNT = ${FRAME_NARROW_CLOCK_COUNT}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const FRAME_DEFAULT_CLOCK_COUNT = ${FRAME_DEFAULT_CLOCK_COUNT}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const ORACLE_BOOTSTRAP_COUNT = ${ORACLE_BOOTSTRAP_COUNT}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const ORACLE_SELECTED_FRAME_COUNT = ${ORACLE_SELECTED_FRAME_COUNT}`);
  lines.push("");
  lines.push("///|");
  lines.push("let bridge_fixtures : Array[BridgeFixture] = [");
  for (const f of fixtures) {
    lines.push(renderFixture(f));
  }
  lines.push("]");
  lines.push("");
  lines.push("///|");
  lines.push("fn count_where(pred : (BridgeFixture) -> Bool) -> Int {");
  lines.push("  let mut n = 0");
  lines.push("  for f in bridge_fixtures {");
  lines.push("    if pred(f) {");
  lines.push("      n = n + 1");
  lines.push("    }");
  lines.push("  }");
  lines.push("  n");
  lines.push("}");
  lines.push("");
  lines.push('test "bridge totals and splits" {');
  lines.push("  assert_eq(bridge_fixtures.length(), VALID_TOTAL + MALFORMED_TOTAL)");
  lines.push('  assert_eq(count_where(f => f.corpus == "valid"), VALID_TOTAL)');
  lines.push('  assert_eq(count_where(f => f.corpus == "malformed"), MALFORMED_TOTAL)');
  lines.push(
    '  assert_eq(count_where(f => f.corpus == "valid" && f.kind == "bootstrap"), VALID_BOOTSTRAP)',
  );
  lines.push(
    '  assert_eq(count_where(f => f.corpus == "valid" && f.kind == "frame" && f.representation == "binary"), VALID_FRAME_BINARY)',
  );
  lines.push(
    '  assert_eq(count_where(f => f.representation == "segment_recipe"), VALID_SEGMENT_RECIPE)',
  );
  lines.push(
    '  assert_eq(count_where(f => f.corpus == "malformed" && f.kind == "bootstrap"), MALFORMED_BOOTSTRAP)',
  );
  lines.push(
    '  assert_eq(count_where(f => f.corpus == "malformed" && f.kind == "frame"), MALFORMED_FRAME)',
  );
  lines.push(
    '  assert_eq(count_where(f => f.representation == "binary"), MATERIALIZED_BINARY_TOTAL)',
  );
  lines.push("}");
  lines.push("");
  lines.push('test "materialized binaries reconstruct length and fingerprint" {');
  lines.push("  let mut seen = 0");
  lines.push("  for f in bridge_fixtures {");
  lines.push("    match f.body {");
  lines.push("      Binary(chunks) => {");
  lines.push("        let bytes = expand_chunks(chunks)");
  lines.push("        assert_eq(bytes.length(), f.byte_length)");
  lines.push("        assert_eq(fingerprint_hex(bytes), f.fingerprint_hex)");
  lines.push("        assert_eq(f.source_sha256.length(), 64)");
  lines.push("        seen = seen + 1");
  lines.push("      }");
  lines.push("      SegmentRecipe(_) => ()");
  lines.push("    }");
  lines.push("  }");
  lines.push("  assert_eq(seen, MATERIALIZED_BINARY_TOTAL)");
  lines.push("}");
  lines.push("");
  lines.push('test "segment recipe descriptor exact metadata" {');
  lines.push("  let mut found = 0");
  lines.push("  for f in bridge_fixtures {");
  lines.push("    match f.body {");
  lines.push("      SegmentRecipe(recipe) => {");
  lines.push(`        assert_eq(f.id, ${moonStringLiteral(RECIPE_ID)})`);
  lines.push('        assert_eq(f.representation, "segment_recipe")');
  lines.push(`        assert_eq(f.byte_length, ${RECIPE_BYTE_LENGTH})`);
  lines.push(`        assert_eq(recipe.length, ${RECIPE_PAYLOAD_LENGTH})`);
  lines.push(`        assert_eq(recipe.pattern_hex, ${moonStringLiteral(RECIPE_PATTERN_HEX)})`);
  lines.push(`        assert_eq(recipe.opcode, ${RECIPE_OPCODE})`);
  lines.push(`        assert_eq(recipe.channel_id, ${RECIPE_CHANNEL_ID})`);
  lines.push(`        assert_eq(recipe.sequence, ${RECIPE_SEQUENCE})`);
  lines.push(`        assert_eq(recipe.priority, ${RECIPE_PRIORITY})`);
  lines.push(`        assert_eq(recipe.clock_id, ${RECIPE_CLOCK_ID})`);
  lines.push(`        assert_eq(f.source_sha256, ${moonStringLiteral(RECIPE_SHA256)})`);
  lines.push("        assert_eq(recipe_fingerprint(recipe), f.fingerprint_hex)");
  lines.push("        found = found + 1");
  lines.push("      }");
  lines.push("      Binary(_) => ()");
  lines.push("    }");
  lines.push("  }");
  lines.push("  assert_eq(found, VALID_SEGMENT_RECIPE)");
  lines.push("}");
  lines.push("");
  lines.push('test "malformed oracles exact planes codes and steps" {');
  lines.push("  let mut bootstrap_n = 0");
  lines.push("  let mut selected_n = 0");
  lines.push("  for f in bridge_fixtures {");
  lines.push('    if f.corpus == "malformed" {');
  lines.push("      match f.oracle {");
  lines.push("        Some(o) => {");
  lines.push("          assert_eq(o.code >= 1, true)");
  lines.push("          assert_eq(o.name.length() > 0, true)");
  lines.push("          assert_eq(o.reason.length() > 0, true)");
  lines.push("          assert_eq(o.offset >= 0, true)");
  lines.push('          if o.plane == "bootstrap" {');
  lines.push("            assert_eq(o.step >= 1, true)");
  lines.push("            assert_eq(o.step <= 9, true)");
  lines.push("            bootstrap_n = bootstrap_n + 1");
  lines.push('          } else if o.plane == "selected_frame" {');
  lines.push("            assert_eq(o.step >= 1, true)");
  lines.push("            assert_eq(o.step <= 16, true)");
  lines.push("            selected_n = selected_n + 1");
  lines.push("          } else {");
  lines.push('            abort("unexpected oracle plane")');
  lines.push("          }");
  lines.push("        }");
  lines.push('        None => abort("malformed fixture missing oracle")');
  lines.push("      }");
  lines.push("    }");
  lines.push("  }");
  lines.push("  assert_eq(bootstrap_n, ORACLE_BOOTSTRAP_COUNT)");
  lines.push("  assert_eq(selected_n, ORACLE_SELECTED_FRAME_COUNT)");
  lines.push("  assert_eq(bootstrap_n + selected_n, MALFORMED_TOTAL)");
  lines.push("}");
  lines.push("");
  lines.push('test "frame decoder context exact distribution" {');
  lines.push("  let mut frames = 0");
  lines.push("  let mut narrow = 0");
  lines.push("  let mut defaults = 0");
  lines.push("  for f in bridge_fixtures {");
  lines.push('    if f.kind == "frame" {');
  lines.push("      match f.decoder_context {");
  lines.push("        Some(ctx) => {");
  lines.push("          assert_eq(ctx.selected_version, 0)");
  lines.push("          assert_eq(ctx.experimental_opcodes_enabled, false)");
  lines.push("          let key = clocks_key(ctx.available_clock_ids)");
  lines.push('          if key == "0,1" {');
  lines.push("            narrow = narrow + 1");
  lines.push('          } else if key == "0,1,2,3,4" {');
  lines.push("            defaults = defaults + 1");
  lines.push("          } else {");
  lines.push('            abort("unexpected available_clock_ids")');
  lines.push("          }");
  lines.push("          frames = frames + 1");
  lines.push("        }");
  lines.push('        None => abort("frame fixture missing decoder context")');
  lines.push("      }");
  lines.push("    }");
  lines.push("  }");
  lines.push("  assert_eq(frames, FRAME_TOTAL)");
  lines.push("  assert_eq(narrow, FRAME_NARROW_CLOCK_COUNT)");
  lines.push("  assert_eq(defaults, FRAME_DEFAULT_CLOCK_COUNT)");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderFixture(f: BridgeFixture): string {
  const parts: string[] = [];
  parts.push("  {");
  parts.push(`    id: ${moonStringLiteral(f.id)},`);
  parts.push(`    kind: ${moonStringLiteral(f.kind)},`);
  parts.push(`    corpus: ${moonStringLiteral(f.corpus)},`);
  parts.push(`    representation: ${moonStringLiteral(f.representation)},`);
  parts.push(`    byte_length: ${f.byteLength},`);
  parts.push(`    source_sha256: ${moonStringLiteral(f.sourceSha256)},`);
  parts.push(`    fingerprint_hex: ${moonStringLiteral(f.fingerprintHex)},`);
  if (f.representation === "segment_recipe" && f.recipe) {
    const r = f.recipe;
    parts.push("    body: FixtureBody::SegmentRecipe({");
    parts.push(`      pattern_hex: ${moonStringLiteral(r.patternHex)},`);
    parts.push(`      length: ${r.length},`);
    parts.push(`      opcode: ${r.opcode},`);
    parts.push(`      channel_id: ${r.channelId},`);
    parts.push(`      sequence: ${r.sequence},`);
    parts.push(`      priority: ${r.priority},`);
    parts.push(`      clock_id: ${r.clockId},`);
    parts.push("    }),");
  } else if (f.chunks) {
    parts.push("    body: FixtureBody::Binary([");
    for (const c of f.chunks) {
      if (c.kind === "raw") {
        parts.push(`      ByteChunk::Raw(${moonStringLiteral(c.hex)}),`);
      } else {
        parts.push(`      ByteChunk::Rep(${moonStringLiteral(c.hex)}, ${c.count}),`);
      }
    }
    parts.push("    ]),");
  } else {
    throw new Error(`${f.id}: missing body`);
  }
  if (f.oracle) {
    const o = f.oracle;
    parts.push("    oracle: Some({");
    parts.push(`      code: ${o.code},`);
    parts.push(`      name: ${moonStringLiteral(o.name)},`);
    parts.push(`      reason: ${moonStringLiteral(o.reason)},`);
    parts.push(`      offset: ${o.offset},`);
    parts.push(`      plane: ${moonStringLiteral(o.plane)},`);
    parts.push(`      step: ${o.step},`);
    parts.push("    }),");
  } else {
    parts.push("    oracle: None,");
  }
  if (f.decoderContext) {
    const d = f.decoderContext;
    const clocks = d.availableClockIds.map((x) => String(x)).join(", ");
    parts.push("    decoder_context: Some({");
    parts.push(`      selected_version: ${d.selectedVersion},`);
    parts.push(
      `      experimental_opcodes_enabled: ${d.experimentalOpcodesEnabled ? "true" : "false"},`,
    );
    parts.push(`      available_clock_ids: [${clocks}],`);
    parts.push("    }),");
  } else {
    parts.push("    decoder_context: None,");
  }
  parts.push("  },");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

export async function writeBridge(root: string): Promise<{ bytes: number; fixtures: number }> {
  const model = await buildBridge(root);
  const outPath = resolveUnderRoot(root, OUTPUT_REL);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeBoundedText(outPath, model.sourceText, GENERATED_SOURCE_MAX_BYTES);
  return {
    bytes: Buffer.byteLength(model.sourceText, "utf8"),
    fixtures: model.fixtures.length,
  };
}

export async function checkBridge(root: string): Promise<void> {
  const model = await buildBridge(root);
  const outPath = resolveUnderRoot(root, OUTPUT_REL);
  const disk = await readBoundedText(outPath, GENERATED_SOURCE_MAX_BYTES);
  if (disk !== model.sourceText) {
    throw new Error(
      `${OUTPUT_REL}: drift detected (committed bytes differ from regenerated source)`,
    );
  }
  const size = Buffer.byteLength(disk, "utf8");
  if (size > GENERATED_SOURCE_MAX_BYTES) {
    throw new Error(`${OUTPUT_REL}: size ${size} exceeds ceiling ${GENERATED_SOURCE_MAX_BYTES}`);
  }
}

async function main(): Promise<void> {
  const mode = parseCliMode(process.argv.slice(2));
  if (mode === null) {
    console.error("usage: bun run scripts/protocol-moonbit-fixtures.ts --write|--check");
    process.exit(2);
  }
  const root = repoRootFrom(import.meta.dir);
  if (mode === "write") {
    const r = await writeBridge(root);
    console.log(
      JSON.stringify({
        mode: "write",
        output: OUTPUT_REL,
        fixtures: r.fixtures,
        bytes: r.bytes,
        ceiling: GENERATED_SOURCE_MAX_BYTES,
        status: "ok",
      }),
    );
    return;
  }
  await checkBridge(root);
  console.log(
    JSON.stringify({
      mode: "check",
      output: OUTPUT_REL,
      status: "ok",
    }),
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
