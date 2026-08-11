/**
 * Pure qualification report v1 contract (M0-05a).
 *
 * Single source of enums, bounds, JSON Schema 2020-12 generation, and document
 * validation. Filesystem I/O lives in evidence-check.ts.
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
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `path escapes root: ${rel}` };
  }
  return { ok: true, abs };
}

function push(diags: string[], message: string): void {
  diags.push(message);
}

function exactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  pathLabel: string,
  diags: string[],
  required?: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) push(diags, `${pathLabel}: unknown key "${key}"`);
  }
  if (required) {
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        push(diags, `${pathLabel}: missing key "${key}"`);
      }
    }
  }
}

function validateStringMap(
  value: unknown,
  pathLabel: string,
  diags: string[],
  opts: {
    min: number;
    max: number;
    keyMax: number;
    valueMax: number;
    keyPattern?: RegExp;
    valuePattern?: RegExp;
  },
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length < opts.min || keys.length > opts.max) {
    push(diags, `${pathLabel}: entry count ${keys.length} outside ${opts.min}..${opts.max}`);
  }
  if (!objectKeysSorted(value)) {
    push(diags, `${pathLabel}: keys must be sorted unique ascending`);
  }
  for (const key of keys) {
    if (key.length === 0 || key.length > opts.keyMax) {
      push(diags, `${pathLabel}: key length out of bounds for "${key}"`);
    }
    if (opts.keyPattern && !opts.keyPattern.test(key)) {
      push(diags, `${pathLabel}: key rejected "${key}"`);
    }
    const entry = value[key];
    if (typeof entry !== "string") {
      push(diags, `${pathLabel}.${key}: must be string`);
      continue;
    }
    if (entry.length === 0 || entry.length > opts.valueMax) {
      push(diags, `${pathLabel}.${key}: length out of bounds`);
    }
    if (opts.valuePattern && !opts.valuePattern.test(entry)) {
      push(diags, `${pathLabel}.${key}: value rejected`);
    }
  }
}

function validateScalarMap(
  value: unknown,
  pathLabel: string,
  diags: string[],
  opts: {
    max: number;
    keyMax: number;
    stringMax: number;
    allowBoolean: boolean;
    allowNumber: boolean;
    requireString?: boolean;
  },
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > opts.max) push(diags, `${pathLabel}: too many entries`);
  if (!objectKeysSorted(value)) {
    push(diags, `${pathLabel}: keys must be sorted unique ascending`);
  }
  for (const key of keys) {
    if (key.length === 0 || key.length > opts.keyMax) {
      push(diags, `${pathLabel}: key length out of bounds for "${key}"`);
    }
    const entry = value[key];
    if (opts.requireString) {
      if (typeof entry !== "string" || entry.length < 1 || entry.length > opts.stringMax) {
        push(diags, `${pathLabel}.${key}: requires non-empty string within bounds`);
      }
      continue;
    }
    if (typeof entry === "string") {
      if (entry.length < 1 || entry.length > opts.stringMax) {
        push(diags, `${pathLabel}.${key}: string length out of bounds`);
      }
      continue;
    }
    if (opts.allowNumber && typeof entry === "number") {
      if (!Number.isFinite(entry) || entry < -1e15 || entry > 1e15) {
        push(diags, `${pathLabel}.${key}: number out of safe bounds`);
      }
      continue;
    }
    if (opts.allowBoolean && typeof entry === "boolean") continue;
    push(diags, `${pathLabel}.${key}: invalid scalar type`);
  }
}

function validateIdentity(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, IDENTITY_KEYS, pathLabel, diags, IDENTITY_KEYS);
  if (typeof value.code_revision !== "string" || !GIT_SHA_RE.test(value.code_revision)) {
    push(diags, `${pathLabel}.code_revision: requires 40 lowercase hex`);
  }
  validateStringMap(value.fixture_manifests, `${pathLabel}.fixture_manifests`, diags, {
    min: 1,
    max: MAP_MAX_32,
    keyMax: TEXT_64,
    valueMax: 64,
    keyPattern: FIXTURE_CORPUS_ID_RE,
    valuePattern: SHA256_RE,
  });
  validateStringMap(value.package_versions, `${pathLabel}.package_versions`, diags, {
    min: 1,
    max: MAP_MAX_64,
    keyMax: TEXT_128,
    valueMax: TEXT_256,
    keyPattern: PACKAGE_NAME_RE,
  });
  // Empty image digests are valid for non-container environments.
  validateStringMap(value.image_digests, `${pathLabel}.image_digests`, diags, {
    min: 0,
    max: MAP_MAX_32,
    keyMax: TEXT_128,
    valueMax: 71,
    valuePattern: IMAGE_DIGEST_RE,
  });
  if (!isPlainObject(value.environment)) {
    push(diags, `${pathLabel}.environment: must be an object`);
    return;
  }
  exactKeys(
    value.environment,
    ENVIRONMENT_KEYS,
    `${pathLabel}.environment`,
    diags,
    ["environment_id", "platform", "toolchain"],
  );
  if (
    typeof value.environment.environment_id !== "string" ||
    !ENVIRONMENT_ID_RE.test(value.environment.environment_id)
  ) {
    push(diags, `${pathLabel}.environment.environment_id: invalid sanitized identity`);
  }
  if (
    typeof value.environment.platform !== "string" ||
    !(PLATFORMS as readonly string[]).includes(value.environment.platform)
  ) {
    push(diags, `${pathLabel}.environment.platform: invalid enum`);
  }
  validateStringMap(
    value.environment.toolchain,
    `${pathLabel}.environment.toolchain`,
    diags,
    { min: 1, max: 16, keyMax: TEXT_64, valueMax: TEXT_128 },
  );
  if (value.environment.attributes !== undefined) {
    validateStringMap(
      value.environment.attributes,
      `${pathLabel}.environment.attributes`,
      diags,
      { min: 0, max: MAP_MAX_32, keyMax: TEXT_64, valueMax: TEXT_256 },
    );
  }
}

function validateProvenance(
  value: unknown,
  pathLabel: string,
  diags: string[],
  requireSupportRow: boolean,
): void {
  if (value === undefined) {
    if (requireSupportRow) {
      push(diags, `${pathLabel}.support_row_id: required for N1/N2 evidence levels`);
    }
    return;
  }
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, PROVENANCE_KEYS, pathLabel, diags);
  if (requireSupportRow && value.support_row_id === undefined) {
    push(diags, `${pathLabel}.support_row_id: required for N1/N2 evidence levels`);
  }
  if (value.support_row_id !== undefined) {
    if (
      typeof value.support_row_id !== "string" ||
      !(SUPPORT_ROWS as readonly string[]).includes(value.support_row_id)
    ) {
      push(diags, `${pathLabel}.support_row_id: invalid enum`);
    }
  }
  if (value.gateway_instance_id !== undefined) {
    if (
      typeof value.gateway_instance_id !== "string" ||
      value.gateway_instance_id.length < TEXT_1 ||
      value.gateway_instance_id.length > TEXT_128
    ) {
      push(diags, `${pathLabel}.gateway_instance_id: length out of bounds`);
    }
  }
  if (value.domain_ids !== undefined) {
    if (
      !Array.isArray(value.domain_ids) ||
      value.domain_ids.length < 1 ||
      value.domain_ids.length > ARRAY_MAX_64
    ) {
      push(diags, `${pathLabel}.domain_ids: length outside 1..${ARRAY_MAX_64}`);
    } else {
      const nums: number[] = [];
      for (const [i, item] of value.domain_ids.entries()) {
        if (
          typeof item !== "number" ||
          !Number.isInteger(item) ||
          item < 0 ||
          item > DOMAIN_ID_MAX
        ) {
          push(diags, `${pathLabel}.domain_ids[${i}]: invalid domain id`);
        } else nums.push(item);
      }
      if (nums.length === value.domain_ids.length && !isSortedUniqueNumbers(nums)) {
        push(diags, `${pathLabel}.domain_ids: must be sorted unique ascending`);
      }
    }
  }
  if (value.adapter_profile !== undefined) {
    if (
      typeof value.adapter_profile !== "string" ||
      value.adapter_profile.length < TEXT_1 ||
      value.adapter_profile.length > TEXT_128
    ) {
      push(diags, `${pathLabel}.adapter_profile: length out of bounds`);
    }
  }
}

function validateInvocation(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, INVOCATION_KEYS, pathLabel, diags, [
    "commands",
    "workload",
    "budgets",
    "duration_seconds",
    "sample_count",
    "warmup_count",
  ]);
  if (
    !Array.isArray(value.commands) ||
    value.commands.length < 1 ||
    value.commands.length > ARRAY_MAX_64
  ) {
    push(diags, `${pathLabel}.commands: length outside 1..${ARRAY_MAX_64}`);
  } else {
    for (const [i, cmd] of value.commands.entries()) {
      if (typeof cmd !== "string" || cmd.length < TEXT_1 || cmd.length > TEXT_1024) {
        push(diags, `${pathLabel}.commands[${i}]: invalid command`);
      }
    }
  }
  if (
    typeof value.workload !== "string" ||
    value.workload.length < TEXT_1 ||
    value.workload.length > TEXT_4096
  ) {
    push(diags, `${pathLabel}.workload: length out of bounds`);
  }
  validateScalarMap(value.budgets, `${pathLabel}.budgets`, diags, {
    max: MAP_MAX_32,
    keyMax: TEXT_64,
    stringMax: TEXT_256,
    allowBoolean: true,
    allowNumber: true,
  });
  if (isPlainObject(value.budgets) && Object.keys(value.budgets).length < 1) {
    push(diags, `${pathLabel}.budgets: requires at least one entry`);
  }
  if (
    typeof value.duration_seconds !== "number" ||
    !Number.isFinite(value.duration_seconds) ||
    value.duration_seconds < 0 ||
    value.duration_seconds > DURATION_MAX_SECONDS
  ) {
    push(diags, `${pathLabel}.duration_seconds: out of bounds`);
  }
  if (
    typeof value.sample_count !== "number" ||
    !Number.isInteger(value.sample_count) ||
    value.sample_count < 0 ||
    value.sample_count > SAMPLE_COUNT_MAX
  ) {
    push(diags, `${pathLabel}.sample_count: out of bounds`);
  }
  if (
    typeof value.warmup_count !== "number" ||
    !Number.isInteger(value.warmup_count) ||
    value.warmup_count < 0 ||
    value.warmup_count > WARMUP_COUNT_MAX
  ) {
    push(diags, `${pathLabel}.warmup_count: out of bounds`);
  }
  if (value.variance !== undefined) {
    if (
      typeof value.variance !== "string" ||
      value.variance.length < TEXT_1 ||
      value.variance.length > TEXT_1024
    ) {
      push(diags, `${pathLabel}.variance: length out of bounds`);
    }
  }
}

function validateMeasurements(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, MEASUREMENT_KEYS, pathLabel, diags, ["errors", "dispositions"]);
  if (value.timestamps !== undefined) {
    validateScalarMap(value.timestamps, `${pathLabel}.timestamps`, diags, {
      max: MAP_MAX_32,
      keyMax: TEXT_64,
      stringMax: TEXT_64,
      allowBoolean: false,
      allowNumber: false,
      requireString: true,
    });
  }
  if (value.queues !== undefined) {
    validateScalarMap(value.queues, `${pathLabel}.queues`, diags, {
      max: MAP_MAX_32,
      keyMax: TEXT_64,
      stringMax: TEXT_256,
      allowBoolean: true,
      allowNumber: true,
    });
  }
  if (value.resources !== undefined) {
    validateScalarMap(value.resources, `${pathLabel}.resources`, diags, {
      max: MAP_MAX_32,
      keyMax: TEXT_64,
      stringMax: TEXT_256,
      allowBoolean: true,
      allowNumber: true,
    });
  }
  if (!Array.isArray(value.errors) || value.errors.length > ARRAY_MAX_256) {
    push(diags, `${pathLabel}.errors: length outside 0..${ARRAY_MAX_256}`);
  } else {
    for (const [i, err] of value.errors.entries()) {
      if (!isPlainObject(err)) {
        push(diags, `${pathLabel}.errors[${i}]: must be an object`);
        continue;
      }
      exactKeys(err, ["code", "message"], `${pathLabel}.errors[${i}]`, diags, [
        "code",
        "message",
      ]);
      if (typeof err.code !== "string" || err.code.length < TEXT_1 || err.code.length > TEXT_64) {
        push(diags, `${pathLabel}.errors[${i}].code: invalid`);
      }
      if (
        typeof err.message !== "string" ||
        err.message.length < TEXT_1 ||
        err.message.length > TEXT_1024
      ) {
        push(diags, `${pathLabel}.errors[${i}].message: invalid`);
      }
    }
  }
  if (!Array.isArray(value.dispositions) || value.dispositions.length > ARRAY_MAX_256) {
    push(diags, `${pathLabel}.dispositions: length outside 0..${ARRAY_MAX_256}`);
  } else {
    const names: string[] = [];
    for (const [i, item] of value.dispositions.entries()) {
      if (!isPlainObject(item)) {
        push(diags, `${pathLabel}.dispositions[${i}]: must be an object`);
        continue;
      }
      exactKeys(item, ["name", "count"], `${pathLabel}.dispositions[${i}]`, diags, [
        "name",
        "count",
      ]);
      if (typeof item.name !== "string" || item.name.length < TEXT_1 || item.name.length > TEXT_64) {
        push(diags, `${pathLabel}.dispositions[${i}].name: invalid`);
      } else names.push(item.name);
      if (
        typeof item.count !== "number" ||
        !Number.isInteger(item.count) ||
        item.count < 0 ||
        item.count > SAMPLE_COUNT_MAX
      ) {
        push(diags, `${pathLabel}.dispositions[${i}].count: invalid`);
      }
    }
    if (names.length === value.dispositions.length && !isSortedUniqueStrings(names)) {
      push(diags, `${pathLabel}.dispositions: names must be sorted unique ascending`);
    }
  }
}

function validateReview(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, REVIEW_KEYS, pathLabel, diags, ["decision", "known_limits"]);
  if (typeof value.decision !== "string" || !(DECISIONS as readonly string[]).includes(value.decision)) {
    push(diags, `${pathLabel}.decision: invalid enum`);
    return;
  }
  if (value.decision === "pending") {
    if (value.reviewer !== undefined) {
      push(diags, `${pathLabel}.reviewer: must be absent when decision is pending`);
    }
    if (value.decision_date !== undefined) {
      push(diags, `${pathLabel}.decision_date: must be absent when decision is pending`);
    }
  } else {
    if (
      typeof value.reviewer !== "string" ||
      value.reviewer.length < TEXT_1 ||
      value.reviewer.length > TEXT_128
    ) {
      push(diags, `${pathLabel}.reviewer: required for human decisions`);
    }
    if (typeof value.decision_date !== "string" || !isValidCalendarDate(value.decision_date)) {
      push(diags, `${pathLabel}.decision_date: requires valid YYYY-MM-DD calendar date`);
    }
  }
  if (!Array.isArray(value.known_limits) || value.known_limits.length > ARRAY_MAX_64) {
    push(diags, `${pathLabel}.known_limits: length outside 0..${ARRAY_MAX_64}`);
  } else {
    for (const [i, item] of value.known_limits.entries()) {
      if (typeof item !== "string" || item.length < TEXT_1 || item.length > TEXT_1024) {
        push(diags, `${pathLabel}.known_limits[${i}]: invalid`);
      }
    }
  }
}

export function validateReportDocument(
  value: unknown,
  pathLabel = "report",
): string[] {
  const diags: string[] = [];
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: JSON root must be an object`);
    return diags;
  }
  exactKeys(
    value,
    TOP_LEVEL_KEYS,
    pathLabel,
    diags,
    [
      "schema_version",
      "report_id",
      "gate",
      "evidence_level",
      "identity",
      "invocation",
      "artifacts",
      "measurements",
      "review",
    ],
  );
  if (value.schema_version !== SCHEMA_VERSION) {
    push(diags, `${pathLabel}.schema_version: must be ${SCHEMA_VERSION}`);
  }
  if (value.report_id !== REPORT_ID) {
    push(diags, `${pathLabel}.report_id: must be ${REPORT_ID}`);
  }
  const gateOk =
    typeof value.gate === "string" && (GATES as readonly string[]).includes(value.gate);
  const levelOk =
    typeof value.evidence_level === "string" &&
    (EVIDENCE_LEVELS as readonly string[]).includes(value.evidence_level);
  if (!gateOk) push(diags, `${pathLabel}.gate: invalid enum`);
  if (!levelOk) push(diags, `${pathLabel}.evidence_level: invalid enum`);
  if (gateOk && levelOk) {
    const allowed = GATE_EVIDENCE_LEVELS[value.gate as (typeof GATES)[number]];
    if (!allowed.includes(value.evidence_level as (typeof EVIDENCE_LEVELS)[number])) {
      push(
        diags,
        `${pathLabel}: gate ${value.gate} does not allow evidence_level ${value.evidence_level}`,
      );
    }
  }
  validateIdentity(value.identity, `${pathLabel}.identity`, diags);
  const requireSupportRow =
    levelOk &&
    (LEVELS_REQUIRING_SUPPORT_ROW as readonly string[]).includes(
      value.evidence_level as string,
    );
  validateProvenance(value.provenance, `${pathLabel}.provenance`, diags, requireSupportRow);
  validateInvocation(value.invocation, `${pathLabel}.invocation`, diags);
  validateMeasurements(value.measurements, `${pathLabel}.measurements`, diags);
  validateReview(value.review, `${pathLabel}.review`, diags);

  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    value.artifacts.length > ARRAY_MAX_64
  ) {
    push(diags, `${pathLabel}.artifacts: length outside 1..${ARRAY_MAX_64}`);
  } else {
    const paths: string[] = [];
    for (const [i, art] of value.artifacts.entries()) {
      const p = `${pathLabel}.artifacts[${i}]`;
      if (!isPlainObject(art)) {
        push(diags, `${p}: must be an object`);
        continue;
      }
      exactKeys(art, ARTIFACT_KEYS, p, diags, ARTIFACT_KEYS);
      if (
        typeof art.role !== "string" ||
        !(ARTIFACT_ROLES as readonly string[]).includes(art.role)
      ) {
        push(diags, `${p}.role: invalid enum`);
      }
      if (typeof art.path !== "string") {
        push(diags, `${p}.path: must be string`);
      } else {
        const resolved = resolveUnderRoot("/virtual-root", art.path);
        if (!resolved.ok) push(diags, `${p}.path: ${resolved.error}`);
        paths.push(art.path);
      }
      if (typeof art.sha256 !== "string" || !SHA256_RE.test(art.sha256)) {
        push(diags, `${p}.sha256: requires 64 lowercase hex`);
      }
      if (
        typeof art.byte_length !== "number" ||
        !Number.isInteger(art.byte_length) ||
        art.byte_length < 0 ||
        art.byte_length > ARTIFACT_MAX_BYTES
      ) {
        push(diags, `${p}.byte_length: out of bounds 0..${ARTIFACT_MAX_BYTES}`);
      }
      if (
        typeof art.media_type !== "string" ||
        art.media_type.length > MEDIA_TYPE_MAX_LENGTH ||
        !MEDIA_TYPE_RE.test(art.media_type)
      ) {
        push(diags, `${p}.media_type: invalid`);
      }
      if (
        typeof art.retention_policy !== "string" ||
        art.retention_policy.length < TEXT_1 ||
        art.retention_policy.length > TEXT_128
      ) {
        push(diags, `${p}.retention_policy: length out of bounds`);
      }
    }
    if (paths.length === value.artifacts.length && !isSortedUniqueStrings(paths)) {
      push(diags, `${pathLabel}.artifacts: paths must be sorted unique ascending`);
    }
  }
  return diags;
}

/** Build the public JSON Schema 2020-12 document from contract constants. */
export function buildQualificationReportSchema(): Record<string, unknown> {
  const stringBounds = (min: number, max: number) => ({
    type: "string",
    minLength: min,
    maxLength: max,
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://moonspan.dev/schemas/qualification-report-v1.json",
    title: "Moonspan qualification report v1",
    description:
      "Closed machine-readable qualification evidence contract for Moonspan gates. Generated from scripts/evidence-contract.ts; the Bun checker enforces the same constants.",
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "report_id",
      "gate",
      "evidence_level",
      "identity",
      "invocation",
      "artifacts",
      "measurements",
      "review",
    ],
    properties: {
      schema_version: { type: "integer", const: SCHEMA_VERSION },
      report_id: { type: "string", const: REPORT_ID },
      gate: { type: "string", enum: [...GATES] },
      evidence_level: { type: "string", enum: [...EVIDENCE_LEVELS] },
      identity: {
        type: "object",
        additionalProperties: false,
        required: [...IDENTITY_KEYS],
        properties: {
          code_revision: { type: "string", pattern: GIT_SHA_RE.source },
          fixture_manifests: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_32,
            propertyNames: {
              type: "string",
              minLength: 1,
              maxLength: TEXT_64,
              pattern: FIXTURE_CORPUS_ID_RE.source,
            },
            additionalProperties: {
              type: "string",
              pattern: SHA256_RE.source,
            },
          },
          package_versions: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_64,
            propertyNames: {
              type: "string",
              minLength: 1,
              maxLength: TEXT_128,
              pattern: PACKAGE_NAME_RE.source,
            },
            additionalProperties: stringBounds(TEXT_1, TEXT_256),
          },
          image_digests: {
            type: "object",
            minProperties: 0,
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_128),
            additionalProperties: {
              type: "string",
              pattern: IMAGE_DIGEST_RE.source,
            },
          },
          environment: {
            type: "object",
            additionalProperties: false,
            required: ["environment_id", "platform", "toolchain"],
            properties: {
              environment_id: {
                type: "string",
                pattern: ENVIRONMENT_ID_RE.source,
              },
              platform: { type: "string", enum: [...PLATFORMS] },
              toolchain: {
                type: "object",
                minProperties: 1,
                maxProperties: 16,
                propertyNames: stringBounds(TEXT_1, TEXT_64),
                additionalProperties: stringBounds(TEXT_1, TEXT_128),
              },
              attributes: {
                type: "object",
                minProperties: 0,
                maxProperties: MAP_MAX_32,
                propertyNames: stringBounds(TEXT_1, TEXT_64),
                additionalProperties: stringBounds(TEXT_1, TEXT_256),
              },
            },
          },
        },
      },
      provenance: {
        type: "object",
        additionalProperties: false,
        properties: {
          support_row_id: { type: "string", enum: [...SUPPORT_ROWS] },
          gateway_instance_id: stringBounds(TEXT_1, TEXT_128),
          domain_ids: {
            type: "array",
            minItems: 1,
            maxItems: ARRAY_MAX_64,
            uniqueItems: true,
            items: { type: "integer", minimum: 0, maximum: DOMAIN_ID_MAX },
          },
          adapter_profile: stringBounds(TEXT_1, TEXT_128),
        },
      },
      invocation: {
        type: "object",
        additionalProperties: false,
        required: [
          "commands",
          "workload",
          "budgets",
          "duration_seconds",
          "sample_count",
          "warmup_count",
        ],
        properties: {
          commands: {
            type: "array",
            minItems: 1,
            maxItems: ARRAY_MAX_64,
            items: stringBounds(TEXT_1, TEXT_1024),
          },
          workload: stringBounds(TEXT_1, TEXT_4096),
          budgets: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: {
              type: ["string", "number", "boolean"],
              maxLength: TEXT_256,
            },
          },
          duration_seconds: {
            type: "number",
            minimum: 0,
            maximum: DURATION_MAX_SECONDS,
          },
          sample_count: {
            type: "integer",
            minimum: 0,
            maximum: SAMPLE_COUNT_MAX,
          },
          warmup_count: {
            type: "integer",
            minimum: 0,
            maximum: WARMUP_COUNT_MAX,
          },
          variance: stringBounds(TEXT_1, TEXT_1024),
        },
      },
      artifacts: {
        type: "array",
        minItems: 1,
        maxItems: ARRAY_MAX_64,
        items: {
          type: "object",
          additionalProperties: false,
          required: [...ARTIFACT_KEYS],
          properties: {
            role: { type: "string", enum: [...ARTIFACT_ROLES] },
            path: {
              type: "string",
              minLength: TEXT_1,
              maxLength: PATH_MAX_LENGTH,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
            },
            sha256: { type: "string", pattern: SHA256_RE.source },
            byte_length: {
              type: "integer",
              minimum: 0,
              maximum: ARTIFACT_MAX_BYTES,
            },
            media_type: {
              type: "string",
              minLength: 3,
              maxLength: MEDIA_TYPE_MAX_LENGTH,
              pattern: MEDIA_TYPE_RE.source,
            },
            retention_policy: stringBounds(TEXT_1, TEXT_128),
          },
        },
      },
      measurements: {
        type: "object",
        additionalProperties: false,
        required: ["errors", "dispositions"],
        properties: {
          timestamps: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: stringBounds(TEXT_1, TEXT_64),
          },
          queues: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: {
              type: ["number", "string", "boolean"],
              maxLength: TEXT_256,
            },
          },
          resources: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: {
              type: ["number", "string", "boolean"],
              maxLength: TEXT_256,
            },
          },
          errors: {
            type: "array",
            maxItems: ARRAY_MAX_256,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: {
                code: stringBounds(TEXT_1, TEXT_64),
                message: stringBounds(TEXT_1, TEXT_1024),
              },
            },
          },
          dispositions: {
            type: "array",
            maxItems: ARRAY_MAX_256,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "count"],
              properties: {
                name: stringBounds(TEXT_1, TEXT_64),
                count: {
                  type: "integer",
                  minimum: 0,
                  maximum: SAMPLE_COUNT_MAX,
                },
              },
            },
          },
        },
      },
      review: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "known_limits"],
        properties: {
          decision: { type: "string", enum: [...DECISIONS] },
          reviewer: stringBounds(TEXT_1, TEXT_128),
          decision_date: {
            type: "string",
            pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          },
          known_limits: {
            type: "array",
            maxItems: ARRAY_MAX_64,
            items: stringBounds(TEXT_1, TEXT_1024),
          },
        },
        allOf: [
          {
            if: { properties: { decision: { const: "pending" } }, required: ["decision"] },
            then: {
              not: {
                anyOf: [{ required: ["reviewer"] }, { required: ["decision_date"] }],
              },
            },
            else: {
              required: ["reviewer", "decision_date"],
            },
          },
        ],
      },
    },
  };
}

export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function schemaCanonicalBytes(): string {
  return stableJsonPretty(buildQualificationReportSchema());
}
