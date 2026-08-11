#!/usr/bin/env bun
/**
 * ROS CDR corpus → MoonBit white-box fixture bridge (M1-01d1).
 *
 * Reads the committed ROS CDR corpus (`conformance/cdr/manifest.json` and
 * fixture binaries) plus the independent top-level tail-slack evidence
 * overlay (`conformance/cdr/tail-slack.json`) and emits a deterministic
 * package-internal MoonBit white-box source at
 * `rclmbt/cdr/fixture_data_wbtest.mbt`.
 *
 * --write  regenerate the committed MoonBit source
 * --check  regenerate in memory and byte-compare the committed source
 *
 * Offline and deterministic: every binary length and SHA-256 is verified,
 * the committed tail-slack artifact is checked against a regenerated model,
 * frozen input SHAs are enforced, and fixture identity joins are exact.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  ARTIFACT_REL as TAIL_SLACK_REL,
  CORPUS_ID,
  MANIFEST_REL,
  asciiCompare,
  buildTailSlackModel,
  enforceFrozenSummary,
  loadCorpus,
  resolveTrustedRelativeFile,
  sha256Hex as tailSha256Hex,
  stableJsonPretty,
  type FixtureEvidence,
} from "./cdr-tail-slack.ts";

// ---------------------------------------------------------------------------
// Paths, frozen pins, and corpus totals
// ---------------------------------------------------------------------------

export const MANIFEST_REL_PATH = MANIFEST_REL;
export const TAIL_SLACK_REL_PATH = TAIL_SLACK_REL;
export const OUTPUT_REL = "rclmbt/cdr/fixture_data_wbtest.mbt";
export const GENERATED_BY = "scripts/cdr-moonbit-fixtures.ts";

/** Frozen SHA-256 of committed conformance/cdr/manifest.json. */
export const FROZEN_MANIFEST_SHA256 =
  "319cb1c55da8a236054ba625f3fdbd43e239bd13c74c523d7912618c02b9fa7f";
/** Frozen SHA-256 of committed conformance/cdr/tail-slack.json. */
export const FROZEN_TAIL_SLACK_SHA256 =
  "1531d011f0715e5b82fa675be266d97387db7dd55ed8ff06784b213ae6256984";

/** Exact corpus totals locked to the committed ROS CDR fixtures. */
export const FIXTURE_TOTAL = 56;
export const COMPARISON_TOTAL = 18;
export const FIXTURE_GROUP_TOTAL = 20;
export const EXACT_TAIL_TOTAL = 24;
export const FOUR_BYTE_TAIL_TOTAL = 12;
export const TWELVE_BYTE_TAIL_TOTAL = 20;
export const HUMBLE_TOTAL = 28;
export const JAZZY_TOTAL = 28;
export const LITTLE_ENDIAN_TOTAL = 54;
export const BIG_ENDIAN_TOTAL = 2;
export const MULTI_ROW_GROUP_TOTAL = COMPARISON_TOTAL;
export const SINGLETON_BIG_ENDIAN_TOTAL = 2;
export const TOTAL_BINARY_PAYLOAD_BYTES = 12_356;
export const MAX_FIXTURE_BYTES = 280;

export const ROW_TOTALS = {
  "H-CY": 9,
  "H-FT": 10,
  "H-ZN": 9,
  "J-CY": 9,
  "J-FT": 10,
  "J-ZN": 9,
} as const;

export type SupportRowId = keyof typeof ROW_TOTALS;

/**
 * Generated-source size ceiling (bytes, UTF-8).
 *
 * Reasoned value: 256 KiB. The committed corpus carries 12,356 binary payload
 * bytes (max fixture 280). Raw lowercase hex doubles that to ~25 KiB of hex
 * text; fixture metadata, comparisons, and generated MoonBit tests stay well
 * under 64 KiB today. 256 KiB leaves headroom for modest corpus growth while
 * keeping the committed white-box source a practical review surface.
 */
export const GENERATED_SOURCE_MAX_BYTES = 256 * 1024;

export const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const TAIL_SLACK_MAX_BYTES = 2 * 1024 * 1024;
export const BINARY_MAX_BYTES = 64 * 1024;

export const FIXTURE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const HEX_PATTERN = /^[0-9a-f]+$/;
export const ENDIAN_LITTLE = "little";
export const ENDIAN_BIG = "big";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaIdentity = {
  scheme: string;
  value: string;
};

export type BridgeFixture = {
  id: string;
  caseId: string;
  rosDistro: string;
  supportRowId: string;
  typeName: string;
  serializedEndianness: string;
  serializedSha256: string;
  semanticValueSha256: string;
  schemaIdentity: SchemaIdentity;
  logicalByteLength: number;
  zeroTailBytes: number;
  canonicalFixtureId: string;
  canonicalPrefixSha256: string;
  byteLength: number;
  /** Full raw lowercase hex of the committed binary. */
  hexBytes: string;
  /** Independent FNV-1a 64-bit fingerprint of the binary bytes. */
  fingerprintHex: string;
};

export type BridgeComparison = {
  caseId: string;
  rosDistro: string;
  rows: string[];
  fixtureIds: string[];
};

export type BridgeModel = {
  fixtures: BridgeFixture[];
  comparisons: BridgeComparison[];
  sourceText: string;
  manifestSha256: string;
  tailSlackSha256: string;
};

type ManifestSerialized = {
  path: string;
  byte_length: number;
  sha256: string;
  endianness: string;
};

