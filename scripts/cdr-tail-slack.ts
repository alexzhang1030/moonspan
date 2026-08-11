#!/usr/bin/env bun
/**
 * CDR top-level tail-slack evidence overlay (generator/checker).
 *
 * Derives a stable evidence artifact from committed corpus binaries: every
 * support-row fixture is a canonical logical prefix plus a zero-filled
 * top-level suffix. The CLI writes only `conformance/cdr/tail-slack.json`;
 * source corpus artifacts (manifest, row metadata, binaries, bundles) stay
 * byte-identical.
 *
 *   bun run scripts/cdr-tail-slack.ts --write
 *   bun run scripts/cdr-tail-slack.ts --check
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const CORPUS_REL = "conformance/cdr";
export const MANIFEST_REL = `${CORPUS_REL}/manifest.json`;
export const ARTIFACT_REL = `${CORPUS_REL}/tail-slack.json`;
export const FIXTURES_PREFIX = "fixtures/";
export const CORPUS_ID = "moonspan-ros-cdr-v1";
export const SCHEMA_VERSION = 1;
export const POLICY = "canonical-prefix-plus-zero-tail-v1";

/** Frozen input size ceilings for trusted corpus I/O. */
export const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const BINARY_MAX_BYTES = 64 * 1024 * 1024;

/** Allowed top-level zero-tail lengths for Phase 1 corpus evidence. */
export const ALLOWED_ZERO_TAIL_BYTES = [0, 4, 12] as const;

/** Frozen production summary bound to the committed 56-fixture corpus. */
export const FROZEN_SUMMARY = {
  fixtures: 56,
  comparisons: 18,
  exact_fixtures: 24,
  four_byte_tail_fixtures: 12,
  twelve_byte_tail_fixtures: 20,
} as const;

export type Mode = "write" | "check";

export type SerializedMeta = {
  path: string;
  byte_length: number;
  sha256: string;
};

export type ManifestFixture = {
  id: string;
  case_id: string;
  ros_distro: string;
  support_row_id: string;
  serialized: SerializedMeta;
};

export type ManifestComparison = {
  case_id: string;
  ros_distro: string;
  rows: string[];
};

export type ManifestDoc = {
  corpus: string;
  fixtures: ManifestFixture[];
  comparisons: ManifestComparison[];
};

export type LoadedFixture = {
  id: string;
  case_id: string;
  ros_distro: string;
  support_row_id: string;
  path: string;
  bytes: Uint8Array;
};

export type FixtureEvidence = {
  id: string;
  case_id: string;
  ros_distro: string;
  support_row_id: string;
  logical_byte_length: number;
  zero_tail_bytes: number;
  canonical_fixture_id: string;
  canonical_prefix_sha256: string;
};

export type ComparisonEvidence = {
  case_id: string;
  ros_distro: string;
  rows: string[];
  logical_byte_length: number;
  canonical_prefix_sha256: string;
  zero_tail_bytes_by_row: Record<string, number>;
};

export type TailSlackArtifact = {
  schema_version: number;
  corpus: string;
  policy: string;
  source_manifest_sha256: string;
  summary: {
    fixtures: number;
    comparisons: number;
    exact_fixtures: number;
    four_byte_tail_fixtures: number;
    twelve_byte_tail_fixtures: number;
  };
  fixtures: FixtureEvidence[];
  comparisons: ComparisonEvidence[];
};

export type BuildResult =
  | { ok: true; artifact: TailSlackArtifact; bytes: string }
  | { ok: false; diagnostics: string[] };

// --- Pure helpers (test-facing) ---

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort(asciiCompare)) {
    output[key] = sortKeysDeep(input[key]);
  }
  return output;
}

export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export function parseCliMode(args: string[]): { mode: Mode } | { error: string } {
  if (args.length !== 1) {
    return { error: "usage: cdr-tail-slack.ts --write|--check" };
  }
  if (args[0] === "--write") return { mode: "write" };
  if (args[0] === "--check") return { mode: "check" };
  return { error: `unknown mode ${args[0]}` };
}

/**
 * Safe paths use nonempty ordinary segments and forward slashes.
 * Absolute paths, backslashes, empty segments, `.`, and `..` are rejected.
 */
