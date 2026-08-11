#!/usr/bin/env bun
/**
 * R2WP v0 three-language agreement orchestrator (M0-03h4).
 *
 * Live gate:
 * 1. TypeScript checkExpected rebuild (canonical AgreeDocument)
 * 2. Rust rclwebd protocol_agreement emitter under emit env
 * 3. MoonBit rclmbt/cmd/agree Wasm emitter
 *
 * --write  run the live gate and atomically write report.json
 * --check  run the live gate and byte-compare the committed report
 *
 * Outputs use closed digests and pretty projections only.
 */
import path from "node:path";
import {
  EXPECTED_REL,
  EXPECTED_MAX_BYTES,
  MALFORMED_TOTAL,
  OUTCOMES_TOTAL,
  PARITY_RULES_TOTAL,
  PARITY_SHARED_TOTAL,
  PHASE_ONE_TRIPLES,
  PROTOCOL_ID,
  RECIPE_ID,
  RECIPE_PAYLOAD_FNV1A64_HEX,
  SCHEMA_VERSION as H1_SCHEMA_VERSION,
  SEQUENCES_TOTAL,
  VALID_TOTAL,
  type AgreeDocument,
  checkExpected,
  diagnoseAgreeDocument,
  readBoundedText,
  repoRootFrom,
  sha256Hex,
  stableJsonCompact,
  stableJsonPretty,
  writeBoundedTextAtomic,
} from "./protocol-agree.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GENERATED_BY = "scripts/protocol-agree-run.ts";
export const BATCH_ID = "M0-03h4";
export const SCHEMA_VERSION = 1;
export const OUTPUT_REL = "protocol/testdata/agreement/report.json";
export const REPORT_MAX_BYTES = 8 * 1024 * 1024;

export { OUTCOMES_TOTAL };
export const SUCCESS_TOTAL = VALID_TOTAL + SEQUENCES_TOTAL; // 46
export const ERROR_TOTAL = MALFORMED_TOTAL; // 55

export const RUST_BEGIN = "MOONSPAN_R2WP_AGREEMENT_RUST_BEGIN";
export const RUST_END = "MOONSPAN_R2WP_AGREEMENT_RUST_END";
export const MOONBIT_BEGIN = "MOONSPAN_R2WP_AGREEMENT_MOONBIT_BEGIN";
export const MOONBIT_END = "MOONSPAN_R2WP_AGREEMENT_MOONBIT_END";

export const SPAWN_TIMEOUT_MS = 300_000;
/**
 * Captured stdout/stderr ceiling for child emitters.
 * Reasoned value: 8 MiB. Compact envelopes are well under 1 MiB today; 8 MiB
 * leaves headroom for cargo/moon preamble while bounding runaway output.
 */
export const SPAWN_MAX_BUFFER = 8 * 1024 * 1024;
export const DIAG_EXCERPT_MAX = 512;

export const IMPLEMENTATION_ORDER = ["typescript", "rust", "moonbit"] as const;
export type ImplementationName = (typeof IMPLEMENTATION_ORDER)[number];

const ENVELOPE_KEYS = [
  "implementation",
  "outcomes",
  "protocol",
  "schema_version",
] as const;

const REPORT_KEYS = [
  "agreement",
  "batch",
  "canonical",
  "generated_by",
  "implementations",
  "protocol",
  "schema_version",
] as const;

const AGREEMENT_KEYS = [
  "all_implementations_equal",
  "canonical_sha256",
  "error_total",
  "expected_file",
  "outcomes_sha256",
  "success_total",
  "transport_bindings_sha256",
  "transport_rules",
  "transport_shared_artifacts",
  "webtransport_binary_wss_equal",
] as const;

const IMPL_ENTRY_KEYS = [
  "implementation",
  "matches_canonical",
  "outcomes_sha256",
  "outcomes_total",
] as const;

const EXPECTED_FILE_KEYS = ["path", "sha256"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpawnRequest = {
  cmd: string[];
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
};

export type SpawnResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
};

export type SpawnRunner = (req: SpawnRequest) => SpawnResult;

