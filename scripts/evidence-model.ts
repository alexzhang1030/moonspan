/**
 * Shared qualification report v1 model (M0-05a).
 *
 * Pure enums, bounds, key arrays, regexes, and helpers used by runtime
 * validation, schema generation, and filesystem checks. This module is
 * pure data and pure functions; filesystem work stays in evidence-check.ts.
 */

import path from "node:path";

export const SCHEMA_VERSION = 1 as const;
export const REPORT_ID = "moonspan-qualification-report-v1" as const;
export const SCHEMA_REL = "evidence/schema/qualification-report-v1.json";
export const VALID_DIR_REL = "evidence/testdata/valid";

/** Report document and public schema file size ceiling. */
export const REPORT_MAX_BYTES = 256 * 1024;
export const SCHEMA_MAX_BYTES = 256 * 1024;
/**
 * Closed artifact payload ceiling for both document validation and I/O.
 * Schema `byte_length.maximum` and runtime reads share this bound.
 */
export const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const PATH_MAX_LENGTH = 512;
export const MEDIA_TYPE_MAX_LENGTH = 128;
export const TEXT_1 = 1;
export const TEXT_64 = 64;
export const TEXT_128 = 128;
export const TEXT_256 = 256;
export const TEXT_512 = 512;
export const TEXT_1024 = 1024;
export const TEXT_4096 = 4096;
export const MAP_MAX_32 = 32;
export const MAP_MAX_64 = 64;
export const ARRAY_MAX_64 = 64;
export const ARRAY_MAX_256 = 256;
export const DOMAIN_ID_MAX = 232;
export const DURATION_MAX_SECONDS = 2_592_000;
export const SAMPLE_COUNT_MAX = 100_000_000;
export const WARMUP_COUNT_MAX = 1_000_000;
/** Shared finite scalar number bounds for budgets/queues/resources. */
export const SAFE_NUMBER_MIN = -1e15;
export const SAFE_NUMBER_MAX = 1e15;
/** Relative path pattern matching resolveUnderRoot segment rules. */
export const PATH_RELATIVE_PATTERN =
  "^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$";

export const GATES = ["M0", "M1", "M2", "M3", "U0", "X0"] as const;
export const EVIDENCE_LEVELS = [
  "foundation",
  "N1",
  "N2",
  "N3",
  "operations",
  "security",
  "prototype",
] as const;
export const SUPPORT_ROWS = ["H-FT", "H-CY", "H-ZN", "J-FT", "J-CY", "J-ZN"] as const;
export const PLATFORMS = [
  "linux/arm64",
  "linux/amd64",
  "darwin/arm64",
  "darwin/amd64",
] as const;
export const ARTIFACT_ROLES = ["raw", "derived", "report"] as const;
export const DECISIONS = ["pending", "accept", "reject", "provisional"] as const;

/** Local gate → allowed evidence levels from docs/validation.md. */
export const GATE_EVIDENCE_LEVELS: Readonly<
  Record<(typeof GATES)[number], readonly (typeof EVIDENCE_LEVELS)[number][]>
> = {
  M0: ["foundation"],
  M1: ["N1"],
  M2: ["N2"],
  M3: ["operations", "security"],
  U0: ["prototype"],
  X0: ["N3"],
};

export const LEVELS_REQUIRING_SUPPORT_ROW = ["N1", "N2"] as const;

export const TOP_LEVEL_KEYS = [
  "schema_version",
  "report_id",
  "gate",
  "evidence_level",
  "identity",
  "provenance",
  "invocation",
  "artifacts",
  "measurements",
  "review",
] as const;

export const IDENTITY_KEYS = [
  "code_revision",
  "fixture_manifests",
  "package_versions",
  "image_digests",
  "environment",
] as const;

export const ENVIRONMENT_KEYS = [
  "environment_id",
  "platform",
  "toolchain",
  "attributes",
] as const;

export const PROVENANCE_KEYS = [
  "support_row_id",
  "gateway_instance_id",
  "domain_ids",
  "adapter_profile",
] as const;

export const INVOCATION_KEYS = [
  "commands",
  "workload",
  "budgets",
  "duration_seconds",
  "sample_count",
  "warmup_count",
  "variance",
] as const;

export const ARTIFACT_KEYS = [
  "role",
  "path",
  "sha256",
  "byte_length",
  "media_type",
  "retention_policy",
] as const;

export const MEASUREMENT_KEYS = [
  "timestamps",
  "queues",
  "resources",
  "errors",
  "dispositions",
] as const;

export const REVIEW_KEYS = [
  "decision",
  "reviewer",
  "decision_date",
  "known_limits",
] as const;

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const GIT_SHA_RE = /^[0-9a-f]{40}$/;
export const IMAGE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
export const MEDIA_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
export const PACKAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;
export const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const ENVIRONMENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const FIXTURE_CORPUS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSortedUniqueStrings(values: readonly string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (asciiCompare(values[i]!, values[i - 1]!) <= 0) return false;
  }
  return true;
}

export function isSortedUniqueNumbers(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) return false;
  }
  return true;
}

export function objectKeysSorted(obj: Record<string, unknown>): boolean {
  return isSortedUniqueStrings(Object.keys(obj));
}

export function isValidCalendarDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function resolveUnderRoot(
  root: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (typeof rel !== "string" || rel.length === 0) {
    return { ok: false, error: "empty path rejected" };
  }
  if (rel.length > PATH_MAX_LENGTH) {
    return { ok: false, error: `path length ${rel.length} exceeds ${PATH_MAX_LENGTH}` };
  }
  if (path.isAbsolute(rel)) return { ok: false, error: `absolute path rejected: ${rel}` };
  if (rel.includes("\0")) return { ok: false, error: "nul in path" };
  if (rel.includes("\\")) return { ok: false, error: "backslash path rejected" };
  if (rel.includes("//")) return { ok: false, error: `noncanonical relative path: ${rel}` };
  const segments = rel.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    return { ok: false, error: "dot segment or empty segment path rejected" };
  }
  if (!segments.every((part) => PATH_SEGMENT_RE.test(part))) {
    return { ok: false, error: `path segment rejected: ${rel}` };
  }
  if (!new RegExp(PATH_RELATIVE_PATTERN).test(rel)) {
    return { ok: false, error: `path pattern rejected: ${rel}` };
  }
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `path escapes root: ${rel}` };
  }
  return { ok: true, abs };
}

export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
