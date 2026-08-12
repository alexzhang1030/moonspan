/**
 * Pure qualification report v1 runtime validation (R4-03 recycle of M0-05a).
 *
 * Document shape and semantic checks. Shared model lives in evidence-model.ts;
 * JSON Schema generation in evidence-schema.ts; filesystem I/O in evidence-check.ts.
 */

import {
  ARRAY_MAX_64,
  ARRAY_MAX_256,
  ARTIFACT_KEYS,
  ARTIFACT_MAX_BYTES,
  ARTIFACT_ROLES,
  DECISIONS,
  DOMAIN_ID_MAX,
  DURATION_MAX_SECONDS,
  ENVIRONMENT_ID_RE,
  ENVIRONMENT_KEYS,
  EVIDENCE_LEVELS,
  FIXTURE_CORPUS_ID_RE,
  GATES,
  GATE_EVIDENCE_LEVELS,
  GIT_SHA_RE,
  IDENTITY_KEYS,
  IMAGE_DIGEST_RE,
  INVOCATION_KEYS,
  LEVELS_REQUIRING_SUPPORT_ROW,
  MAP_MAX_32,
  MAP_MAX_64,
  MEASUREMENT_KEYS,
  MEDIA_TYPE_MAX_LENGTH,
  MEDIA_TYPE_RE,
  PACKAGE_NAME_RE,
  PLATFORMS,
  PROVENANCE_KEYS,
  REPORT_ID,
  REVIEW_KEYS,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_MIN,
  SAMPLE_COUNT_MAX,
  SCHEMA_VERSION,
  SHA256_RE,
  SUPPORT_ROWS,
  TEXT_1,
  TEXT_64,
  TEXT_128,
  TEXT_256,
  TEXT_1024,
  TEXT_4096,
  TOP_LEVEL_KEYS,
  WARMUP_COUNT_MAX,
  isPlainObject,
  isSortedUniqueNumbers,
  isSortedUniqueStrings,
  isValidCalendarDate,
  objectKeysSorted,
  resolveUnderRoot,
} from "./evidence-model.ts";

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
      if (!Number.isFinite(entry) || entry < SAFE_NUMBER_MIN || entry > SAFE_NUMBER_MAX) {
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