export type AgreementEnvelope = {
  schema_version: number;
  protocol: string;
  implementation: string;
  outcomes: unknown[];
};

export type ImplementationEntry = {
  implementation: ImplementationName;
  matches_canonical: true;
  outcomes_total: number;
  outcomes_sha256: string;
};

export type AgreementSummary = {
  all_implementations_equal: true;
  canonical_sha256: string;
  outcomes_sha256: string;
  expected_file: { path: string; sha256: string };
  success_total: number;
  error_total: number;
  transport_bindings_sha256: string;
  transport_shared_artifacts: number;
  transport_rules: number;
  webtransport_binary_wss_equal: true;
};

export type AgreementReport = {
  schema_version: number;
  protocol: string;
  generated_by: string;
  batch: string;
  canonical: AgreeDocument;
  implementations: ImplementationEntry[];
  agreement: AgreementSummary;
};

// ---------------------------------------------------------------------------
// CLI / pure helpers
// ---------------------------------------------------------------------------

export function parseCliMode(argv: string[]): "write" | "check" | null {
  if (argv.length !== 1) return null;
  if (argv[0] === "--write") return "write";
  if (argv[0] === "--check") return "check";
  return null;
}

export function excerpt(text: string, max = DIAG_EXCERPT_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function defaultSpawnRunner(req: SpawnRequest): SpawnResult {
  const result = Bun.spawnSync({
    cmd: req.cmd,
    cwd: req.cwd,
    env: req.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: req.timeoutMs,
    maxBuffer: req.maxBuffer,
    killSignal: "SIGTERM",
  });
  const stdout =
    typeof result.stdout === "string"
      ? result.stdout
      : Buffer.from(result.stdout ?? []).toString("utf8");
  const stderr =
    typeof result.stderr === "string"
      ? result.stderr
      : Buffer.from(result.stderr ?? []).toString("utf8");
  return {
    exitCode: result.exitCode,
    signal: result.signalCode ?? null,
    stdout,
    stderr,
    timedOut: Boolean(result.exitedDueToTimeout),
    outputTruncated: Boolean(result.exitedDueToMaxBuffer),
  };
}

export function diagnoseSpawnFailure(
  label: string,
  result: SpawnResult,
): string | null {
  if (result.timedOut) {
    return `${label}: process timed out after ${SPAWN_TIMEOUT_MS}ms; stderr=${excerpt(result.stderr)}`;
  }
  if (result.outputTruncated) {
    return `${label}: process output exceeded maxBuffer ${SPAWN_MAX_BUFFER}; stderr=${excerpt(result.stderr)}`;
  }
  if (result.signal) {
    return `${label}: process terminated by signal ${result.signal}; stderr=${excerpt(result.stderr)}`;
  }
  if (result.exitCode !== 0) {
    return `${label}: process exit ${String(result.exitCode)}; stderr=${excerpt(result.stderr)} stdout=${excerpt(result.stdout)}`;
  }
  return null;
}

/**
 * Extract exactly one compact JSON envelope between begin/end marker lines.
 */
export function extractMarkerEnvelope(
  stdout: string,
  begin: string,
  end: string,
  expectedImplementation: ImplementationName,
): { ok: true; envelope: AgreementEnvelope } | { ok: false; error: string } {
  const lines = stdout.split(/\r?\n/);
  const begins: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === begin) begins.push(i);
    if (lines[i] === end) ends.push(i);
  }
  if (begins.length !== 1) {
    return {
      ok: false,
      error: `marker begin requires exactly one ${begin} line, got ${begins.length}`,
    };
  }
  if (ends.length !== 1) {
    return {
      ok: false,
      error: `marker end requires exactly one ${end} line, got ${ends.length}`,
    };
  }
  const b = begins[0]!;
  const e = ends[0]!;
  if (e !== b + 2) {
    return {
      ok: false,
      error: `marker pair requires one envelope line between begin and end (span=${e - b})`,
    };
  }
  if (e < b) {
    return { ok: false, error: "marker end requires order after begin" };
  }
  const raw = lines[b + 1]!;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `envelope JSON requires parse success: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "envelope requires object" };
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    !ENVELOPE_KEYS.every((k, i) => keys[i] === k)
  ) {
    return {
      ok: false,
      error: `envelope keys require exact set ${ENVELOPE_KEYS.join(",")}; got ${keys.join(",")}`,
    };
  }
  if (obj.schema_version !== H1_SCHEMA_VERSION) {
    return { ok: false, error: "envelope.schema_version requires 1" };
  }
  if (obj.protocol !== PROTOCOL_ID) {
    return { ok: false, error: `envelope.protocol requires ${PROTOCOL_ID}` };
  }
  if (obj.implementation !== expectedImplementation) {
    return {
      ok: false,
      error: `envelope.implementation requires ${expectedImplementation}, got ${String(obj.implementation)}`,
    };
  }
  if (!Array.isArray(obj.outcomes)) {
    return { ok: false, error: "envelope.outcomes requires array" };
  }
  if (obj.outcomes.length !== OUTCOMES_TOTAL) {
    return {
      ok: false,
      error: `envelope.outcomes requires length ${OUTCOMES_TOTAL}, got ${obj.outcomes.length}`,
    };
  }
  // Sorted unique ids
  let prev = "";
  for (let i = 0; i < obj.outcomes.length; i++) {
    const o = obj.outcomes[i];
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      return { ok: false, error: `envelope.outcomes[${i}] requires object` };
    }
    const id = (o as { id?: unknown }).id;
    if (typeof id !== "string") {
      return { ok: false, error: `envelope.outcomes[${i}].id requires string` };
    }
    if (prev && !(prev < id)) {
      return {
        ok: false,
        error: `envelope.outcomes ids require strict ascending unique order at ${i}`,
      };
    }
    prev = id;
  }
  return {
    ok: true,
    envelope: {
      schema_version: obj.schema_version as number,
      protocol: obj.protocol as string,
      implementation: obj.implementation as string,
      outcomes: obj.outcomes as unknown[],
    },
  };
}

export function firstOutcomeDiffPath(
  got: unknown,
  exp: unknown,
  pathLabel = "$",
): string | null {
  if (Object.is(got, exp)) return null;
  if (got === null || exp === null || typeof got !== typeof exp) {
    return pathLabel;
  }
  if (Array.isArray(got) && Array.isArray(exp)) {
    if (got.length !== exp.length) return `${pathLabel}.length`;
    for (let i = 0; i < got.length; i++) {
      const d = firstOutcomeDiffPath(got[i], exp[i], `${pathLabel}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof got === "object" && typeof exp === "object") {
    const g = got as Record<string, unknown>;
    const e = exp as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(g), ...Object.keys(e)])).sort();
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) return `${pathLabel}.${k}`;
      if (!Object.prototype.hasOwnProperty.call(e, k)) return `${pathLabel}.${k}`;
      const d = firstOutcomeDiffPath(g[k], e[k], `${pathLabel}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return pathLabel;
}

export function compareOutcomesExact(
  implementation: ImplementationName,
  got: unknown[],
  expected: unknown[],
): string | null {
  if (got.length !== expected.length) {
    return `${implementation}: outcomes length ${got.length} requires ${expected.length}`;
  }
  for (let i = 0; i < got.length; i++) {
    const g = got[i];
    const e = expected[i];
    const gid =
      g && typeof g === "object" && !Array.isArray(g)
        ? String((g as { id?: unknown }).id ?? i)
        : String(i);
    const diff = firstOutcomeDiffPath(g, e, "outcome");
    if (diff) {
      return `${implementation}: first divergent outcome id=${gid} path=${diff}`;
    }
  }
  return null;
}

export function outcomesSha256(outcomes: unknown[]): string {
  return sha256Hex(stableJsonCompact(outcomes));
}

export function canonicalSha256(doc: AgreeDocument): string {
  return sha256Hex(stableJsonCompact(doc));
}

export function transportBindingsSha256(doc: AgreeDocument): string {
  return sha256Hex(stableJsonCompact(doc.transport_bindings));
}

// ---------------------------------------------------------------------------
// Child command specs
// ---------------------------------------------------------------------------

export function rustSpawnRequest(root: string): SpawnRequest {
  return {
    cmd: [
      "cargo",
      "test",
      "--locked",
      "-p",
      "rclwebd",
      "--test",
      "protocol_agreement",
      "rust_outcomes_match_expected",
      "--",
      "--exact",
      "--nocapture",
      "--test-threads=1",
    ],
    env: {
      ...process.env,
      MOONSPAN_PROTOCOL_AGREE_EMIT: "1",
      CARGO_TERM_COLOR: "never",
      NO_COLOR: "1",
    } as Record<string, string>,
    cwd: root,
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBuffer: SPAWN_MAX_BUFFER,
  };
}

export function moonbitSpawnRequest(root: string): SpawnRequest {
  return {
    cmd: [
      "moon",
      "run",
      "--frozen",
      "--release",
      "--target",
      "wasm",
      "rclmbt/cmd/agree",
    ],
    env: { ...process.env } as Record<string, string>,
    cwd: root,
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBuffer: SPAWN_MAX_BUFFER,
  };
}

// ---------------------------------------------------------------------------
// Report build / diagnose
// ---------------------------------------------------------------------------

function exactKeys(
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Uint8Array)
  );
}

/** Expected-file digest bound: pretty canonical equals committed expected.json raw. */
export function expectedFileSha256FromCanonical(doc: AgreeDocument): string {
  return sha256Hex(stableJsonPretty(doc));
}

export function buildAgreementReport(
  doc: AgreeDocument,
  outcomesSha: string,
): AgreementReport {
  const success = doc.outcomes.filter((o) => o.status === "success").length;
  const error = doc.outcomes.filter((o) => o.status === "error").length;
  const canonSha = canonicalSha256(doc);
  const bindSha = transportBindingsSha256(doc);
  const expectedFileSha = expectedFileSha256FromCanonical(doc);
  const implementations: ImplementationEntry[] = IMPLEMENTATION_ORDER.map(
    (implementation) => ({
      implementation,
      matches_canonical: true as const,
      outcomes_total: OUTCOMES_TOTAL,
      outcomes_sha256: outcomesSha,
    }),
  );
  return {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    generated_by: GENERATED_BY,
    batch: BATCH_ID,
    canonical: doc,
    implementations,
    agreement: {
      all_implementations_equal: true,
      canonical_sha256: canonSha,
      outcomes_sha256: outcomesSha,
      expected_file: { path: EXPECTED_REL, sha256: expectedFileSha },
      success_total: success,
      error_total: error,
      transport_bindings_sha256: bindSha,
      transport_shared_artifacts: PARITY_SHARED_TOTAL,
      transport_rules: PARITY_RULES_TOTAL,
      webtransport_binary_wss_equal: true,
    },
  };
}

export function diagnoseAgreementReport(doc: unknown): string[] {
  const diags: string[] = [];
  try {
    if (!isPlainObject(doc)) {
      diags.push("root: requires object");
      return diags.sort();
    }
    exactKeys(doc, REPORT_KEYS, "root", diags);
    if (doc.schema_version !== SCHEMA_VERSION) diags.push("schema_version");
    if (doc.protocol !== PROTOCOL_ID) diags.push("protocol");
    if (doc.generated_by !== GENERATED_BY) diags.push("generated_by");
    if (doc.batch !== BATCH_ID) diags.push("batch");

    if (!isPlainObject(doc.canonical)) {
      diags.push("canonical: requires object");
    } else {
      diags.push(...diagnoseAgreeDocument(doc.canonical));
      // Recompute digests against canonical projection.
      const canon = doc.canonical as unknown as AgreeDocument;
      const outcomesSha = outcomesSha256(canon.outcomes);
      const canonSha = canonicalSha256(canon);
      const bindSha = transportBindingsSha256(canon);
      const success = canon.outcomes.filter((o) => o.status === "success").length;
      const error = canon.outcomes.filter((o) => o.status === "error").length;
      if (success !== SUCCESS_TOTAL) {
        diags.push(`canonical success_total ${success}`);
      }
      if (error !== ERROR_TOTAL) diags.push(`canonical error_total ${error}`);

      // Phase 1 triples exact set and order
      if (
        !Array.isArray(canon.phase_one_triples) ||
        canon.phase_one_triples.length !== PHASE_ONE_TRIPLES.length
      ) {
        diags.push("canonical.phase_one_triples length");
      } else {
        for (let i = 0; i < PHASE_ONE_TRIPLES.length; i++) {
          const exp = PHASE_ONE_TRIPLES[i]!;
          const got = canon.phase_one_triples[i]!;
          if (
            got.support_row_id !== exp.support_row_id ||
            got.ros_distro !== exp.ros_distro ||
            got.rmw_identifier !== exp.rmw_identifier
          ) {
            diags.push(`canonical.phase_one_triples[${i}]`);
          }
        }
      }

      // Transport bindings: every equal_wt_wss and count
      if (
        !Array.isArray(canon.transport_bindings) ||
        canon.transport_bindings.length !== PARITY_SHARED_TOTAL
      ) {
        diags.push("canonical.transport_bindings length");
      } else {
        for (let i = 0; i < canon.transport_bindings.length; i++) {
          const b = canon.transport_bindings[i]!;
          if (b.equal_wt_wss !== true) {
            diags.push(`canonical.transport_bindings[${i}].equal_wt_wss`);
          }
          if (
            b.webtransport.sha256 !== b.binary_wss.sha256 ||
            b.webtransport.byte_length !== b.binary_wss.byte_length ||
            b.webtransport.semantic_identity !== b.binary_wss.semantic_identity
          ) {
            diags.push(`canonical.transport_bindings[${i}] WT/WSS equality`);
          }
        }
      }

      if (!Array.isArray(doc.implementations)) {
        diags.push("implementations: requires array");
      } else {
        if (doc.implementations.length !== IMPLEMENTATION_ORDER.length) {
          diags.push("implementations length");
        }
        doc.implementations.forEach((entry, i) => {
          const p = `implementations[${i}]`;
          if (!isPlainObject(entry)) {
            diags.push(`${p}: requires object`);
            return;
          }
          exactKeys(entry, IMPL_ENTRY_KEYS, p, diags);
          if (entry.implementation !== IMPLEMENTATION_ORDER[i]) {
            diags.push(`${p}.implementation order`);
          }
          if (entry.matches_canonical !== true) {
            diags.push(`${p}.matches_canonical`);
          }
          if (entry.outcomes_total !== OUTCOMES_TOTAL) {
            diags.push(`${p}.outcomes_total`);
          }
          if (entry.outcomes_sha256 !== outcomesSha) {
            diags.push(`${p}.outcomes_sha256`);
          }
        });
      }

      if (!isPlainObject(doc.agreement)) {
        diags.push("agreement: requires object");
      } else {
        const a = doc.agreement;
        exactKeys(a, AGREEMENT_KEYS, "agreement", diags);
        if (a.all_implementations_equal !== true) {
          diags.push("agreement.all_implementations_equal");
        }
        if (a.canonical_sha256 !== canonSha) {
          diags.push("agreement.canonical_sha256");
        }
        if (a.outcomes_sha256 !== outcomesSha) {
          diags.push("agreement.outcomes_sha256");
        }
        if (a.success_total !== SUCCESS_TOTAL) diags.push("agreement.success_total");
        if (a.error_total !== ERROR_TOTAL) diags.push("agreement.error_total");
        if (a.transport_bindings_sha256 !== bindSha) {
          diags.push("agreement.transport_bindings_sha256");
        }
        if (a.transport_shared_artifacts !== PARITY_SHARED_TOTAL) {
          diags.push("agreement.transport_shared_artifacts");
        }
        if (a.transport_rules !== PARITY_RULES_TOTAL) {
          diags.push("agreement.transport_rules");
        }
        if (a.webtransport_binary_wss_equal !== true) {
          diags.push("agreement.webtransport_binary_wss_equal");
        }
        if (!isPlainObject(a.expected_file)) {
          diags.push("agreement.expected_file object");
        } else {
          exactKeys(a.expected_file, EXPECTED_FILE_KEYS, "agreement.expected_file", diags);
          if (a.expected_file.path !== EXPECTED_REL) {
            diags.push("agreement.expected_file.path");
          }
          const expectedSha = expectedFileSha256FromCanonical(canon);
          if (a.expected_file.sha256 !== expectedSha) {
            diags.push("agreement.expected_file.sha256");
          }
        }
      }

      // Recipe FNV pin remains on canonical
      const recipe = canon.outcomes.find((o) => o.source_id === RECIPE_ID);
      if (
        !recipe ||
        recipe.status !== "success" ||
        !recipe.record ||
        !("payload" in recipe.record) ||
        recipe.record.payload.form !== "application" ||
        recipe.record.payload.payload_fnv1a64_hex !== RECIPE_PAYLOAD_FNV1A64_HEX
      ) {
        diags.push("canonical 64 MiB payload_fnv1a64_hex pin");
      }
    }
  } catch (e) {
    diags.push(`diagnose threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  return diags.sort();
}