type ManifestFixtureFull = {
  id: string;
  case_id: string;
  ros_distro: string;
  support_row_id: string;
  type_name: string;
  semantic_value_sha256: string;
  schema_identity: SchemaIdentity;
  serialized: ManifestSerialized;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function repoRootFrom(importMetaDir: string): string {
  return path.resolve(importMetaDir, "..");
}

export function sha256Hex(bytes: Uint8Array | string): string {
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

export function isSafeIntegerNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
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

/**
 * Emit a MoonBit string literal. Safe ASCII identifiers/hex/SHA values are
 * quoted as-is; every other value uses the escaped form.
 */
export function moonStringLiteral(value: string): string {
  if (
    FIXTURE_ID_PATTERN.test(value) ||
    SHA256_PATTERN.test(value) ||
    HEX_PATTERN.test(value) ||
    value === ENDIAN_LITTLE ||
    value === ENDIAN_BIG ||
    value === "humble" ||
    value === "jazzy" ||
    value === "moonspan-schema-v1" ||
    value === "rep2011-rihs"
  ) {
    return `"${value}"`;
  }
  return `"${escapeMoonString(value)}"`;
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

/**
 * Atomic write of generated MoonBit source.
 * Rejects an existing output symlink so the external target stays intact.
 * Writes a same-directory temp regular file, then renames into place.
 */
export async function writeAtomicText(
  absPath: string,
  text: string,
  maxBytes: number,
): Promise<void> {
  const size = Buffer.byteLength(text, "utf8");
  if (size > maxBytes) {
    throw new Error(`write size ${size} exceeds max ${maxBytes}`);
  }
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write symlink ${absPath}`);
    }
    if (!st.isFile()) {
      throw new Error(`refusing to write non-regular ${absPath}`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code !== "ENOENT") throw e;
  }

  const dir = path.dirname(absPath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.cdr-moonbit-fixtures.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(tmp, flags, 0o644);
    try {
      await fh.writeFile(text, "utf8");
    } finally {
      await fh.close();
    }
    await rename(tmp, absPath);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // temp already gone
    }
    throw err;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: expected nonempty string`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label}: expected lowercase 64-hex SHA-256`);
  }
  return value;
}

function parseSchemaIdentity(raw: unknown, label: string): SchemaIdentity {
  if (!isPlainObject(raw)) {
    throw new Error(`${label}: schema_identity must be an object`);
  }
  const scheme = requireNonemptyString(raw.scheme, `${label}.scheme`);
  const value = requireNonemptyString(raw.value, `${label}.value`);
  return { scheme, value };
}

function parseManifestFixtureFull(raw: unknown, label: string): ManifestFixtureFull {
  if (!isPlainObject(raw)) {
    throw new Error(`${label}: fixture must be an object`);
  }
  const id = requireNonemptyString(raw.id, `${label}.id`);
  if (!FIXTURE_ID_PATTERN.test(id)) {
    throw new Error(`${label}: invalid fixture id ${id}`);
  }
  const case_id = requireNonemptyString(raw.case_id, `${label}.case_id`);
  const ros_distro = requireNonemptyString(raw.ros_distro, `${label}.ros_distro`);
  const support_row_id = requireNonemptyString(
    raw.support_row_id,
    `${label}.support_row_id`,
  );
  if (!(support_row_id in ROW_TOTALS)) {
    throw new Error(`${label}: unexpected support_row_id ${support_row_id}`);
  }
  const type_name = requireNonemptyString(raw.type_name, `${label}.type_name`);
  const semantic_value_sha256 = requireSha256(
    raw.semantic_value_sha256,
    `${label}.semantic_value_sha256`,
  );
  const schema_identity = parseSchemaIdentity(
    raw.schema_identity,
    `${label}.schema_identity`,
  );
  if (!isPlainObject(raw.serialized)) {
    throw new Error(`${label}: serialized must be an object`);
  }
  const serialized = raw.serialized;
  const serPath = requireNonemptyString(serialized.path, `${label}.serialized.path`);
  if (!isSafeIntegerNonNeg(serialized.byte_length)) {
    throw new Error(`${label}: serialized.byte_length must be non-negative safe integer`);
  }
  const serSha = requireSha256(serialized.sha256, `${label}.serialized.sha256`);
  const endianness = requireNonemptyString(
    serialized.endianness,
    `${label}.serialized.endianness`,
  );
  if (endianness !== ENDIAN_LITTLE && endianness !== ENDIAN_BIG) {
    throw new Error(`${label}: endianness must be little|big`);
  }
  return {
    id,
    case_id,
    ros_distro,
    support_row_id,
    type_name,
    semantic_value_sha256,
    schema_identity,
    serialized: {
      path: serPath,
      byte_length: serialized.byte_length,
      sha256: serSha,
      endianness,
    },
  };
}

/**
 * Parse the full committed manifest for d2 metadata fields.
 * Binary paths and digests are validated again through the hardened corpus loader.
 */
export function parseFullManifestFixtures(raw: unknown): ManifestFixtureFull[] {
  if (!isPlainObject(raw)) {
    throw new Error("manifest.json: root must be a plain object");
  }
  if (raw.corpus !== CORPUS_ID) {
    throw new Error(`manifest.json: corpus ${String(raw.corpus)} != ${CORPUS_ID}`);
  }
  if (!Array.isArray(raw.fixtures)) {
    throw new Error("manifest.json: fixtures must be an array");
  }
  if (raw.fixtures.length !== FIXTURE_TOTAL) {
    throw new Error(
      `manifest.json: fixtures ${raw.fixtures.length} != frozen ${FIXTURE_TOTAL}`,
    );
  }
  const out: ManifestFixtureFull[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.fixtures.length; i++) {
    const f = parseManifestFixtureFull(raw.fixtures[i], `fixtures[${i}]`);
    if (seen.has(f.id)) {
      throw new Error(`manifest.json: duplicate fixture id ${f.id}`);
    }
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function assertFrozenBuckets(fixtures: BridgeFixture[], comparisons: BridgeComparison[]): void {
  if (fixtures.length !== FIXTURE_TOTAL) {
    throw new Error(`fixture total ${fixtures.length} != ${FIXTURE_TOTAL}`);
  }
  if (comparisons.length !== COMPARISON_TOTAL) {
    throw new Error(`comparison total ${comparisons.length} != ${COMPARISON_TOTAL}`);
  }

  const rowCounts: Record<string, number> = {
    "H-CY": 0,
    "H-FT": 0,
    "H-ZN": 0,
    "J-CY": 0,
    "J-FT": 0,
    "J-ZN": 0,
  };
  let humble = 0;
  let jazzy = 0;
  let little = 0;
  let big = 0;
  let exact = 0;
  let four = 0;
  let twelve = 0;
  let payload = 0;
  let maxBytes = 0;
  const groups = new Map<string, string[]>();

  for (const f of fixtures) {
    if (!(f.supportRowId in rowCounts)) {
      throw new Error(`${f.id}: unexpected support_row_id ${f.supportRowId}`);
    }
    rowCounts[f.supportRowId]! += 1;
    if (f.rosDistro === "humble") humble += 1;
    else if (f.rosDistro === "jazzy") jazzy += 1;
    else throw new Error(`${f.id}: unexpected ros_distro ${f.rosDistro}`);

    if (f.serializedEndianness === ENDIAN_LITTLE) little += 1;
    else if (f.serializedEndianness === ENDIAN_BIG) big += 1;
    else throw new Error(`${f.id}: unexpected endianness ${f.serializedEndianness}`);

    if (f.zeroTailBytes === 0) exact += 1;
    else if (f.zeroTailBytes === 4) four += 1;
    else if (f.zeroTailBytes === 12) twelve += 1;
    else throw new Error(`${f.id}: zero_tail_bytes ${f.zeroTailBytes} outside {0,4,12}`);

    if (f.logicalByteLength + f.zeroTailBytes !== f.byteLength) {
      throw new Error(
        `${f.id}: logical ${f.logicalByteLength} + tail ${f.zeroTailBytes} != byte_length ${f.byteLength}`,
      );
    }

    payload += f.byteLength;
    if (f.byteLength > maxBytes) maxBytes = f.byteLength;

    const key = `${f.rosDistro}\0${f.caseId}`;
    const list = groups.get(key) ?? [];
    list.push(f.id);
    groups.set(key, list);
  }

  for (const [row, expected] of Object.entries(ROW_TOTALS)) {
    if (rowCounts[row] !== expected) {
      throw new Error(`row ${row} count ${rowCounts[row]} != ${expected}`);
    }
  }
  if (humble !== HUMBLE_TOTAL) throw new Error(`humble ${humble} != ${HUMBLE_TOTAL}`);
  if (jazzy !== JAZZY_TOTAL) throw new Error(`jazzy ${jazzy} != ${JAZZY_TOTAL}`);
  if (little !== LITTLE_ENDIAN_TOTAL) {
    throw new Error(`little ${little} != ${LITTLE_ENDIAN_TOTAL}`);
  }
  if (big !== BIG_ENDIAN_TOTAL) throw new Error(`big ${big} != ${BIG_ENDIAN_TOTAL}`);
  if (exact !== EXACT_TAIL_TOTAL) throw new Error(`exact ${exact} != ${EXACT_TAIL_TOTAL}`);
  if (four !== FOUR_BYTE_TAIL_TOTAL) {
    throw new Error(`four-byte tails ${four} != ${FOUR_BYTE_TAIL_TOTAL}`);
  }
  if (twelve !== TWELVE_BYTE_TAIL_TOTAL) {
    throw new Error(`twelve-byte tails ${twelve} != ${TWELVE_BYTE_TAIL_TOTAL}`);
  }
  if (payload !== TOTAL_BINARY_PAYLOAD_BYTES) {
    throw new Error(`payload ${payload} != ${TOTAL_BINARY_PAYLOAD_BYTES}`);
  }
  if (maxBytes !== MAX_FIXTURE_BYTES) {
    throw new Error(`max fixture ${maxBytes} != ${MAX_FIXTURE_BYTES}`);
  }
  if (groups.size !== FIXTURE_GROUP_TOTAL) {
    throw new Error(`fixture groups ${groups.size} != ${FIXTURE_GROUP_TOTAL}`);
  }

  let multi = 0;
  let bigSingletons = 0;
  for (const [, ids] of groups) {
    if (ids.length > 1) {
      multi += 1;
    } else {
      const f = fixtures.find((x) => x.id === ids[0]);
      if (!f) throw new Error(`missing singleton fixture ${ids[0]}`);
      if (f.serializedEndianness === ENDIAN_BIG) bigSingletons += 1;
    }
  }
  if (multi !== MULTI_ROW_GROUP_TOTAL) {
    throw new Error(`multi-row groups ${multi} != ${MULTI_ROW_GROUP_TOTAL}`);
  }
  if (bigSingletons !== SINGLETON_BIG_ENDIAN_TOTAL) {
    throw new Error(
      `singleton big-endian groups ${bigSingletons} != ${SINGLETON_BIG_ENDIAN_TOTAL}`,
    );
  }

  for (let i = 1; i < fixtures.length; i++) {
    if (asciiCompare(fixtures[i - 1]!.id, fixtures[i]!.id) >= 0) {
      throw new Error("fixtures are not strictly sorted by ASCII id");
    }
  }
}

function joinTailEvidence(
  fixtures: ManifestFixtureFull[],
  evidence: readonly FixtureEvidence[],
): Map<string, FixtureEvidence> {
  const byId = new Map<string, FixtureEvidence>();
  for (const e of evidence) {
    if (byId.has(e.id)) {
      throw new Error(`tail-slack: duplicate fixture id ${e.id}`);
    }
    byId.set(e.id, e);
  }
  if (byId.size !== fixtures.length) {
    throw new Error(
      `identity join size mismatch: tail evidence ${byId.size} != manifest fixtures ${fixtures.length}`,
    );
  }
  for (const f of fixtures) {
    if (!byId.has(f.id)) {
      throw new Error(`identity join: missing tail evidence for ${f.id}`);
    }
  }
  for (const id of byId.keys()) {
    if (!fixtures.some((f) => f.id === id)) {
      throw new Error(`identity join: tail evidence ${id} has no manifest fixture`);
    }
  }
  return byId;
}

function buildComparisons(
  fixtures: BridgeFixture[],
  comparisons: readonly { case_id: string; ros_distro: string; rows: string[] }[],
): BridgeComparison[] {
  const byGroup = new Map<string, BridgeFixture[]>();
  for (const f of fixtures) {
    const key = `${f.rosDistro}\0${f.caseId}`;
    const list = byGroup.get(key) ?? [];
    list.push(f);
    byGroup.set(key, list);
  }

  const out: BridgeComparison[] = [];
  const seen = new Set<string>();
  for (const c of comparisons) {
    const key = `${c.ros_distro}\0${c.case_id}`;
    if (seen.has(key)) {
      throw new Error(`duplicate comparison ${c.ros_distro}/${c.case_id}`);
    }
    seen.add(key);
    const members = byGroup.get(key);
    if (!members || members.length < 2) {
      throw new Error(
        `comparison ${c.ros_distro}/${c.case_id}: requires multi-row fixture group`,
      );
    }
    const rows = [...c.rows].sort(asciiCompare);
    const actualRows = [...new Set(members.map((m) => m.supportRowId))].sort(asciiCompare);
    if (
      rows.length !== actualRows.length ||
      rows.some((r, i) => r !== actualRows[i])
    ) {
      throw new Error(
        `comparison ${c.ros_distro}/${c.case_id}: row set mismatch expected=[${rows.join(",")}] actual=[${actualRows.join(",")}]`,
      );
    }
    out.push({
      caseId: c.case_id,
      rosDistro: c.ros_distro,
      rows,
      fixtureIds: members.map((m) => m.id).sort(asciiCompare),
    });
  }
  out.sort((a, b) => {
    const d = asciiCompare(a.rosDistro, b.rosDistro);
    if (d !== 0) return d;
    return asciiCompare(a.caseId, b.caseId);
  });
  return out;
}

export async function buildBridge(root: string): Promise<BridgeModel> {
  // 1) Hardened corpus load: regular-file path walk, length + SHA per binary.
  const loaded = await loadCorpus(root);
  if (!loaded.ok) {
    throw new Error(loaded.diagnostics.join("; "));
  }
  if (loaded.sourceManifestSha256 !== FROZEN_MANIFEST_SHA256) {
    throw new Error(
      `manifest SHA-256 ${loaded.sourceManifestSha256} != frozen ${FROZEN_MANIFEST_SHA256}`,
    );
  }

  // 2) Independent committed tail-slack artifact: SHA pin + regenerated model equality.
  const tailRead = await resolveTrustedRelativeFile(root, TAIL_SLACK_REL);
  if (!tailRead.ok) {
    throw new Error(`tail-slack: ${tailRead.error}`);
  }
  if (tailRead.bytes.byteLength > TAIL_SLACK_MAX_BYTES) {
    throw new Error(
      `tail-slack size ${tailRead.bytes.byteLength} exceeds max ${TAIL_SLACK_MAX_BYTES}`,
    );
  }
  const tailSlackSha256 = tailSha256Hex(tailRead.bytes);
  if (tailSlackSha256 !== FROZEN_TAIL_SLACK_SHA256) {
    throw new Error(
      `tail-slack SHA-256 ${tailSlackSha256} != frozen ${FROZEN_TAIL_SLACK_SHA256}`,
    );
  }
  const committedTailText = new TextDecoder().decode(tailRead.bytes);

  const regenerated = buildTailSlackModel(
    loaded.fixtures,
    loaded.comparisons,
    loaded.sourceManifestSha256,
  );
  if (!regenerated.ok) {
    throw new Error(regenerated.diagnostics.join("; "));
  }
  const frozen = enforceFrozenSummary(regenerated.artifact);
  if (!frozen.ok) {
    throw new Error(frozen.diagnostics.join("; "));
  }
  if (committedTailText !== regenerated.bytes) {
    throw new Error(
      "tail-slack: committed artifact differs from regenerated model",
    );
  }
  // Stable pretty form of the committed parse must match the regenerated bytes.
  let committedParsed: unknown;
  try {
    committedParsed = JSON.parse(committedTailText);
  } catch (err) {
    throw new Error(
      `tail-slack: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (stableJsonPretty(committedParsed) !== regenerated.bytes) {
    throw new Error("tail-slack: committed JSON canonicalization drift");
  }

  // 3) Full manifest metadata for d2 fields.
  const manRead = await resolveTrustedRelativeFile(root, MANIFEST_REL);
  if (!manRead.ok) {
    throw new Error(`manifest: ${manRead.error}`);
  }
  if (manRead.bytes.byteLength > MANIFEST_MAX_BYTES) {
    throw new Error(
      `manifest size ${manRead.bytes.byteLength} exceeds max ${MANIFEST_MAX_BYTES}`,
    );
  }
  let manRaw: unknown;
  try {
    manRaw = JSON.parse(new TextDecoder().decode(manRead.bytes));
  } catch (err) {
    throw new Error(
      `manifest.json: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const fullFixtures = parseFullManifestFixtures(manRaw);
  const tailById = joinTailEvidence(fullFixtures, regenerated.artifact.fixtures);

  // 4) Materialize bridge fixtures: join loaded bytes + full metadata + tail evidence.
  const loadedById = new Map(loaded.fixtures.map((f) => [f.id, f]));
  const bridgeFixtures: BridgeFixture[] = [];
  for (const meta of fullFixtures) {
    const loadedFx = loadedById.get(meta.id);
    if (!loadedFx) {
      throw new Error(`identity join: loaded corpus missing ${meta.id}`);
    }
    if (loadedFx.bytes.length !== meta.serialized.byte_length) {
      throw new Error(
        `${meta.id}: loaded length ${loadedFx.bytes.length} != manifest ${meta.serialized.byte_length}`,
      );
    }
    if (loadedFx.bytes.length > BINARY_MAX_BYTES) {
      throw new Error(
        `${meta.id}: binary length ${loadedFx.bytes.length} exceeds max ${BINARY_MAX_BYTES}`,
      );
    }
    const digest = sha256Hex(loadedFx.bytes);
    if (digest !== meta.serialized.sha256) {
      throw new Error(`${meta.id}: sha256 ${digest} != manifest ${meta.serialized.sha256}`);
    }
    if (
      loadedFx.case_id !== meta.case_id ||
      loadedFx.ros_distro !== meta.ros_distro ||
      loadedFx.support_row_id !== meta.support_row_id
    ) {
      throw new Error(`${meta.id}: loaded identity fields diverge from full manifest`);
    }

    const tail = tailById.get(meta.id)!;
    if (
      tail.case_id !== meta.case_id ||
      tail.ros_distro !== meta.ros_distro ||
      tail.support_row_id !== meta.support_row_id
    ) {
      throw new Error(`${meta.id}: tail evidence identity diverges from manifest`);
    }
    if (tail.logical_byte_length + tail.zero_tail_bytes !== meta.serialized.byte_length) {
      throw new Error(
        `${meta.id}: logical+tail ${tail.logical_byte_length + tail.zero_tail_bytes} != byte_length ${meta.serialized.byte_length}`,
      );
    }

    const hex = toHex(loadedFx.bytes);
    if (hex.length !== meta.serialized.byte_length * 2) {
      throw new Error(`${meta.id}: hex length mismatch`);
    }
    // Round-trip check: hex decode recovers the exact committed binary.
    const round = fromHex(hex);
    if (round.length !== loadedFx.bytes.length) {
      throw new Error(`${meta.id}: hex roundtrip length failed`);
    }
    for (let i = 0; i < round.length; i++) {
      if (round[i] !== loadedFx.bytes[i]) {
        throw new Error(`${meta.id}: hex roundtrip byte mismatch at ${i}`);
      }
    }

    bridgeFixtures.push({
      id: meta.id,
      caseId: meta.case_id,
      rosDistro: meta.ros_distro,
      supportRowId: meta.support_row_id,
      typeName: meta.type_name,
      serializedEndianness: meta.serialized.endianness,
      serializedSha256: meta.serialized.sha256,
      semanticValueSha256: meta.semantic_value_sha256,
      schemaIdentity: meta.schema_identity,
      logicalByteLength: tail.logical_byte_length,
      zeroTailBytes: tail.zero_tail_bytes,
      canonicalFixtureId: tail.canonical_fixture_id,
      canonicalPrefixSha256: tail.canonical_prefix_sha256,
      byteLength: meta.serialized.byte_length,
      hexBytes: hex,
      fingerprintHex: fingerprintHex(loadedFx.bytes),
    });
  }

  bridgeFixtures.sort((a, b) => asciiCompare(a.id, b.id));
  const comparisons = buildComparisons(bridgeFixtures, loaded.comparisons);
  assertFrozenBuckets(bridgeFixtures, comparisons);

  // Validate every canonical_fixture_id resolves and has zero tail.
  const byId = new Map(bridgeFixtures.map((f) => [f.id, f]));
  for (const f of bridgeFixtures) {
    const canon = byId.get(f.canonicalFixtureId);
    if (!canon) {
      throw new Error(`${f.id}: canonical_fixture_id ${f.canonicalFixtureId} unresolved`);
    }
    if (canon.zeroTailBytes !== 0) {
      throw new Error(
        `${f.id}: canonical ${canon.id} has zero_tail_bytes ${canon.zeroTailBytes}`,
      );
    }
    if (canon.byteLength !== f.logicalByteLength) {
      throw new Error(
        `${f.id}: canonical length ${canon.byteLength} != logical ${f.logicalByteLength}`,
      );
    }
  }

  const rendered = renderMoonBitSource(bridgeFixtures, comparisons);
  // Run through `moon fmt` so the committed source matches package format checks.
  const sourceText = await formatMoonBitSource(root, rendered);
  const size = Buffer.byteLength(sourceText, "utf8");
  if (size > GENERATED_SOURCE_MAX_BYTES) {
    throw new Error(
      `generated source ${size} bytes exceeds ceiling ${GENERATED_SOURCE_MAX_BYTES}`,
    );
  }

  return {
    fixtures: bridgeFixtures,
    comparisons,
    sourceText,
    manifestSha256: loaded.sourceManifestSha256,
    tailSlackSha256,
  };
}

/**
 * Format generated MoonBit source with `moon fmt` in a same-directory temp file.
 * The temporary path is never the committed OUTPUT_REL, so concurrent checks
 * leave the published bridge file untouched until write renames into place.
 */
export async function formatMoonBitSource(
  root: string,
  sourceText: string,
): Promise<string> {
  const outDir = resolveUnderRoot(root, path.dirname(OUTPUT_REL));
  await mkdir(outDir, { recursive: true });
  const tmpName = `.cdr-moonbit-fixtures.format.${process.pid}.${randomBytes(8).toString("hex")}.mbt`;
  const tmpAbs = path.join(outDir, tmpName);
  try {
    await writeFile(tmpAbs, sourceText, "utf8");
    const result = spawnSync("moon", ["fmt", tmpAbs], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(
        `moon fmt failed for generated bridge source${detail ? `: ${detail}` : ""}`,
      );
    }
    const formatted = await readBoundedText(tmpAbs, GENERATED_SOURCE_MAX_BYTES);
    if (!formatted.endsWith("\n")) {
      return `${formatted}\n`;
    }
    return formatted;
  } finally {
    try {
      await unlink(tmpAbs);
    } catch {
      // temp already gone
    }
  }
}

// ---------------------------------------------------------------------------
// MoonBit source rendering
// ---------------------------------------------------------------------------

function renderFixture(f: BridgeFixture): string {
  const parts: string[] = [];
  parts.push("  {");
  parts.push(`    id: ${moonStringLiteral(f.id)},`);
  parts.push(`    case_id: ${moonStringLiteral(f.caseId)},`);
  parts.push(`    ros_distro: ${moonStringLiteral(f.rosDistro)},`);
  parts.push(`    support_row_id: ${moonStringLiteral(f.supportRowId)},`);
  parts.push(`    type_name: ${moonStringLiteral(f.typeName)},`);
  parts.push(
    `    serialized_endianness: ${moonStringLiteral(f.serializedEndianness)},`,
  );
  parts.push(
    `    serialized_sha256: ${moonStringLiteral(f.serializedSha256)},`,
  );
  parts.push(
    `    semantic_value_sha256: ${moonStringLiteral(f.semanticValueSha256)},`,
  );
  parts.push("    schema_identity: {");
  parts.push(`      scheme: ${moonStringLiteral(f.schemaIdentity.scheme)},`);
  parts.push(`      value: ${moonStringLiteral(f.schemaIdentity.value)},`);
  parts.push("    },");
  parts.push(`    logical_byte_length: ${f.logicalByteLength},`);
  parts.push(`    zero_tail_bytes: ${f.zeroTailBytes},`);
  parts.push(
    `    canonical_fixture_id: ${moonStringLiteral(f.canonicalFixtureId)},`,
  );
  parts.push(
    `    canonical_prefix_sha256: ${moonStringLiteral(f.canonicalPrefixSha256)},`,
  );
  parts.push(`    byte_length: ${f.byteLength},`);
  parts.push(`    hex_bytes: ${moonStringLiteral(f.hexBytes)},`);
  parts.push(`    fingerprint_hex: ${moonStringLiteral(f.fingerprintHex)},`);
  parts.push("  },");
  return parts.join("\n");
}

/**
 * Render a field whose value is a string array, matching `moon fmt` layout.
 * Short arrays stay on one line; longer lists wrap under a 100-column budget.
 */
function renderStringArrayField(field: string, values: string[]): string[] {
  const items = values.map((v) => moonStringLiteral(v)).join(", ");
  const single = `    ${field}: [${items}],`;
  // Match moon fmt column budget observed on this package (~82 columns).
  if (single.length <= 82) {
    return [single];
  }
  return [`    ${field}: [`, `      ${items},`, "    ],"];
}

function renderComparison(c: BridgeComparison): string {
  const parts: string[] = [];
  parts.push("  {");
  parts.push(`    case_id: ${moonStringLiteral(c.caseId)},`);
  parts.push(`    ros_distro: ${moonStringLiteral(c.rosDistro)},`);
  parts.push(...renderStringArrayField("rows", c.rows));
  parts.push(...renderStringArrayField("fixture_ids", c.fixtureIds));
  parts.push("  },");
  return parts.join("\n");
}

export function renderMoonBitSource(
  fixtures: BridgeFixture[],
  comparisons: BridgeComparison[],
): string {
  const lines: string[] = [];
  lines.push(`// Generated by ${GENERATED_BY}.`);
  lines.push("// Regenerate with bun run cdr-moonbit-fixtures:write.");
  lines.push(`// corpus: ${CORPUS_ID}`);
  lines.push(`// sources: ${MANIFEST_REL}, ${TAIL_SLACK_REL}`);
  lines.push(`// frozen_manifest_sha256: ${FROZEN_MANIFEST_SHA256}`);
  lines.push(`// frozen_tail_slack_sha256: ${FROZEN_TAIL_SLACK_SHA256}`);
  lines.push("//");
  lines.push("// White-box fixture bridge for M1-01d1: reconstructs the committed");
  lines.push("// ROS CDR corpus binaries from raw lowercase hex, carries the d2");
  lines.push("// metadata surface, and proves CDR open + tail-slack prefix identity.");
  lines.push("// Package-internal declarations keep this surface test-only for");
  lines.push("// future hand-written white-box semantic proof.");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct CdrSchemaIdentity {");
  lines.push("  scheme : String");
  lines.push("  value : String");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct CdrCorpusFixture {");
  lines.push("  id : String");
  lines.push("  case_id : String");
  lines.push("  ros_distro : String");
  lines.push("  support_row_id : String");
  lines.push("  type_name : String");
  lines.push("  serialized_endianness : String");
  lines.push("  serialized_sha256 : String");
  lines.push("  semantic_value_sha256 : String");
  lines.push("  schema_identity : CdrSchemaIdentity");
  lines.push("  logical_byte_length : Int");
  lines.push("  zero_tail_bytes : Int");
  lines.push("  canonical_fixture_id : String");
  lines.push("  canonical_prefix_sha256 : String");
  lines.push("  byte_length : Int");
  lines.push("  hex_bytes : String");
  lines.push("  fingerprint_hex : String");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct CdrCorpusComparison {");
  lines.push("  case_id : String");
  lines.push("  ros_distro : String");
  lines.push("  rows : Array[String]");
  lines.push("  fixture_ids : Array[String]");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_hex_nibble(code : Int) -> Int {");
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
  lines.push("fn cdr_fx_decode_hex(hex : String) -> Array[Byte] {");
  lines.push("  let n = hex.length()");
  lines.push("  if n % 2 != 0 {");
  lines.push('    abort("odd hex length")');
  lines.push("  }");
  lines.push("  let out : Array[Byte] = []");
  lines.push("  let mut i = 0");
  lines.push("  while i < n {");
  lines.push("    let hi = cdr_fx_hex_nibble(hex[i].to_int())");
  lines.push("    let lo = cdr_fx_hex_nibble(hex[i + 1].to_int())");
  lines.push("    out.push(((hi << 4) | lo).to_byte())");
  lines.push("    i = i + 2");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_fingerprint_u64(bytes : Array[Byte]) -> UInt64 {");
  lines.push("  let mut hash : UInt64 = 0xcbf29ce484222325UL");
  lines.push("  let prime : UInt64 = 0x100000001b3UL");
  lines.push("  for b in bytes {");
  lines.push("    hash = (hash ^ b.to_uint64()) * prime");
  lines.push("  }");
  lines.push("  hash");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_nibble_char(n : Int) -> Char {");
  lines.push("  if n < 10 {");
  lines.push("    (48 + n).unsafe_to_char()");
  lines.push("  } else {");
  lines.push("    (87 + n).unsafe_to_char()");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_u64_to_hex16(v : UInt64) -> String {");
  lines.push('  let mut out = ""');
  lines.push("  let mut i = 0");
  lines.push("  while i < 16 {");
  lines.push("    let shift = (15 - i) * 4");
  lines.push("    let nib = ((v >> shift) & 0xfUL).to_int()");
  lines.push("    out = out + cdr_fx_nibble_char(nib).to_string()");
  lines.push("    i = i + 1");
  lines.push("  }");
  lines.push("  out");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_fingerprint_hex(bytes : Array[Byte]) -> String {");
  lines.push("  cdr_fx_u64_to_hex16(cdr_fx_fingerprint_u64(bytes))");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_bytes_of(arr : Array[Byte]) -> Bytes {");
  lines.push("  Bytes::from_array(arr[:])");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_find(id : String) -> CdrCorpusFixture {");
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push("    if f.id == id {");
  lines.push("      return f");
  lines.push("    }");
  lines.push("  }");
  lines.push('  abort("fixture id not found: " + id)');
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push(
    "fn cdr_fx_prefix_eq(a : Array[Byte], b : Array[Byte], n : Int) -> Bool {",
  );
  lines.push("  if a.length() < n || b.length() < n {");
  lines.push("    return false");
  lines.push("  }");
  lines.push("  let mut i = 0");
  lines.push("  while i < n {");
  lines.push("    if a[i] != b[i] {");
  lines.push("      return false");
  lines.push("    }");
  lines.push("    i = i + 1");
  lines.push("  }");
  lines.push("  true");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("fn cdr_fx_count(pred : (CdrCorpusFixture) -> Bool) -> Int {");
  lines.push("  let mut n = 0");
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push("    if pred(f) {");
  lines.push("      n = n + 1");
  lines.push("    }");
  lines.push("  }");
  lines.push("  n");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_FIXTURE_TOTAL = ${FIXTURE_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_COMPARISON_TOTAL = ${COMPARISON_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_GROUP_TOTAL = ${FIXTURE_GROUP_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_EXACT_TAIL_TOTAL = ${EXACT_TAIL_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_FOUR_BYTE_TAIL_TOTAL = ${FOUR_BYTE_TAIL_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_TWELVE_BYTE_TAIL_TOTAL = ${TWELVE_BYTE_TAIL_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_HUMBLE_TOTAL = ${HUMBLE_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_JAZZY_TOTAL = ${JAZZY_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_LITTLE_ENDIAN_TOTAL = ${LITTLE_ENDIAN_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_BIG_ENDIAN_TOTAL = ${BIG_ENDIAN_TOTAL}`);
  lines.push("");
  lines.push("///|");
  lines.push(
    `const CDR_FX_SINGLETON_BIG_ENDIAN_TOTAL = ${SINGLETON_BIG_ENDIAN_TOTAL}`,
  );
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_H_CY = ${ROW_TOTALS["H-CY"]}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_H_FT = ${ROW_TOTALS["H-FT"]}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_H_ZN = ${ROW_TOTALS["H-ZN"]}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_J_CY = ${ROW_TOTALS["J-CY"]}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_J_FT = ${ROW_TOTALS["J-FT"]}`);
  lines.push("");
  lines.push("///|");
  lines.push(`const CDR_FX_ROW_J_ZN = ${ROW_TOTALS["J-ZN"]}`);
  lines.push("");
  lines.push("///|");
  lines.push("let cdr_corpus_fixtures : Array[CdrCorpusFixture] = [");
  for (const f of fixtures) {
    lines.push(renderFixture(f));
  }
  lines.push("]");
  lines.push("");
  lines.push("///|");
  lines.push("let cdr_corpus_comparisons : Array[CdrCorpusComparison] = [");
  for (const c of comparisons) {
    lines.push(renderComparison(c));
  }
  lines.push("]");
  lines.push("");
  lines.push('test "cdr corpus bridge totals and frozen buckets" {');
  lines.push("  assert_eq(cdr_corpus_fixtures.length(), CDR_FX_FIXTURE_TOTAL)");
  lines.push(
    "  assert_eq(cdr_corpus_comparisons.length(), CDR_FX_COMPARISON_TOTAL)",
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.ros_distro == "humble"), CDR_FX_HUMBLE_TOTAL)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.ros_distro == "jazzy"), CDR_FX_JAZZY_TOTAL)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.serialized_endianness == "little"), CDR_FX_LITTLE_ENDIAN_TOTAL)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.serialized_endianness == "big"), CDR_FX_BIG_ENDIAN_TOTAL)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "H-CY"), CDR_FX_ROW_H_CY)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "H-FT"), CDR_FX_ROW_H_FT)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "H-ZN"), CDR_FX_ROW_H_ZN)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "J-CY"), CDR_FX_ROW_J_CY)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "J-FT"), CDR_FX_ROW_J_FT)',
  );
  lines.push(
    '  assert_eq(cdr_fx_count(f => f.support_row_id == "J-ZN"), CDR_FX_ROW_J_ZN)',
  );
  lines.push(
    "  assert_eq(cdr_fx_count(f => f.zero_tail_bytes == 0), CDR_FX_EXACT_TAIL_TOTAL)",
  );
  lines.push(
    "  assert_eq(cdr_fx_count(f => f.zero_tail_bytes == 4), CDR_FX_FOUR_BYTE_TAIL_TOTAL)",
  );
  lines.push(
    "  assert_eq(cdr_fx_count(f => f.zero_tail_bytes == 12), CDR_FX_TWELVE_BYTE_TAIL_TOTAL)",
  );
  lines.push("}");
  lines.push("");
  lines.push('test "cdr corpus binaries reconstruct length and fingerprint" {');
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push("    let bytes = cdr_fx_decode_hex(f.hex_bytes)");
  lines.push("    assert_eq(bytes.length(), f.byte_length)");
  lines.push("    assert_eq(cdr_fx_fingerprint_hex(bytes), f.fingerprint_hex)");
  lines.push("    assert_eq(f.serialized_sha256.length(), 64)");
  lines.push("    assert_eq(f.hex_bytes.length(), f.byte_length * 2)");
  lines.push("    assert_eq(f.type_name.length() > 0, true)");
  lines.push("    assert_eq(f.canonical_prefix_sha256.length(), 64)");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push('test "cdr corpus open_default endianness matches metadata" {');
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push("    let arr = cdr_fx_decode_hex(f.hex_bytes)");
  lines.push("    let view = cdr_fx_bytes_of(arr)[:]");
  lines.push("    match CdrReader::open_default(view) {");
  lines.push("      Ok(reader) => {");
  lines.push('        if f.serialized_endianness == "little" {');
  lines.push("          assert_eq(reader.little_endian(), true)");
  lines.push('        } else if f.serialized_endianness == "big" {');
  lines.push("          assert_eq(reader.little_endian(), false)");
  lines.push("        } else {");
  lines.push('          abort("unexpected endianness metadata")');
  lines.push("        }");
  lines.push("      }");
  lines.push(
    '      Err(e) => abort("open_default failed: " + e.code + " for " + f.id)',
  );
  lines.push("    }");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push('test "cdr corpus logical length plus zero tail equals byte length" {');
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push(
    "    assert_eq(f.logical_byte_length + f.zero_tail_bytes, f.byte_length)",
  );
  lines.push("    let bytes = cdr_fx_decode_hex(f.hex_bytes)");
  lines.push("    let mut i = f.logical_byte_length");
  lines.push("    while i < bytes.length() {");
  lines.push("      assert_eq(bytes[i], b'\\x00')");
  lines.push("      i = i + 1");
  lines.push("    }");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push('test "cdr corpus canonical prefixes match logical slices" {');
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push("    let canon = cdr_fx_find(f.canonical_fixture_id)");
  lines.push("    assert_eq(canon.zero_tail_bytes, 0)");
  lines.push("    assert_eq(canon.byte_length, f.logical_byte_length)");
  lines.push("    assert_eq(canon.serialized_sha256, f.canonical_prefix_sha256)");
  lines.push("    let bytes = cdr_fx_decode_hex(f.hex_bytes)");
  lines.push("    let canon_bytes = cdr_fx_decode_hex(canon.hex_bytes)");
  lines.push(
    "    assert_eq(cdr_fx_prefix_eq(bytes, canon_bytes, f.logical_byte_length), true)",
  );
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push(
    'test "cdr corpus multi-row comparison identities and big-endian singletons" {',
  );
  lines.push(
    "  assert_eq(cdr_corpus_comparisons.length(), CDR_FX_COMPARISON_TOTAL)",
  );
  lines.push("  for c in cdr_corpus_comparisons {");
  lines.push("    assert_eq(c.fixture_ids.length() >= 2, true)");
  lines.push("    assert_eq(c.rows.length(), c.fixture_ids.length())");
  lines.push("    let first = cdr_fx_find(c.fixture_ids[0])");
  lines.push("    assert_eq(first.case_id, c.case_id)");
  lines.push("    assert_eq(first.ros_distro, c.ros_distro)");
  lines.push("    assert_eq(first.type_name.length() > 0, true)");
  lines.push("    let mut i = 0");
  lines.push("    while i < c.fixture_ids.length() {");
  lines.push("      let f = cdr_fx_find(c.fixture_ids[i])");
  lines.push("      assert_eq(f.case_id, c.case_id)");
  lines.push("      assert_eq(f.ros_distro, c.ros_distro)");
  lines.push("      assert_eq(f.type_name, first.type_name)");
  lines.push("      assert_eq(f.semantic_value_sha256, first.semantic_value_sha256)");
  lines.push("      assert_eq(f.schema_identity.scheme, first.schema_identity.scheme)");
  lines.push("      assert_eq(f.schema_identity.value, first.schema_identity.value)");
  lines.push("      i = i + 1");
  lines.push("    }");
  lines.push("  }");
  lines.push("  // Singleton groups are exactly the two big-endian primitive fixtures.");
  lines.push("  let mut big_singletons = 0");
  lines.push("  for f in cdr_corpus_fixtures {");
  lines.push('    if f.serialized_endianness == "big" {');
  lines.push("      let mut peers = 0");
  lines.push("      for g in cdr_corpus_fixtures {");
  lines.push("        if g.case_id == f.case_id && g.ros_distro == f.ros_distro {");
  lines.push("          peers = peers + 1");
  lines.push("        }");
  lines.push("      }");
  lines.push("      assert_eq(peers, 1)");
  lines.push("      big_singletons = big_singletons + 1");
  lines.push("    }");
  lines.push("  }");
  lines.push("  assert_eq(big_singletons, CDR_FX_SINGLETON_BIG_ENDIAN_TOTAL)");
  lines.push(
    "  assert_eq(CDR_FX_COMPARISON_TOTAL + CDR_FX_SINGLETON_BIG_ENDIAN_TOTAL, CDR_FX_GROUP_TOTAL)",
  );
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

export async function writeBridge(
  root: string,
): Promise<{ bytes: number; fixtures: number; comparisons: number }> {
  const model = await buildBridge(root);
  const outPath = resolveUnderRoot(root, OUTPUT_REL);
  await writeAtomicText(outPath, model.sourceText, GENERATED_SOURCE_MAX_BYTES);
  return {
    bytes: Buffer.byteLength(model.sourceText, "utf8"),
    fixtures: model.fixtures.length,
    comparisons: model.comparisons.length,
  };
}

export async function checkBridge(root: string): Promise<void> {
  const model = await buildBridge(root);
  const outPath = resolveUnderRoot(root, OUTPUT_REL);
  // Reject output symlink before reading so external targets stay untouched.
  try {
    const st = await lstat(outPath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to check symlink ${outPath}`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") {
      throw new Error(`${OUTPUT_REL}: missing generated source`);
    }
    if (err && err.message?.includes("symlink")) throw e;
    if (!(err && err.code === "ENOENT")) {
      // fall through to bounded read which re-validates regular file
    }
  }
  const disk = await readBoundedText(outPath, GENERATED_SOURCE_MAX_BYTES);
  if (disk !== model.sourceText) {
    throw new Error(
      `${OUTPUT_REL}: drift detected (committed bytes differ from regenerated source)`,
    );
  }
  const size = Buffer.byteLength(disk, "utf8");
  if (size > GENERATED_SOURCE_MAX_BYTES) {
    throw new Error(
      `${OUTPUT_REL}: size ${size} exceeds ceiling ${GENERATED_SOURCE_MAX_BYTES}`,
    );
  }
}

async function main(): Promise<void> {
  const mode = parseCliMode(process.argv.slice(2));
  if (mode === null) {
    console.error("usage: bun run scripts/cdr-moonbit-fixtures.ts --write|--check");
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
        comparisons: r.comparisons,
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