export function isSafeRelativePath(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (path.isAbsolute(rel)) return false;
  if (rel.includes("\\") || rel.includes("\0")) return false;
  const parts = rel.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return false;
  }
  const norm = path.posix.normalize(rel);
  if (norm !== rel) return false;
  return true;
}

/** Serialized binary paths must live under `fixtures/` within the corpus root. */
export function isFixtureBinaryPath(rel: string): boolean {
  if (!isSafeRelativePath(rel)) return false;
  if (!rel.startsWith(FIXTURES_PREFIX)) return false;
  if (rel === "fixtures" || rel === FIXTURES_PREFIX.slice(0, -1)) return false;
  return true;
}

export function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isSafeNonnegInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

export function isLowerHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isAllowedZeroTail(n: number): boolean {
  return n === 0 || n === 4 || n === 12;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isAllZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

export type GroupMember = {
  id: string;
  support_row_id: string;
  bytes: Uint8Array;
};

/**
 * Select the canonical member: shortest payload, then ASCII fixture id.
 */
export function selectCanonical(members: readonly GroupMember[]): GroupMember {
  if (members.length === 0) {
    throw new Error("selectCanonical: empty group");
  }
  const sorted = [...members].sort((a, b) => {
    if (a.bytes.length !== b.bytes.length) return a.bytes.length - b.bytes.length;
    return asciiCompare(a.id, b.id);
  });
  return sorted[0]!;
}

/**
 * Derive per-member tail evidence against a canonical prefix.
 * Accepts only zero-tail lengths in {0, 4, 12}.
 */
export function deriveMemberEvidence(
  member: GroupMember,
  canonical: GroupMember,
):
  | {
      ok: true;
      logical_byte_length: number;
      zero_tail_bytes: number;
      canonical_fixture_id: string;
      canonical_prefix_sha256: string;
    }
  | { ok: false; error: string } {
  const prefix = canonical.bytes;
  if (member.bytes.length < prefix.length) {
    return {
      ok: false,
      error: `${member.id}: shorter than canonical ${canonical.id} (${member.bytes.length} < ${prefix.length})`,
    };
  }
  const head = member.bytes.subarray(0, prefix.length);
  if (!bytesEqual(head, prefix)) {
    return {
      ok: false,
      error: `${member.id}: logical prefix diverges from canonical ${canonical.id}`,
    };
  }
  const tail = member.bytes.subarray(prefix.length);
  if (!isAllZero(tail)) {
    return {
      ok: false,
      error: `${member.id}: suffix byte must equal zero`,
    };
  }
  if (!isAllowedZeroTail(tail.length)) {
    return {
      ok: false,
      error: `${member.id}: zero_tail_bytes ${tail.length} outside allowed set {0, 4, 12}`,
    };
  }
  return {
    ok: true,
    logical_byte_length: prefix.length,
    zero_tail_bytes: tail.length,
    canonical_fixture_id: canonical.id,
    canonical_prefix_sha256: sha256Hex(prefix),
  };
}

/**
 * Enforce frozen production summary counts and bucket sum integrity.
 */
export function enforceFrozenSummary(
  artifact: TailSlackArtifact,
): { ok: true } | { ok: false; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const s = artifact.summary;
  const bucketSum =
    s.exact_fixtures + s.four_byte_tail_fixtures + s.twelve_byte_tail_fixtures;
  if (bucketSum !== s.fixtures) {
    diagnostics.push(
      `bucket sum ${bucketSum} differs from fixture count ${s.fixtures}`,
    );
  }
  if (s.fixtures !== FROZEN_SUMMARY.fixtures) {
    diagnostics.push(
      `fixtures ${s.fixtures} differs from frozen ${FROZEN_SUMMARY.fixtures}`,
    );
  }
  if (s.comparisons !== FROZEN_SUMMARY.comparisons) {
    diagnostics.push(
      `comparisons ${s.comparisons} differs from frozen ${FROZEN_SUMMARY.comparisons}`,
    );
  }
  if (s.exact_fixtures !== FROZEN_SUMMARY.exact_fixtures) {
    diagnostics.push(
      `exact_fixtures ${s.exact_fixtures} differs from frozen ${FROZEN_SUMMARY.exact_fixtures}`,
    );
  }
  if (s.four_byte_tail_fixtures !== FROZEN_SUMMARY.four_byte_tail_fixtures) {
    diagnostics.push(
      `four_byte_tail_fixtures ${s.four_byte_tail_fixtures} differs from frozen ${FROZEN_SUMMARY.four_byte_tail_fixtures}`,
    );
  }
  if (s.twelve_byte_tail_fixtures !== FROZEN_SUMMARY.twelve_byte_tail_fixtures) {
    diagnostics.push(
      `twelve_byte_tail_fixtures ${s.twelve_byte_tail_fixtures} differs from frozen ${FROZEN_SUMMARY.twelve_byte_tail_fixtures}`,
    );
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true };
}

/**
 * Build the full evidence model from loaded fixtures and manifest comparisons.
 * Pure over already-validated in-memory bytes. Production callers apply
 * `enforceFrozenSummary` after this model build.
 */
export function buildTailSlackModel(
  fixtures: readonly LoadedFixture[],
  comparisons: readonly ManifestComparison[],
  sourceManifestSha256: string,
): BuildResult {
  const diagnostics: string[] = [];
  const byId = new Map<string, LoadedFixture>();
  for (const f of fixtures) {
    if (byId.has(f.id)) {
      diagnostics.push(`duplicate fixture id ${f.id}`);
    }
    byId.set(f.id, f);
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const groups = new Map<string, GroupMember[]>();
  const groupKey = (distro: string, caseId: string) => `${distro}\0${caseId}`;
  for (const f of fixtures) {
    const key = groupKey(f.ros_distro, f.case_id);
    const list = groups.get(key) ?? [];
    list.push({
      id: f.id,
      support_row_id: f.support_row_id,
      bytes: f.bytes,
    });
    groups.set(key, list);
  }

  const fixtureEvidence: FixtureEvidence[] = [];
  const groupMeta = new Map<
    string,
    {
      case_id: string;
      ros_distro: string;
      logical_byte_length: number;
      canonical_prefix_sha256: string;
      by_row: Map<string, number>;
    }
  >();

  for (const [key, members] of [...groups.entries()].sort((a, b) =>
    asciiCompare(a[0], b[0]),
  )) {
    // Reject duplicate support-row IDs inside a group before map construction.
    const seenRows = new Set<string>();
    let groupHasDupRow = false;
    for (const member of members) {
      if (seenRows.has(member.support_row_id)) {
        diagnostics.push(
          `duplicate support_row_id ${member.support_row_id} in group ${key.replace("\0", "/")}`,
        );
        groupHasDupRow = true;
      }
      seenRows.add(member.support_row_id);
    }
    if (groupHasDupRow) continue;

    const canonical = selectCanonical(members);
    const by_row = new Map<string, number>();
    let logical = 0;
    let prefixSha = "";
    for (const member of members) {
      const derived = deriveMemberEvidence(member, canonical);
      if (!derived.ok) {
        diagnostics.push(derived.error);
        continue;
      }
      logical = derived.logical_byte_length;
      prefixSha = derived.canonical_prefix_sha256;
      by_row.set(member.support_row_id, derived.zero_tail_bytes);
      const src = byId.get(member.id)!;
      fixtureEvidence.push({
        id: member.id,
        case_id: src.case_id,
        ros_distro: src.ros_distro,
        support_row_id: src.support_row_id,
        logical_byte_length: derived.logical_byte_length,
        zero_tail_bytes: derived.zero_tail_bytes,
        canonical_fixture_id: derived.canonical_fixture_id,
        canonical_prefix_sha256: derived.canonical_prefix_sha256,
      });
    }
    const [ros_distro, case_id] = key.split("\0");
    groupMeta.set(key, {
      case_id: case_id!,
      ros_distro: ros_distro!,
      logical_byte_length: logical,
      canonical_prefix_sha256: prefixSha,
      by_row,
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  fixtureEvidence.sort((a, b) => asciiCompare(a.id, b.id));

  const comparisonEvidence: ComparisonEvidence[] = [];
  const seenComparisonKeys = new Set<string>();
  for (const comp of comparisons) {
    const key = groupKey(comp.ros_distro, comp.case_id);
    if (seenComparisonKeys.has(key)) {
      diagnostics.push(
        `duplicate comparison identity ${comp.ros_distro}/${comp.case_id}`,
      );
      continue;
    }
    seenComparisonKeys.add(key);

    // Reject duplicate support-row IDs in the comparison row list before map use.
    const rowSeen = new Set<string>();
    let rowDup = false;
    for (const row of comp.rows) {
      if (rowSeen.has(row)) {
        diagnostics.push(
          `duplicate support_row_id ${row} in comparison ${comp.ros_distro}/${comp.case_id}`,
        );
        rowDup = true;
      }
      rowSeen.add(row);
    }
    if (rowDup) continue;

    const meta = groupMeta.get(key);
    if (!meta) {
      diagnostics.push(
        `comparison ${comp.ros_distro}/${comp.case_id}: missing fixture group`,
      );
      continue;
    }
    const expectedRows = [...comp.rows].sort(asciiCompare);
    const actualRows = [...meta.by_row.keys()].sort(asciiCompare);
    if (
      expectedRows.length !== actualRows.length ||
      expectedRows.some((r, i) => r !== actualRows[i])
    ) {
      diagnostics.push(
        `comparison ${comp.ros_distro}/${comp.case_id}: row set mismatch expected=[${expectedRows.join(",")}] actual=[${actualRows.join(",")}]`,
      );
      continue;
    }
    const zero_tail_bytes_by_row: Record<string, number> = {};
    for (const row of expectedRows) {
      zero_tail_bytes_by_row[row] = meta.by_row.get(row)!;
    }
    comparisonEvidence.push({
      case_id: comp.case_id,
      ros_distro: comp.ros_distro,
      rows: expectedRows,
      logical_byte_length: meta.logical_byte_length,
      canonical_prefix_sha256: meta.canonical_prefix_sha256,
      zero_tail_bytes_by_row,
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  // Cross-row fixture groups and comparison identities form a bijection:
  // every multi-row group has exactly one comparison, and every comparison
  // resolves to exactly one multi-row group. Single-row groups (exact-only
  // big-endian primitives) remain fixture evidence without a comparison row.
  const multiRowGroupKeys = new Set<string>();
  for (const [key, meta] of groupMeta.entries()) {
    if (meta.by_row.size > 1) multiRowGroupKeys.add(key);
  }
  for (const key of multiRowGroupKeys) {
    if (!seenComparisonKeys.has(key)) {
      const [ros_distro, case_id] = key.split("\0");
      diagnostics.push(
        `fixture group ${ros_distro}/${case_id}: missing comparison entry`,
      );
    }
  }
  for (const key of seenComparisonKeys) {
    if (!multiRowGroupKeys.has(key)) {
      const [ros_distro, case_id] = key.split("\0");
      diagnostics.push(
        `comparison ${ros_distro}/${case_id}: fixture group must contain multiple support rows`,
      );
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  comparisonEvidence.sort((a, b) => {
    const d = asciiCompare(a.ros_distro, b.ros_distro);
    if (d !== 0) return d;
    return asciiCompare(a.case_id, b.case_id);
  });

  let exact = 0;
  let four = 0;
  let twelve = 0;
  for (const f of fixtureEvidence) {
    if (f.zero_tail_bytes === 0) exact += 1;
    else if (f.zero_tail_bytes === 4) four += 1;
    else if (f.zero_tail_bytes === 12) twelve += 1;
    else {
      diagnostics.push(
        `${f.id}: zero_tail_bytes ${f.zero_tail_bytes} outside allowed set {0, 4, 12}`,
      );
    }
  }
  if (exact + four + twelve !== fixtureEvidence.length) {
    diagnostics.push(
      `bucket sum ${exact + four + twelve} differs from fixture count ${fixtureEvidence.length}`,
    );
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const artifact: TailSlackArtifact = {
    schema_version: SCHEMA_VERSION,
    corpus: CORPUS_ID,
    policy: POLICY,
    source_manifest_sha256: sourceManifestSha256,
    summary: {
      fixtures: fixtureEvidence.length,
      comparisons: comparisonEvidence.length,
      exact_fixtures: exact,
      four_byte_tail_fixtures: four,
      twelve_byte_tail_fixtures: twelve,
    },
    fixtures: fixtureEvidence,
    comparisons: comparisonEvidence,
  };
  const bytes = stableJsonPretty(artifact);
  return { ok: true, artifact, bytes };
}

// --- I/O and CLI ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve a trusted relative file by lstat-checking every path component from
 * the root. Intermediate components are regular directories; the final target
 * is a regular file. Symlinks at any component are rejected so the resolved
 * file stays inside the intended subtree.
 *
 * When `maxBytes` is provided it must be a safe non-negative integer. The
 * final file's lstat size is checked before `readFile`, and the read buffer
 * length is checked again after the read.
 */
export async function resolveTrustedRelativeFile(
  root: string,
  rel: string,
  opts?: { requireFixtureBinary?: boolean; maxBytes?: number },
): Promise<{ ok: true; abs: string; bytes: Uint8Array } | { ok: false; error: string }> {
  if (!isSafeRelativePath(rel)) {
    return { ok: false, error: `unsafe path ${rel}` };
  }
  if (opts?.maxBytes !== undefined) {
    if (
      typeof opts.maxBytes !== "number" ||
      !Number.isSafeInteger(opts.maxBytes) ||
      opts.maxBytes < 0
    ) {
      return { ok: false, error: `invalid maxBytes ${String(opts.maxBytes)}` };
    }
  }
  if (opts?.requireFixtureBinary) {
    // Fixture binaries use corpus-relative paths under fixtures/.
    const underCorpus = rel.startsWith(`${CORPUS_REL}/`)
      ? rel.slice(CORPUS_REL.length + 1)
      : rel;
    if (!isFixtureBinaryPath(underCorpus)) {
      return {
        ok: false,
        error: `serialized path must be a safe relative path under fixtures/: ${rel}`,
      };
    }
  }

  const rootAbs = path.resolve(root);
  let rootSt;
  try {
    rootSt = await lstat(rootAbs);
  } catch {
    return { ok: false, error: `missing root ${root}` };
  }
  if (rootSt.isSymbolicLink()) {
    return { ok: false, error: `symlink rejected: ${root}` };
  }
  if (!rootSt.isDirectory()) {
    return { ok: false, error: `directory required: ${root}` };
  }

  const parts = rel.split("/");
  let cur = rootAbs;
  let finalSt: Awaited<ReturnType<typeof lstat>> | null = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    cur = path.join(cur, part);
    if (!cur.startsWith(rootAbs + path.sep) && cur !== rootAbs) {
      return { ok: false, error: `path escapes root: ${rel}` };
    }
    let st;
    try {
      st = await lstat(cur);
    } catch {
      return {
        ok: false,
        error: `missing path component: ${parts.slice(0, i + 1).join("/")}`,
      };
    }
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `symlink rejected: ${parts.slice(0, i + 1).join("/")}`,
      };
    }
    const isLast = i === parts.length - 1;
    if (isLast) {
      if (!st.isFile()) {
        return { ok: false, error: `regular file required: ${rel}` };
      }
      finalSt = st;
    } else if (!st.isDirectory()) {
      return {
        ok: false,
        error: `directory required: ${parts.slice(0, i + 1).join("/")}`,
      };
    }
  }
  if (finalSt && opts?.maxBytes !== undefined && finalSt.size > opts.maxBytes) {
    return {
      ok: false,
      error: `file size ${finalSt.size} exceeds max ${opts.maxBytes}: ${rel}`,
    };
  }
  const buf = await readFile(cur);
  if (opts?.maxBytes !== undefined && buf.byteLength > opts.maxBytes) {
    return {
      ok: false,
      error: `read size ${buf.byteLength} exceeds max ${opts.maxBytes}: ${rel}`,
    };
  }
  return { ok: true, abs: cur, bytes: new Uint8Array(buf) };
}

/**
 * Walk relative directory components under `root`, accepting only real
 * directories and rejecting symlink components at every level.
 */
export async function resolveTrustedRelativeDir(
  root: string,
  rel: string,
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  if (rel !== "" && rel !== "." && !isSafeRelativePath(rel)) {
    return { ok: false, error: `unsafe path ${rel}` };
  }
  const rootAbs = path.resolve(root);
  let rootSt;
  try {
    rootSt = await lstat(rootAbs);
  } catch {
    return { ok: false, error: `missing root ${root}` };
  }
  if (rootSt.isSymbolicLink()) {
    return { ok: false, error: `symlink rejected: ${root}` };
  }
  if (!rootSt.isDirectory()) {
    return { ok: false, error: `directory required: ${root}` };
  }
  if (rel === "" || rel === ".") {
    return { ok: true, abs: rootAbs };
  }
  let cur = rootAbs;
  for (const part of rel.split("/")) {
    cur = path.join(cur, part);
    if (!cur.startsWith(rootAbs + path.sep)) {
      return { ok: false, error: `path escapes root: ${rel}` };
    }
    let st;
    try {
      st = await lstat(cur);
    } catch {
      return { ok: false, error: `missing directory: ${rel}` };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, error: `symlink rejected: ${rel}` };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: `directory required: ${rel}` };
    }
  }
  return { ok: true, abs: cur };
}

/** Atomic write of tail-slack.json: temp regular file in the same directory, then rename. */
export async function writeArtifactAtomic(
  root: string,
  content: string,
): Promise<void> {
  const dirResolved = await resolveTrustedRelativeDir(root, CORPUS_REL);
  if (!dirResolved.ok) {
    throw new Error(dirResolved.error);
  }
  const abs = path.join(dirResolved.abs, path.posix.basename(ARTIFACT_REL));
  try {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) {
      // Replace the symlink node via rename without following it.
    } else if (!st.isFile()) {
      throw new Error(`refusing to write non-regular ${ARTIFACT_REL}`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code !== "ENOENT") throw e;
  }
  const tmp = path.join(
    dirResolved.abs,
    `.tail-slack.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(tmp, flags, 0o644);
    try {
      await fh.writeFile(content, "utf8");
    } finally {
      await fh.close();
    }
    await rename(tmp, abs);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // temp already gone
    }
    throw err;
  }
}

export async function loadCorpus(
  root: string,
): Promise<
  | {
      ok: true;
      fixtures: LoadedFixture[];
      comparisons: ManifestComparison[];
      sourceManifestSha256: string;
    }
  | { ok: false; diagnostics: string[] }
> {
  const diagnostics: string[] = [];
  const manRead = await resolveTrustedRelativeFile(root, MANIFEST_REL, {
    maxBytes: MANIFEST_MAX_BYTES,
  });
  if (!manRead.ok) return { ok: false, diagnostics: [manRead.error] };
  const sourceManifestSha256 = sha256Hex(manRead.bytes);

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manRead.bytes));
  } catch {
    return { ok: false, diagnostics: ["manifest.json: invalid JSON"] };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      diagnostics: ["manifest.json: root must be a plain object"],
    };
  }
  if (raw.corpus !== CORPUS_ID) {
    diagnostics.push(`manifest corpus ${String(raw.corpus)} != ${CORPUS_ID}`);
  }
  if (!Array.isArray(raw.fixtures)) {
    diagnostics.push("manifest: fixtures must be an array");
    return { ok: false, diagnostics };
  }
  if (!Array.isArray(raw.comparisons)) {
    diagnostics.push("manifest: comparisons must be an array");
    return { ok: false, diagnostics };
  }

  const fixtures: LoadedFixture[] = [];
  for (const entry of raw.fixtures) {
    if (!isPlainObject(entry)) {
      diagnostics.push("fixture entry must be a plain object");
      continue;
    }
    if (
      !isNonemptyString(entry.id) ||
      !isNonemptyString(entry.case_id) ||
      !isNonemptyString(entry.ros_distro) ||
      !isNonemptyString(entry.support_row_id)
    ) {
      diagnostics.push(
        `fixture entry requires nonempty string identities: ${JSON.stringify(entry.id)}`,
      );
      continue;
    }
    if (!isPlainObject(entry.serialized)) {
      diagnostics.push(`${entry.id}: serialized must be a plain object`);
      continue;
    }
    const serialized = entry.serialized;
    if (!isSafeNonnegInt(serialized.byte_length)) {
      diagnostics.push(
        `${entry.id}: byte_length must be a safe nonnegative integer`,
      );
      continue;
    }
    if (serialized.byte_length > BINARY_MAX_BYTES) {
      diagnostics.push(
        `${entry.id}: byte_length ${serialized.byte_length} exceeds max ${BINARY_MAX_BYTES}`,
      );
      continue;
    }
    if (!isLowerHexSha256(serialized.sha256)) {
      diagnostics.push(`${entry.id}: sha256 must be lowercase 64-hex`);
      continue;
    }
    if (
      !isNonemptyString(serialized.path) ||
      !isFixtureBinaryPath(serialized.path)
    ) {
      diagnostics.push(
        `${entry.id}: serialized path must be a safe relative path under fixtures/`,
      );
      continue;
    }
    const binRel = path.posix.join(CORPUS_REL, serialized.path);
    const bin = await resolveTrustedRelativeFile(root, binRel, {
      requireFixtureBinary: true,
      maxBytes: BINARY_MAX_BYTES,
    });
    if (!bin.ok) {
      diagnostics.push(`${entry.id}: ${bin.error}`);
      continue;
    }
    if (bin.bytes.length !== serialized.byte_length) {
      diagnostics.push(
        `${entry.id}: byte_length mismatch disk=${bin.bytes.length} manifest=${serialized.byte_length}`,
      );
      continue;
    }
    const digest = sha256Hex(bin.bytes);
    if (digest !== serialized.sha256) {
      diagnostics.push(`${entry.id}: sha256 mismatch`);
      continue;
    }
    fixtures.push({
      id: entry.id,
      case_id: entry.case_id,
      ros_distro: entry.ros_distro,
      support_row_id: entry.support_row_id,
      path: serialized.path,
      bytes: bin.bytes,
    });
  }

  const comparisons: ManifestComparison[] = [];
  for (const entry of raw.comparisons) {
    if (!isPlainObject(entry)) {
      diagnostics.push("comparison entry must be a plain object");
      continue;
    }
    if (
      !isNonemptyString(entry.case_id) ||
      !isNonemptyString(entry.ros_distro) ||
      !Array.isArray(entry.rows)
    ) {
      diagnostics.push(`comparison entry malformed: ${JSON.stringify(entry)}`);
      continue;
    }
    if (entry.rows.length === 0) {
      diagnostics.push(
        `comparison ${entry.ros_distro}/${entry.case_id}: support rows must be nonempty`,
      );
      continue;
    }
    const rows: string[] = [];
    let rowsOk = true;
    for (const row of entry.rows) {
      if (!isNonemptyString(row)) {
        diagnostics.push(
          `comparison ${entry.ros_distro}/${entry.case_id}: support row must be a nonempty string`,
        );
        rowsOk = false;
        break;
      }
      rows.push(row);
    }
    if (!rowsOk) continue;
    comparisons.push({
      case_id: entry.case_id,
      ros_distro: entry.ros_distro,
      rows,
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, fixtures, comparisons, sourceManifestSha256 };
}

export async function buildFromRoot(root: string): Promise<BuildResult> {
  const loaded = await loadCorpus(root);
  if (!loaded.ok) return loaded;
  const built = buildTailSlackModel(
    loaded.fixtures,
    loaded.comparisons,
    loaded.sourceManifestSha256,
  );
  if (!built.ok) return built;
  // Production callers apply enforceFrozenSummary.
  const frozen = enforceFrozenSummary(built.artifact);
  if (!frozen.ok) return frozen;
  return built;
}

export function formatStatusLine(artifact: TailSlackArtifact): string {
  const s = artifact.summary;
  return `cdr-tail-slack: status=ok fixtures=${s.fixtures} comparisons=${s.comparisons} exact=${s.exact_fixtures} four_byte=${s.four_byte_tail_fixtures} twelve_byte=${s.twelve_byte_tail_fixtures}`;
}

export async function runCli(
  args: string[],
  root = process.cwd(),
): Promise<number> {
  const parsed = parseCliMode(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const built = await buildFromRoot(root);
  if (!built.ok) {
    for (const d of built.diagnostics) console.error(d);
    console.error("cdr-tail-slack: status=fail");
    return 1;
  }
  if (parsed.mode === "write") {
    try {
      await writeArtifactAtomic(root, built.bytes);
    } catch (err) {
      console.error(
        `cdr-tail-slack: write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error("cdr-tail-slack: status=fail");
      return 1;
    }
    console.log(formatStatusLine(built.artifact));
    return 0;
  }
  const existing = await resolveTrustedRelativeFile(root, ARTIFACT_REL, {
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  if (!existing.ok) {
    console.error(existing.error);
    console.error("cdr-tail-slack: status=fail");
    return 1;
  }
  const committed = new TextDecoder().decode(existing.bytes);
  if (committed !== built.bytes) {
    console.error(
      "cdr-tail-slack: committed artifact differs from regenerated model",
    );
    console.error("cdr-tail-slack: status=fail");
    return 1;
  }
  console.log(formatStatusLine(built.artifact));
  return 0;
}

if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