// ---------------------------------------------------------------------------
// Live gate
// ---------------------------------------------------------------------------

function runSpawnSafe(
  label: ImplementationName,
  runner: SpawnRunner,
  req: SpawnRequest,
): { ok: true; result: SpawnResult } | { ok: false; error: string } {
  try {
    return { ok: true, result: runner(req) };
  } catch (e) {
    return {
      ok: false,
      error: `${label}: spawn failed: ${excerpt(
        e instanceof Error ? e.message : String(e),
      )}`,
    };
  }
}

function collectEmitterOutcomes(
  label: ImplementationName,
  begin: string,
  end: string,
  req: SpawnRequest,
  runner: SpawnRunner,
  expectedOutcomes: unknown[],
  expectedOutcomesSha: string,
  diags: string[],
): void {
  const spawned = runSpawnSafe(label, runner, req);
  if (!spawned.ok) {
    diags.push(spawned.error);
    return;
  }
  const fail = diagnoseSpawnFailure(label, spawned.result);
  if (fail) {
    diags.push(fail);
    return;
  }
  const extracted = extractMarkerEnvelope(
    spawned.result.stdout,
    begin,
    end,
    label,
  );
  if (!extracted.ok) {
    diags.push(`${label}: ${extracted.error}`);
    return;
  }
  const cmp = compareOutcomesExact(
    label,
    extracted.envelope.outcomes,
    expectedOutcomes,
  );
  if (cmp) diags.push(cmp);
  const sha = outcomesSha256(extracted.envelope.outcomes);
  if (sha !== expectedOutcomesSha) {
    diags.push(`${label}: outcomes_sha256 ${sha} requires ${expectedOutcomesSha}`);
  }
}

