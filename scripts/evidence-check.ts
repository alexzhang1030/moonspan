#!/usr/bin/env bun
/**
 * Moonspan qualification report v1 checker (M0-05a).
 *
 * Dependency-free Bun/TypeScript validation of the closed report contract under
 * evidence/. Treats report JSON and referenced artifacts as untrusted input.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type EvidenceCheckResult = {
  ok: boolean;
  diagnostics: string[];
  summary: string;
  reports: number;
};

export const SCHEMA_VERSION = 1;
export const REPORT_ID = "moonspan-qualification-report-v1";
export const SCHEMA_REL = "evidence/schema/qualification-report-v1.json";
export const VALID_DIR_REL = "evidence/testdata/valid";
export const REPORT_MAX_BYTES = 256 * 1024;
export const ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const SCHEMA_MAX_BYTES = 256 * 1024;

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
export const DECISIONS = ["accept", "reject", "provisional"] as const;

const TOP_LEVEL_KEYS = [
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

const IDENTITY_KEYS = [
  "code_revision",
  "fixture_manifest_sha256",
  "package_versions",
  "image_digests",
  "environment",
] as const;

const PROVENANCE_KEYS = [
  "support_row_id",
  "gateway_instance_id",
  "domain_ids",
  "adapter_profile",
] as const;

const INVOCATION_KEYS = [
  "commands",
  "workload",
  "budgets",
  "duration_seconds",
  "sample_count",
  "warmup_count",
  "variance",
] as const;

const ARTIFACT_KEYS = [
  "role",
  "path",
  "sha256",
  "byte_length",
  "media_type",
  "retention_policy",
] as const;

const MEASUREMENT_KEYS = [
  "timestamps",
  "queues",
  "resources",
  "errors",
  "dispositions",
] as const;

const REVIEW_KEYS = [
  "reviewer",
  "decision",
  "decision_date",
  "known_limits",
] as const;

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const PACKAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function push(diags: string[], message: string): void {
  diags.push(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isSortedUniqueStrings(values: string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) return false;
  }
  return true;
}

function isSortedUniqueNumbers(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) return false;
  }
  return true;
}

function objectKeysSorted(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  return isSortedUniqueStrings(keys);
}

export function resolveUnderRoot(
  root: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (typeof rel !== "string" || rel.length === 0) {
    return { ok: false, error: "empty path rejected" };
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

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function validateBudgetMap(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > 32) {
    push(diags, `${pathLabel}: entry count outside 1..32`);
  }
  if (!objectKeysSorted(value)) {
    push(diags, `${pathLabel}: keys must be sorted unique ascending`);
  }
  for (const key of keys) {
    if (key.length === 0 || key.length > 64) {
      push(diags, `${pathLabel}: key length out of bounds for "${key}"`);
    }
    const entry = value[key];
    const okType =
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      (typeof entry === "string" && entry.length > 0 && entry.length <= 256);
    if (!okType) push(diags, `${pathLabel}.${key}: invalid scalar`);
    if (typeof entry === "number" && !Number.isFinite(entry)) {
      push(diags, `${pathLabel}.${key}: non-finite number`);
    }
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
  if (
    typeof value.fixture_manifest_sha256 !== "string" ||
    !SHA256_RE.test(value.fixture_manifest_sha256)
  ) {
    push(diags, `${pathLabel}.fixture_manifest_sha256: requires 64 lowercase hex`);
  }
  validateStringMap(value.package_versions, `${pathLabel}.package_versions`, diags, {
    min: 1,
    max: 64,
    keyMax: 128,
    valueMax: 256,
    keyPattern: PACKAGE_NAME_RE,
  });
  validateStringMap(value.image_digests, `${pathLabel}.image_digests`, diags, {
    min: 1,
    max: 32,
    keyMax: 128,
    valueMax: 71,
    valuePattern: IMAGE_DIGEST_RE,
  });
  if (!isPlainObject(value.environment)) {
    push(diags, `${pathLabel}.environment: must be an object`);
  } else {
    exactKeys(
      value.environment,
      ["platform", "toolchain"],
      `${pathLabel}.environment`,
      diags,
      ["platform", "toolchain"],
    );
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
      { min: 1, max: 16, keyMax: 64, valueMax: 128 },
    );
  }
}

function validateProvenance(
  value: unknown,
  pathLabel: string,
  diags: string[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    push(diags, `${pathLabel}: must be an object`);
    return;
  }
  exactKeys(value, PROVENANCE_KEYS, pathLabel, diags);
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
      value.gateway_instance_id.length < 1 ||
      value.gateway_instance_id.length > 128
    ) {
      push(diags, `${pathLabel}.gateway_instance_id: length out of bounds`);
    }
  }
  if (value.domain_ids !== undefined) {
    if (!Array.isArray(value.domain_ids) || value.domain_ids.length < 1 || value.domain_ids.length > 64) {
      push(diags, `${pathLabel}.domain_ids: length outside 1..64`);
    } else {
      const nums: number[] = [];
      for (const [i, item] of value.domain_ids.entries()) {
        if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 232) {
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
      value.adapter_profile.length < 1 ||
      value.adapter_profile.length > 128
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
  if (!Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 64) {
    push(diags, `${pathLabel}.commands: length outside 1..64`);
  } else {
    for (const [i, cmd] of value.commands.entries()) {
      if (typeof cmd !== "string" || cmd.length < 1 || cmd.length > 1024) {
        push(diags, `${pathLabel}.commands[${i}]: invalid command`);
      }
    }
  }
  if (typeof value.workload !== "string" || value.workload.length < 1 || value.workload.length > 4096) {
    push(diags, `${pathLabel}.workload: length out of bounds`);
  }
  validateBudgetMap(value.budgets, `${pathLabel}.budgets`, diags);
  if (
    typeof value.duration_seconds !== "number" ||
    !Number.isFinite(value.duration_seconds) ||
    value.duration_seconds < 0 ||
    value.duration_seconds > 2_592_000
  ) {
    push(diags, `${pathLabel}.duration_seconds: out of bounds`);
  }
  for (const key of ["sample_count", "warmup_count"] as const) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      push(diags, `${pathLabel}.${key}: requires non-negative integer`);
    }
  }
  if (typeof value.sample_count === "number" && value.sample_count > 100_000_000) {
    push(diags, `${pathLabel}.sample_count: exceeds maximum`);
  }
  if (typeof value.warmup_count === "number" && value.warmup_count > 1_000_000) {
    push(diags, `${pathLabel}.warmup_count: exceeds maximum`);
  }
  if (value.variance !== undefined) {
    if (typeof value.variance !== "string" || value.variance.length < 1 || value.variance.length > 1024) {
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
  for (const mapKey of ["timestamps", "queues", "resources"] as const) {
    if (value[mapKey] === undefined) continue;
    if (!isPlainObject(value[mapKey])) {
      push(diags, `${pathLabel}.${mapKey}: must be an object`);
      continue;
    }
    const keys = Object.keys(value[mapKey] as Record<string, unknown>);
    if (keys.length > 32) push(diags, `${pathLabel}.${mapKey}: too many entries`);
    if (!objectKeysSorted(value[mapKey] as Record<string, unknown>)) {
      push(diags, `${pathLabel}.${mapKey}: keys must be sorted unique ascending`);
    }
  }
  if (!Array.isArray(value.errors) || value.errors.length > 256) {
    push(diags, `${pathLabel}.errors: length outside 0..256`);
  } else {
    for (const [i, err] of value.errors.entries()) {
      if (!isPlainObject(err)) {
        push(diags, `${pathLabel}.errors[${i}]: must be an object`);
        continue;
      }
      exactKeys(err, ["code", "message"], `${pathLabel}.errors[${i}]`, diags, ["code", "message"]);
      if (typeof err.code !== "string" || err.code.length < 1 || err.code.length > 64) {
        push(diags, `${pathLabel}.errors[${i}].code: invalid`);
      }
      if (typeof err.message !== "string" || err.message.length < 1 || err.message.length > 1024) {
        push(diags, `${pathLabel}.errors[${i}].message: invalid`);
      }
    }
  }
  if (!Array.isArray(value.dispositions) || value.dispositions.length > 256) {
    push(diags, `${pathLabel}.dispositions: length outside 0..256`);
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
      if (typeof item.name !== "string" || item.name.length < 1 || item.name.length > 64) {
        push(diags, `${pathLabel}.dispositions[${i}].name: invalid`);
      } else names.push(item.name);
      if (
        typeof item.count !== "number" ||
        !Number.isInteger(item.count) ||
        item.count < 0 ||
        item.count > 100_000_000
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
  exactKeys(value, REVIEW_KEYS, pathLabel, diags, REVIEW_KEYS);
  if (typeof value.reviewer !== "string" || value.reviewer.length < 1 || value.reviewer.length > 128) {
    push(diags, `${pathLabel}.reviewer: length out of bounds`);
  }
  if (typeof value.decision !== "string" || !(DECISIONS as readonly string[]).includes(value.decision)) {
    push(diags, `${pathLabel}.decision: invalid enum`);
  }
  if (typeof value.decision_date !== "string" || !DATE_RE.test(value.decision_date)) {
    push(diags, `${pathLabel}.decision_date: requires YYYY-MM-DD`);
  }
  if (!Array.isArray(value.known_limits) || value.known_limits.length > 64) {
    push(diags, `${pathLabel}.known_limits: length outside 0..64`);
  } else {
    for (const [i, item] of value.known_limits.entries()) {
      if (typeof item !== "string" || item.length < 1 || item.length > 1024) {
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
  if (typeof value.gate !== "string" || !(GATES as readonly string[]).includes(value.gate)) {
    push(diags, `${pathLabel}.gate: invalid enum`);
  }
  if (
    typeof value.evidence_level !== "string" ||
    !(EVIDENCE_LEVELS as readonly string[]).includes(value.evidence_level)
  ) {
    push(diags, `${pathLabel}.evidence_level: invalid enum`);
  }
  validateIdentity(value.identity, `${pathLabel}.identity`, diags);
  validateProvenance(value.provenance, `${pathLabel}.provenance`, diags);
  validateInvocation(value.invocation, `${pathLabel}.invocation`, diags);
  validateMeasurements(value.measurements, `${pathLabel}.measurements`, diags);
  validateReview(value.review, `${pathLabel}.review`, diags);

  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 64) {
    push(diags, `${pathLabel}.artifacts: length outside 1..64`);
  } else {
    const paths: string[] = [];
    for (const [i, art] of value.artifacts.entries()) {
      const p = `${pathLabel}.artifacts[${i}]`;
      if (!isPlainObject(art)) {
        push(diags, `${p}: must be an object`);
        continue;
      }
      exactKeys(art, ARTIFACT_KEYS, p, diags, ARTIFACT_KEYS);
      if (typeof art.role !== "string" || !(ARTIFACT_ROLES as readonly string[]).includes(art.role)) {
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
        art.byte_length > 1_073_741_824
      ) {
        push(diags, `${p}.byte_length: out of bounds`);
      }
      if (typeof art.media_type !== "string" || !MEDIA_TYPE_RE.test(art.media_type)) {
        push(diags, `${p}.media_type: invalid`);
      }
      if (
        typeof art.retention_policy !== "string" ||
        art.retention_policy.length < 1 ||
        art.retention_policy.length > 128
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

async function readRegularFile(
  abs: string,
  maxBytes: number,
  label: string,
  diags: string[],
): Promise<Uint8Array | null> {
  try {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) {
      push(diags, `${label}: symlink rejected`);
      return null;
    }
    if (!st.isFile()) {
      push(diags, `${label}: must be a regular file`);
      return null;
    }
    if (st.size > maxBytes) {
      push(diags, `${label}: size ${st.size} exceeds max ${maxBytes}`);
      return null;
    }
    return new Uint8Array(await readFile(abs));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    push(diags, `${label}: read failed: ${msg}`);
    return null;
  }
}

export async function validateReportFile(
  root: string,
  reportRel: string,
  options: { verifyArtifacts?: boolean } = {},
): Promise<string[]> {
  const diags: string[] = [];
  const verifyArtifacts = options.verifyArtifacts !== false;
  const resolved = resolveUnderRoot(root, reportRel);
  if (!resolved.ok) {
    push(diags, `report ${reportRel}: ${resolved.error}`);
    return diags;
  }
  const bytes = await readRegularFile(resolved.abs, REPORT_MAX_BYTES, `report ${reportRel}`, diags);
  if (!bytes) return diags;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    push(diags, `report ${reportRel}: malformed JSON: ${msg}`);
    return diags;
  }
  if (stableJsonPretty(parsed) !== text) {
    push(diags, `report ${reportRel}: must be canonical pretty JSON with trailing newline`);
  }
  diags.push(...validateReportDocument(parsed, `report ${reportRel}`));
  if (!verifyArtifacts || !isPlainObject(parsed) || !Array.isArray(parsed.artifacts)) {
    return diags;
  }
  for (const [i, art] of parsed.artifacts.entries()) {
    if (!isPlainObject(art) || typeof art.path !== "string") continue;
    const label = `report ${reportRel}.artifacts[${i}]`;
    const artResolved = resolveUnderRoot(root, art.path);
    if (!artResolved.ok) {
      push(diags, `${label}.path: ${artResolved.error}`);
      continue;
    }
    const artBytes = await readRegularFile(
      artResolved.abs,
      ARTIFACT_MAX_BYTES,
      `${label} file`,
      diags,
    );
    if (!artBytes) continue;
    if (typeof art.byte_length === "number" && artBytes.byteLength !== art.byte_length) {
      push(
        diags,
        `${label}: byte_length ${art.byte_length} does not match file size ${artBytes.byteLength}`,
      );
    }
    if (typeof art.sha256 === "string") {
      const digest = sha256Hex(artBytes);
      if (digest !== art.sha256) {
        push(diags, `${label}: sha256 mismatch`);
      }
    }
  }
  return diags;
}

export async function checkEvidence(root: string = process.cwd()): Promise<EvidenceCheckResult> {
  const diags: string[] = [];
  const schemaResolved = resolveUnderRoot(root, SCHEMA_REL);
  if (!schemaResolved.ok) {
    push(diags, `schema: ${schemaResolved.error}`);
  } else {
    await readRegularFile(schemaResolved.abs, SCHEMA_MAX_BYTES, "schema", diags);
  }

  const validResolved = resolveUnderRoot(root, VALID_DIR_REL);
  if (!validResolved.ok) {
    push(diags, `valid corpus: ${validResolved.error}`);
    diags.sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      diagnostics: diags,
      summary: `status=fail diagnostics=${diags.length}`,
      reports: 0,
    };
  }

  let reportNames: string[] = [];
  try {
    const st = await lstat(validResolved.abs);
    if (st.isSymbolicLink()) {
      push(diags, `valid corpus: symlink directory rejected`);
    } else if (!st.isDirectory()) {
      push(diags, `valid corpus: must be a directory`);
    } else {
      const entries = await readdir(validResolved.abs, { withFileTypes: true });
      reportNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      if (reportNames.length === 0) {
        push(diags, `valid corpus: requires at least one report JSON`);
      }
      for (const name of reportNames) {
        const rel = `${VALID_DIR_REL}/${name}`;
        diags.push(...(await validateReportFile(root, rel)));
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    push(diags, `valid corpus: read failed: ${msg}`);
  }

  diags.sort((a, b) => a.localeCompare(b));
  const ok = diags.length === 0;
  return {
    ok,
    diagnostics: diags,
    summary: ok
      ? `status=ok reports=${reportNames.length} schema=${SCHEMA_REL}`
      : `status=fail diagnostics=${diags.length}`,
    reports: reportNames.length,
  };
}

async function main(): Promise<void> {
  const result = await checkEvidence(path.resolve(import.meta.dir, ".."));
  if (!result.ok) {
    for (const d of result.diagnostics) console.error(d);
  }
  console.log(result.summary);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`evidence-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