export async function runLiveAgreementGate(
  root: string,
  runner: SpawnRunner = defaultSpawnRunner,
): Promise<
  | { ok: true; report: AgreementReport; reportText: string }
  | { ok: false; diagnostics: string[] }
> {
  const diags: string[] = [];

  const ts = await checkExpected(root);
  if (!ts.ok) {
    return {
      ok: false,
      diagnostics: [
        `typescript checkExpected requires success:`,
        ...ts.diagnostics.slice(0, 32),
      ],
    };
  }
  const doc = ts.doc;
  const tsOutcomesSha = outcomesSha256(doc.outcomes);

  // TypeScript surface is the rebuilt doc outcomes.
  const tsCompare = compareOutcomesExact(
    "typescript",
    doc.outcomes as unknown[],
    doc.outcomes as unknown[],
  );
  if (tsCompare) diags.push(tsCompare);

  // Rust and MoonBit continue independently so one spawn failure still reports the other.
  collectEmitterOutcomes(
    "rust",
    RUST_BEGIN,
    RUST_END,
    rustSpawnRequest(root),
    runner,
    doc.outcomes as unknown[],
    tsOutcomesSha,
    diags,
  );
  collectEmitterOutcomes(
    "moonbit",
    MOONBIT_BEGIN,
    MOONBIT_END,
    moonbitSpawnRequest(root),
    runner,
    doc.outcomes as unknown[],
    tsOutcomesSha,
    diags,
  );

  if (diags.length > 0) {
    return { ok: false, diagnostics: diags };
  }

  const report = buildAgreementReport(doc, tsOutcomesSha);
  const reportDiags = diagnoseAgreementReport(report);
  if (reportDiags.length > 0) {
    return {
      ok: false,
      diagnostics: ["report diagnose requires empty:", ...reportDiags.slice(0, 32)],
    };
  }
  // Cross-check expected.json raw identity against pretty canonical binding.
  const expectedRead = await readBoundedText(root, EXPECTED_REL, EXPECTED_MAX_BYTES);
  if (!expectedRead.ok) {
    return { ok: false, diagnostics: [`${EXPECTED_REL}: ${expectedRead.error}`] };
  }
  if (sha256Hex(expectedRead.text) !== report.agreement.expected_file.sha256) {
    return {
      ok: false,
      diagnostics: [
        `${EXPECTED_REL}: raw sha256 requires pretty-canonical binding ${report.agreement.expected_file.sha256}`,
      ],
    };
  }
  const reportText = stableJsonPretty(report);
  return { ok: true, report, reportText };
}

export async function writeAgreementReport(
  root: string,
  runner: SpawnRunner = defaultSpawnRunner,
): Promise<{ report: AgreementReport; text: string }> {
  const live = await runLiveAgreementGate(root, runner);
  if (!live.ok) {
    throw new Error(live.diagnostics.join("\n"));
  }
  const w = await writeBoundedTextAtomic(
    root,
    OUTPUT_REL,
    live.reportText,
    REPORT_MAX_BYTES,
  );
  if (!w.ok) throw new Error(`write ${OUTPUT_REL}: ${w.error}`);
  return { report: live.report, text: live.reportText };
}

export async function checkAgreementReport(
  root: string,
  runner: SpawnRunner = defaultSpawnRunner,
): Promise<{ ok: true; report: AgreementReport } | { ok: false; diagnostics: string[] }> {
  const live = await runLiveAgreementGate(root, runner);
  if (!live.ok) return live;

  const read = await readBoundedText(root, OUTPUT_REL, REPORT_MAX_BYTES);
  if (!read.ok) {
    return { ok: false, diagnostics: [`${OUTPUT_REL}: ${read.error}`] };
  }
  let committed: unknown;
  try {
    committed = JSON.parse(read.text);
  } catch (e) {
    return {
      ok: false,
      diagnostics: [
        `${OUTPUT_REL}: malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
  const diags = diagnoseAgreementReport(committed);
  if (read.text !== live.reportText) {
    diags.push(`${OUTPUT_REL}: raw text requires canonical rebuild`);
  }
  if (stableJsonPretty(committed) !== live.reportText) {
    diags.push(`${OUTPUT_REL}: committed JSON requires canonical rebuild`);
  }
  if (diags.length > 0) return { ok: false, diagnostics: diags.sort() };
  return { ok: true, report: live.report };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const mode = parseCliMode(argv);
  if (!mode) {
    console.error("require exactly one of --write or --check");
    return 2;
  }
  const root = repoRootFrom(import.meta.dir);
  try {
    if (mode === "write") {
      const { report, text } = await writeAgreementReport(root);
      console.log(
        JSON.stringify({
          mode: "write",
          output: OUTPUT_REL,
          status: "ok",
          outcomes: report.canonical.counts.outcomes_total,
          bytes: Buffer.byteLength(text, "utf8"),
          outcomes_sha256: report.agreement.outcomes_sha256,
          canonical_sha256: report.agreement.canonical_sha256,
        }),
      );
      return 0;
    }
    const result = await checkAgreementReport(root);
    if (!result.ok) {
      for (const d of result.diagnostics) console.error(d);
      console.log(
        JSON.stringify({
          mode: "check",
          status: "error",
          diagnostics: result.diagnostics.length,
        }),
      );
      return 1;
    }
    console.log(
      JSON.stringify({
        mode: "check",
        status: "ok",
        outcomes: result.report.canonical.counts.outcomes_total,
        outcomes_sha256: result.report.agreement.outcomes_sha256,
        canonical_sha256: result.report.agreement.canonical_sha256,
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
