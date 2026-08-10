#!/usr/bin/env bun
/**
 * R2WP v0 contract validator (M0-03b slice 1).
 *
 * Dependency-free Bun/TypeScript checks over registry JSON text and control CDDL text.
 * Root package/just wiring is slice 2.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export type ProtocolCheckResult = {
  ok: boolean;
  diagnostics: string[];
  summary: string;
};

const PHASE_ONE_ROWS = ["H-FT", "H-CY", "J-FT", "J-CY"] as const;

/** Exact wire / bootstrap error code sets (code 20 excluded from both). */
export const WIRE_ERROR_CODES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28,
] as const;
export const BOOTSTRAP_ERROR_CODES = [1, 2, 4, 16, 24, 25] as const;

type FieldKind = "const" | "string" | "number" | "object" | "array";

type TopLevelSpec = {
  kind: FieldKind;
  /** Required exact value for kind "const". */
  value?: string | number;
};

/**
 * Expected top-level types for every normative collection/field in the accepted v0 registry.
 * Values are required; null/wrong JSON types fail.
 */
export const TOP_LEVEL_SPEC: Readonly<Record<string, TopLevelSpec>> = {
  registry_id: { kind: "const", value: "r2wp-v0" },
  wire_version: { kind: "const", value: 0 },
  title: { kind: "string" },
  normative_spec: { kind: "const", value: "protocol/r2wp-v0.md" },
  control_cddl: { kind: "const", value: "protocol/schema/control-v0.cddl" },
  byte_order: { kind: "const", value: "network" },
  integer_encoding: { kind: "const", value: "big-endian" },
  absolute_limits: { kind: "object" },
  application_fragmentation: { kind: "object" },
  bootstrap: { kind: "object" },
  cbor_profile: { kind: "object" },
  channel_lifecycle: { kind: "object" },
  channel_resume_results: { kind: "object" },
  clocks: { kind: "object" },
  close_reasons: { kind: "object" },
  collection_rules: { kind: "object" },
  control_extensions: { kind: "object" },
  control_field_keys: { kind: "object" },
  control_kinds: { kind: "object" },
  correlation_id: { kind: "object" },
  correlation_pairing: { kind: "object" },
  defaults: { kind: "object" },
  dispositions: { kind: "object" },
  document_ownership: { kind: "object" },
  encodings: { kind: "object" },
  error_scope_context: { kind: "object" },
  error_scopes: { kind: "object" },
  errors: { kind: "object" },
  extension_capabilities: { kind: "object" },
  extensions: { kind: "object" },
  flags: { kind: "object" },
  graph_delta_ops: { kind: "object" },
  graph_endpoint_kinds: { kind: "object" },
  hello_negotiation: { kind: "object" },
  later_expansion: { kind: "object" },
  non_ros_payloads: { kind: "object" },
  opcodes: { kind: "object" },
  operation_id_lifecycle: { kind: "object" },
  operation_kinds: { kind: "object" },
  payload_channel_mapping: { kind: "array" },
  phase_one_support_rows: { kind: "array" },
  policy_results: { kind: "object" },
  priorities: { kind: "object" },
  protocol_state_machine: { kind: "object" },
  qos: { kind: "object" },
  retry_classes: { kind: "object" },
  schema_identity_schemes: { kind: "object" },
  selected_version_frame: { kind: "object" },
  session_resume_semantics: { kind: "object" },
  source_entry_encodings: { kind: "object" },
  sources: { kind: "object" },
  support_row_profiles: { kind: "object" },
  transport: { kind: "object" },
  validation_order: { kind: "object" },
};

/** Exact accepted absolute_limits values and JSON types (single source of truth). */
export type AbsoluteLimitSpec =
  | { jsonType: "number"; value: number }
  | { jsonType: "array"; value: readonly number[] };

export const ABSOLUTE_LIMIT_SPEC: Readonly<Record<string, AbsoluteLimitSpec>> = {
  bootstrap_payload_max_bytes: { jsonType: "number", value: 65535 },
  control_payload_max_bytes: { jsonType: "number", value: 1048576 },
  frame_payload_max_bytes: { jsonType: "number", value: 67108864 },
  extension_area_max_bytes: { jsonType: "number", value: 4096 },
  supported_versions_max: { jsonType: "number", value: 16 },
  utf8_text_max_bytes: { jsonType: "number", value: 4096 },
  utf8_text_min_nonempty_bytes: { jsonType: "number", value: 1 },
  cbor_nesting_depth_max: { jsonType: "number", value: 16 },
  cbor_map_entries_max: { jsonType: "number", value: 4096 },
  graph_nodes_max: { jsonType: "number", value: 65535 },
  graph_endpoints_max: { jsonType: "number", value: 65535 },
  graph_delta_ops_max: { jsonType: "number", value: 1024 },
  source_bundle_entries_max: { jsonType: "number", value: 4096 },
  alive_channels_max: { jsonType: "number", value: 65535 },
  channel_acks_max: { jsonType: "number", value: 65535 },
  channel_results_max: { jsonType: "number", value: 65535 },
  domain_ids_max: { jsonType: "number", value: 233 },
  domain_id_range: { jsonType: "array", value: [0, 232] },
  credential_bytes_max: { jsonType: "number", value: 65535 },
  type_description_bytes_max: { jsonType: "number", value: 1048576 },
  extension_capability_ids_max: { jsonType: "number", value: 64 },
  max_channels_ceiling: { jsonType: "number", value: 65535 },
  max_session_bytes_ceiling: { jsonType: "number", value: 4294967296 },
};

/**
 * CDDL surfaces for absolute_limits keys that appear in control CDDL.
 * Expected values come only from ABSOLUTE_LIMIT_SPEC (no duplicated numbers).
 * One limit may list multiple named rule-local surfaces.
 */
export const CDDL_BOUND_SURFACES: ReadonlyArray<{
  limitKey: keyof typeof ABSOLUTE_LIMIT_SPEC & string;
  ruleName: string;
  ruleBodyPattern: string;
  description: string;
}> = [
  {
    limitKey: "supported_versions_max",
    ruleName: "wire-version-list",
    ruleBodyPattern: "[1*16 wire-version-offer]",
    description: "wire_versions list upper bound",
  },
  {
    limitKey: "domain_ids_max",
    ruleName: "domain-id-list",
    ruleBodyPattern: "[1*233 domain-id]",
    description: "domain_id_list upper bound",
  },
  {
    limitKey: "domain_id_range",
    ruleName: "domain-id",
    ruleBodyPattern: "0..232",
    description: "domain_id inclusive range",
  },
  {
    limitKey: "extension_capability_ids_max",
    ruleName: "capability-id-list",
    ruleBodyPattern: "[0*64 capability-id]",
    description: "capability_id_list upper bound",
  },
  {
    limitKey: "graph_nodes_max",
    ruleName: "graph-snapshot",
    ruleBodyPattern: "[0*65535 graph-node]",
    description: "graph snapshot nodes collection",
  },
  {
    limitKey: "graph_endpoints_max",
    ruleName: "graph-snapshot",
    ruleBodyPattern: "[0*65535 graph-endpoint]",
    description: "graph snapshot endpoints collection",
  },
  {
    limitKey: "graph_delta_ops_max",
    ruleName: "graph-delta",
    ruleBodyPattern: "[1*1024 graph-delta-op]",
    description: "graph delta ops collection",
  },
  {
    limitKey: "source_bundle_entries_max",
    ruleName: "schema-advertise",
    ruleBodyPattern: "[0*4096 source-bundle-entry]",
    description: "source bundle entries on schema-advertise",
  },
  {
    limitKey: "source_bundle_entries_max",
    ruleName: "schema-response",
    ruleBodyPattern: "[0*4096 source-bundle-entry]",
    description: "source bundle entries on schema-response success variant",
  },
  {
    limitKey: "alive_channels_max",
    ruleName: "heartbeat",
    ruleBodyPattern: "[0*65535 app-channel-id]",
    description: "heartbeat alive_channels collection",
  },
  {
    limitKey: "channel_acks_max",
    ruleName: "session-resume",
    ruleBodyPattern: "[0*65535 channel-ack]",
    description: "SessionResume channel_acks collection",
  },
  {
    limitKey: "channel_results_max",
    ruleName: "session-resume-result",
    ruleBodyPattern: "[0*65535 channel-resume-result]",
    description: "SessionResumeResult channel_results collection",
  },
  {
    limitKey: "utf8_text_max_bytes",
    ruleName: "text4k",
    ruleBodyPattern: "tstr .size (0..4096)",
    description: "text4k size ceiling",
  },
  {
    limitKey: "utf8_text_min_nonempty_bytes",
    ruleName: "text-nonempty",
    ruleBodyPattern: "tstr .size (1..4096)",
    description: "text-nonempty size floor",
  },
  {
    limitKey: "credential_bytes_max",
    ruleName: "bytes-cred",
    ruleBodyPattern: "bstr .size (1..65535)",
    description: "credential bytes ceiling",
  },
  {
    limitKey: "type_description_bytes_max",
    ruleName: "bytes-desc",
    ruleBodyPattern: "bstr .size (1..1048576)",
    description: "type_description bytes ceiling",
  },
  {
    limitKey: "control_payload_max_bytes",
    ruleName: "effective-limits",
    ruleBodyPattern: "4 => 0..1048576",
    description: "effective_limits max_control_payload_bytes ceiling",
  },
  {
    limitKey: "control_payload_max_bytes",
    ruleName: "bytes-content",
    ruleBodyPattern: "bstr .size (0..1048576)",
    description: "source bundle content bytes dominated by control_payload_max_bytes",
  },
  {
    limitKey: "frame_payload_max_bytes",
    ruleName: "effective-limits",
    ruleBodyPattern: "3 => 0..67108864",
    description: "effective_limits max_message_bytes ceiling",
  },
  {
    limitKey: "max_channels_ceiling",
    ruleName: "effective-limits",
    ruleBodyPattern: "1 => 0..65535",
    description: "effective_limits max_channels ceiling",
  },
  {
    limitKey: "max_session_bytes_ceiling",
    ruleName: "effective-limits",
    ruleBodyPattern: "2 => 0..4294967296",
    description: "effective_limits max_session_bytes ceiling",
  },
];

/** Direct CDDL ownership pairs used by the auditable surface-list test. */
export const EXPECTED_DIRECT_BOUND_SURFACES: ReadonlyArray<{
  limitKey: string;
  ruleName: string;
}> = [
  { limitKey: "supported_versions_max", ruleName: "wire-version-list" },
  { limitKey: "domain_ids_max", ruleName: "domain-id-list" },
  { limitKey: "domain_id_range", ruleName: "domain-id" },
  { limitKey: "extension_capability_ids_max", ruleName: "capability-id-list" },
  { limitKey: "graph_nodes_max", ruleName: "graph-snapshot" },
  { limitKey: "graph_endpoints_max", ruleName: "graph-snapshot" },
  { limitKey: "graph_delta_ops_max", ruleName: "graph-delta" },
  { limitKey: "source_bundle_entries_max", ruleName: "schema-advertise" },
  { limitKey: "source_bundle_entries_max", ruleName: "schema-response" },
  { limitKey: "alive_channels_max", ruleName: "heartbeat" },
  { limitKey: "channel_acks_max", ruleName: "session-resume" },
  { limitKey: "channel_results_max", ruleName: "session-resume-result" },
  { limitKey: "utf8_text_max_bytes", ruleName: "text4k" },
  { limitKey: "utf8_text_min_nonempty_bytes", ruleName: "text-nonempty" },
  { limitKey: "credential_bytes_max", ruleName: "bytes-cred" },
  { limitKey: "type_description_bytes_max", ruleName: "bytes-desc" },
  { limitKey: "control_payload_max_bytes", ruleName: "effective-limits" },
  { limitKey: "control_payload_max_bytes", ruleName: "bytes-content" },
  { limitKey: "frame_payload_max_bytes", ruleName: "effective-limits" },
  { limitKey: "max_channels_ceiling", ruleName: "effective-limits" },
  { limitKey: "max_session_bytes_ceiling", ruleName: "effective-limits" },
];

export const PHASE_ONE_SUPPORT_ROW_PROFILES: Readonly<
  Record<(typeof PHASE_ONE_ROWS)[number], { ros_distro: string; rmw_identifier: string }>
> = {
  "H-FT": { ros_distro: "humble", rmw_identifier: "rmw_fastrtps_cpp" },
  "H-CY": { ros_distro: "humble", rmw_identifier: "rmw_cyclonedds_cpp" },
  "J-FT": { ros_distro: "jazzy", rmw_identifier: "rmw_fastrtps_cpp" },
  "J-CY": { ros_distro: "jazzy", rmw_identifier: "rmw_cyclonedds_cpp" },
};

/** Accepted non-numeric errors alias entries (exact set). */
export const ERROR_STRING_ALIASES: Readonly<Record<string, string>> = {
  bootstrap_unknown_kind: "malformed_bootstrap",
  bootstrap_state_order_violation: "protocol_violation",
};

/** CDDL type builtins and control operators that are not rule references. */
const CDDL_BUILTINS = new Set([
  "any",
  "uint",
  "nint",
  "int",
  "bstr",
  "bytes",
  "tstr",
  "text",
  "bool",
  "float",
  "float16",
  "float32",
  "float64",
  "null",
  "nil",
  "true",
  "false",
  "undefined",
  // control operators / member keys that appear as bare identifiers in this profile
  "size",
  "bits",
  "regexp",
  "cbor",
  "cborseq",
  "within",
  "and",
]);

function push(diags: string[], msg: string): void {
  diags.push(msg);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeLabel(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesKind(v: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case "const":
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "object":
      return isPlainObject(v);
    case "array":
      return Array.isArray(v);
    default:
      return false;
  }
}

function errorNameByCode(errors: Record<string, unknown>): Map<number, string> {
  const map = new Map<number, string>();
  for (const [code, body] of Object.entries(errors)) {
    if (!/^\d+$/.test(code)) continue;
    const n = Number(code);
    if (isPlainObject(body) && typeof body.name === "string") map.set(n, body.name);
    else if (typeof body === "string") map.set(n, body);
  }
  return map;
}

function errorCodeByName(errors: Record<string, unknown>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [code, name] of errorNameByCode(errors)) map.set(name, code);
  return map;
}

function declaredDispositionNames(dispositions: unknown): Set<string> {
  const names = new Set<string>();
  if (!isPlainObject(dispositions)) return names;
  const assigned = dispositions.assigned;
  if (isPlainObject(assigned)) {
    for (const v of Object.values(assigned)) {
      if (typeof v === "string") names.add(v);
    }
  }
  return names;
}

/** Strip `;` line comments for structural scans. */
export function stripCddlComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(";");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * Replace CDDL text and byte string literals entirely (including h'/b64' prefixes)
 * so literal contents and prefixes cannot be mistaken for rule-name references.
 */
export function stripCddlStringLiterals(text: string): string {
  let s = text;
  // Double-quoted text strings with escapes → empty placeholder
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // hex byte strings including prefix: h'...'
  s = s.replace(/\bh'[0-9a-fA-F]*'/gi, '""');
  // base64 byte strings including prefix: b64'...'
  s = s.replace(/\bb64'[A-Za-z0-9+/=]*'/g, '""');
  // single-quoted byte strings
  s = s.replace(/'(?:\\.|[^'\\])*'/g, '""');
  return s;
}

export function normalizeCddlWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type CddlRule = {
  name: string;
  body: string;
  index: number;
};

/**
 * Parse rule definitions for the accepted R2WP control CDDL profile.
 * First definition is the document root. Duplicate names are reported.
 */
export function parseCddlRules(cddlText: string): {
  rules: CddlRule[];
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const stripped = stripCddlComments(cddlText);
  const rules: CddlRule[] = [];
  const headerRe = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/gm;
  const headers: { name: string; headerEnd: number; headerStart: number }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(stripped)) !== null) {
    headers.push({
      name: hm[1],
      headerStart: hm.index,
      headerEnd: hm.index + hm[0].length,
    });
  }
  if (headers.length === 0) {
    diagnostics.push("cddl: no rule definitions found");
    return { rules, diagnostics };
  }

  const seen = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i].name;
    if (seen.has(name)) {
      diagnostics.push(`cddl: duplicate rule definition "${name}"`);
    } else {
      seen.set(name, i);
    }
    const bodyStart = headers[i].headerEnd;
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].headerStart : stripped.length;
    rules.push({
      name,
      body: stripped.slice(bodyStart, bodyEnd).trim(),
      index: i,
    });
  }
  return { rules, diagnostics };
}

function collectionHasUnboundedOccurrence(inner: string): boolean {
  const text = inner.trim();
  if (!text) return false;
  // * type or + type
  if (
    /(?:^|[\s,])(?:\*|\+)\s*(?:[A-Za-z_#]|0x|\d|"|')/.test(text) ||
    /^(?:\*|\+)\s*(?:[A-Za-z_#]|0x|\d|"|')/.test(text)
  ) {
    return true;
  }
  // n* without m
  const occRe = /(\d*)\*(\d*)/g;
  let om: RegExpExecArray | null;
  while ((om = occRe.exec(text)) !== null) {
    if (om[2] === "" && om[1] !== "") return true;
  }
  return false;
}

/**
 * Delimiter-aware scan of array `[]` and map `{}` groups (including nested outer groups)
 * after comments and string/byte literals are neutralized.
 * Flags `*`, `+`, and `n*` without finite upper bound `n*m`.
 */
export function findUnboundedCddlCollections(cddlText: string): string[] {
  const neutralized = stripCddlStringLiterals(stripCddlComments(cddlText));
  const hits: string[] = [];
  const stack: { kind: "[" | "{"; start: number }[] = [];

  for (let i = 0; i < neutralized.length; i++) {
    const ch = neutralized[i];
    if (ch === "[" || ch === "{") {
      stack.push({ kind: ch, start: i });
      continue;
    }
    if (ch === "]" || ch === "}") {
      const open = ch === "]" ? "[" : "{";
      // pop until matching kind
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === open) {
          const frame = stack[s];
          stack.length = s;
          const inner = neutralized.slice(frame.start + 1, i);
          if (collectionHasUnboundedOccurrence(inner)) {
            const wrapL = frame.kind;
            const wrapR = frame.kind === "[" ? "]" : "}";
            hits.push(`${wrapL}${inner.trim()}${wrapR}`);
          }
          break;
        }
      }
    }
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

function extractCddlIdentifiers(body: string): string[] {
  const cleaned = stripCddlStringLiterals(body);
  const ids: string[] = [];
  const re = /\b([A-Za-z][A-Za-z0-9_-]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

export function buildCddlReferenceGraph(rules: CddlRule[]): {
  defined: Set<string>;
  reachableFromRoot: Set<string>;
  dead: string[];
  undefinedRefs: string[];
} {
  const defined = new Set(rules.map((r) => r.name));
  const root = rules[0]?.name;
  const reachableFromRoot = new Set<string>();
  const undefinedSet = new Set<string>();

  if (root) {
    const stack = [root];
    reachableFromRoot.add(root);
    while (stack.length) {
      const cur = stack.pop()!;
      const rule = rules.find((r) => r.name === cur);
      if (!rule) continue;
      for (const id of extractCddlIdentifiers(rule.body)) {
        if (CDDL_BUILTINS.has(id)) continue;
        if (defined.has(id)) {
          if (!reachableFromRoot.has(id)) {
            reachableFromRoot.add(id);
            stack.push(id);
          }
        } else {
          undefinedSet.add(id);
        }
      }
    }
  }

  // Also scan all rules for undefined refs (not only reachable) for completeness on dead branches
  for (const rule of rules) {
    for (const id of extractCddlIdentifiers(rule.body)) {
      if (CDDL_BUILTINS.has(id)) continue;
      if (!defined.has(id)) undefinedSet.add(id);
    }
  }

  const dead = [...defined].filter((n) => !reachableFromRoot.has(n)).sort((a, b) => a.localeCompare(b));
  const undefinedRefs = [...undefinedSet].sort((a, b) => a.localeCompare(b));
  return { defined, reachableFromRoot, dead, undefinedRefs };
}

/** Expand CDDL integer sets like `1..19 / 21..28` or `1 / 2 / 4`. */
export function expandCddlUintSet(body: string): number[] | null {
  const norm = body.replace(/\s+/g, "");
  if (!norm) return null;
  const parts = norm.split("/");
  const out = new Set<number>();
  for (const part of parts) {
    const range = part.match(/^(\d+)\.\.(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi || hi - lo > 10000) return null;
      for (let i = lo; i <= hi; i++) out.add(i);
      continue;
    }
    const single = part.match(/^(\d+)$/);
    if (single) {
      out.add(Number(single[1]));
      continue;
    }
    return null;
  }
  return [...out].sort((a, b) => a - b);
}

function sameNumberSet(a: number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateAbsoluteLimits(limits: unknown, diags: string[]): void {
  if (!isPlainObject(limits)) return;
  for (const key of Object.keys(ABSOLUTE_LIMIT_SPEC)) {
    if (!(key in limits)) {
      push(diags, `registry: absolute_limits missing "${key}"`);
    }
  }
  for (const key of Object.keys(limits)) {
    if (!(key in ABSOLUTE_LIMIT_SPEC)) {
      push(diags, `registry: absolute_limits has unknown key "${key}"`);
    }
  }
  for (const [key, spec] of Object.entries(ABSOLUTE_LIMIT_SPEC)) {
    if (!(key in limits)) continue;
    const actual = limits[key];
    if (spec.jsonType === "number") {
      if (typeof actual !== "number" || !Number.isFinite(actual)) {
        push(
          diags,
          `registry: absolute_limits.${key} must be number, got ${typeLabel(actual)}`,
        );
      } else if (actual !== spec.value) {
        push(
          diags,
          `registry: absolute_limits.${key} must be ${spec.value}, got ${JSON.stringify(actual)}`,
        );
      }
    } else {
      if (!Array.isArray(actual)) {
        push(
          diags,
          `registry: absolute_limits.${key} must be array, got ${typeLabel(actual)}`,
        );
      } else if (!deepEqualJson(actual, [...spec.value])) {
        push(
          diags,
          `registry: absolute_limits.${key} must be ${JSON.stringify(spec.value)}, got ${JSON.stringify(actual)}`,
        );
      }
    }
  }
}

function validateSupportRowProfiles(profiles: unknown, diags: string[]): void {
  if (!isPlainObject(profiles)) return;
  for (const row of PHASE_ONE_ROWS) {
    if (!(row in profiles)) {
      push(diags, `registry: support_row_profiles missing phase-one row "${row}"`);
      continue;
    }
    const prof = profiles[row];
    const expected = PHASE_ONE_SUPPORT_ROW_PROFILES[row];
    if (!isPlainObject(prof)) {
      push(diags, `registry: support_row_profiles.${row} must be an object`);
      continue;
    }
    const keySet = new Set(Object.keys(prof));
    if (keySet.size !== 2 || !keySet.has("ros_distro") || !keySet.has("rmw_identifier")) {
      push(
        diags,
        `registry: support_row_profiles.${row} must have exactly keys ros_distro and rmw_identifier`,
      );
    }
    if (prof.ros_distro !== expected.ros_distro) {
      push(
        diags,
        `registry: support_row_profiles.${row}.ros_distro must be ${JSON.stringify(expected.ros_distro)}, got ${JSON.stringify(prof.ros_distro)}`,
      );
    }
    if (prof.rmw_identifier !== expected.rmw_identifier) {
      push(
        diags,
        `registry: support_row_profiles.${row}.rmw_identifier must be ${JSON.stringify(expected.rmw_identifier)}, got ${JSON.stringify(prof.rmw_identifier)}`,
      );
    }
  }
  for (const key of Object.keys(profiles)) {
    if (!(PHASE_ONE_ROWS as readonly string[]).includes(key)) {
      push(diags, `registry: support_row_profiles has non-phase-one row "${key}"`);
    }
  }
}

function validateTopLevel(registry: Record<string, unknown>, diags: string[]): void {
  for (const key of Object.keys(registry)) {
    if (!(key in TOP_LEVEL_SPEC)) {
      push(diags, `registry: unknown top-level key "${key}"`);
    }
  }

  for (const [key, spec] of Object.entries(TOP_LEVEL_SPEC)) {
    if (!(key in registry)) {
      push(diags, `registry: missing required field "${key}"`);
      continue;
    }
    const v = registry[key];
    if (v === null) {
      push(diags, `registry: field "${key}" must be ${spec.kind}, got null`);
      continue;
    }
    const kindForMatch =
      spec.kind === "const" ? (typeof spec.value === "number" ? "number" : "string") : spec.kind;
    if (!matchesKind(v, kindForMatch)) {
      push(diags, `registry: field "${key}" must be ${kindForMatch}, got ${typeLabel(v)}`);
      continue;
    }
    if (spec.kind === "const" && v !== spec.value) {
      push(diags, `registry: field "${key}" must be ${JSON.stringify(spec.value)}, got ${JSON.stringify(v)}`);
    }
    if (key === "title") {
      if (typeof v !== "string" || v.length === 0) {
        push(diags, `registry: field "title" must be a non-empty string`);
      }
    }
    // Required object/array collections must be non-empty
    if (spec.kind === "object" && isPlainObject(v) && Object.keys(v).length === 0) {
      push(diags, `registry: field "${key}" must be a non-empty object`);
    }
    if (spec.kind === "array" && Array.isArray(v) && v.length === 0) {
      push(diags, `registry: field "${key}" must be a non-empty array`);
    }
  }

  // phase-one rows exact order
  const rows = registry.phase_one_support_rows;
  if (Array.isArray(rows)) {
    const got = rows.map(String);
    const exp = [...PHASE_ONE_ROWS];
    if (got.length !== exp.length || got.some((r, i) => r !== exp[i])) {
      push(
        diags,
        `registry: phase_one_support_rows must be exactly ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`,
      );
    }
  }

  validateSupportRowProfiles(registry.support_row_profiles, diags);
  validateAbsoluteLimits(registry.absolute_limits, diags);
}

function validateErrorRegistry(errors: Record<string, unknown>, diags: string[]): void {
  const wireSet = new Set<number>(WIRE_ERROR_CODES);
  const bootSet = new Set<number>(BOOTSTRAP_ERROR_CODES);
  const names = new Map<string, string>(); // name -> code key

  // Numeric keys must be exactly 0..28
  for (let code = 0; code <= 28; code++) {
    const key = String(code);
    if (!(key in errors)) {
      push(diags, `registry: errors missing numeric key "${key}"`);
      continue;
    }
    const body = errors[key];
    if (!isPlainObject(body)) {
      push(diags, `registry: errors["${key}"] must be a non-empty named object`);
      continue;
    }
    if (typeof body.name !== "string" || body.name.length === 0) {
      push(diags, `registry: errors["${key}"].name must be a non-empty string`);
    } else {
      if (names.has(body.name)) {
        push(
          diags,
          `registry: errors["${key}"].name "${body.name}" duplicates errors["${names.get(body.name)}"]`,
        );
      } else {
        names.set(body.name, key);
      }
    }
    if (typeof body.wire_usable !== "boolean") {
      push(diags, `registry: errors["${key}"].wire_usable must be boolean`);
    } else {
      const expectWire = wireSet.has(code);
      // code 0 and 20 are not wire-usable; all WIRE_ERROR_CODES are true
      if (code === 0 || code === 20) {
        if (body.wire_usable !== false) {
          push(diags, `registry: errors["${key}"].wire_usable must be false`);
        }
      } else if (expectWire) {
        if (body.wire_usable !== true) {
          push(diags, `registry: errors["${key}"].wire_usable must be true for wire-usable code ${code}`);
        }
      }
    }
    if (bootSet.has(code)) {
      if (body.bootstrap_usable !== true) {
        push(
          diags,
          `registry: errors["${key}"].bootstrap_usable must be true for bootstrap-usable code ${code}`,
        );
      }
    } else if (code === 0) {
      // RESERVED: bootstrap_usable optional; when present must be false
      if ("bootstrap_usable" in body && body.bootstrap_usable !== false) {
        push(diags, `registry: errors["0"].bootstrap_usable must be false when present`);
      }
    } else if (body.bootstrap_usable !== false) {
      push(
        diags,
        `registry: errors["${key}"].bootstrap_usable must be false (code ${code} not in bootstrap set)`,
      );
    }
  }

  // Reject unknown numeric codes outside 0..28
  for (const key of Object.keys(errors)) {
    if (/^\d+$/.test(key)) {
      const n = Number(key);
      if (n < 0 || n > 28) {
        push(diags, `registry: errors has unknown numeric code "${key}" (allowed 0..28 only)`);
      }
    }
  }

  // Exact non-numeric alias set
  const aliasKeys = Object.keys(errors).filter((k) => !/^\d+$/.test(k)).sort((a, b) => a.localeCompare(b));
  const expectedAliasKeys = Object.keys(ERROR_STRING_ALIASES).sort((a, b) => a.localeCompare(b));
  for (const key of expectedAliasKeys) {
    if (!(key in errors)) {
      push(diags, `registry: errors missing required alias "${key}"`);
      continue;
    }
    const body = errors[key];
    const expected = ERROR_STRING_ALIASES[key];
    if (body !== expected) {
      push(
        diags,
        `registry: errors alias "${key}" must be ${JSON.stringify(expected)}, got ${JSON.stringify(body)}`,
      );
    }
  }
  for (const key of aliasKeys) {
    if (!(key in ERROR_STRING_ALIASES)) {
      push(diags, `registry: errors has unknown alias "${key}"`);
    }
  }

  // Code 20 identity
  const e20 = errors["20"];
  if (isPlainObject(e20) && e20.name !== "adapter_profile_mismatch") {
    push(diags, `registry: errors["20"].name must be adapter_profile_mismatch, got ${JSON.stringify(e20.name)}`);
  }
}

/** Frozen selected-frame step 9 include tokens for CONTROL priority precedence. */
export const SELECTED_FRAME_STEP9_REQUIRED_INCLUDES = [
  "numeric_priority_assigned_0_to_4",
  "control_cbor_requires_priority_control_0_after_assigned",
] as const;

export const SELECTED_FRAME_STEP9_CHECK = "numeric_priority_assigned";
export const SELECTED_FRAME_STEP9_ERROR = "protocol_violation";
export const SELECTED_FRAME_STEP9_CODE = 25;

function validateSelectedFrameStep9Priority(
  raw: Record<string, unknown>,
  label: string,
  diags: string[],
): void {
  if (raw.check !== SELECTED_FRAME_STEP9_CHECK) {
    push(
      diags,
      `registry: ${label} check must be "${SELECTED_FRAME_STEP9_CHECK}", got ${JSON.stringify(raw.check)}`,
    );
  }
  if (raw.error !== SELECTED_FRAME_STEP9_ERROR) {
    push(
      diags,
      `registry: ${label} error must be "${SELECTED_FRAME_STEP9_ERROR}", got ${JSON.stringify(raw.error)}`,
    );
  }
  if (raw.code !== SELECTED_FRAME_STEP9_CODE) {
    push(
      diags,
      `registry: ${label} code must be ${SELECTED_FRAME_STEP9_CODE}, got ${JSON.stringify(raw.code)}`,
    );
  }
  const includes = raw.includes;
  if (!Array.isArray(includes)) {
    push(diags, `registry: ${label} must declare includes as an exact ordered array of length 2`);
    return;
  }
  // Exact ordered contract: index 0 then index 1; length exactly 2; both strings.
  const expected = SELECTED_FRAME_STEP9_REQUIRED_INCLUDES;
  if (includes.length !== expected.length) {
    push(
      diags,
      `registry: ${label} includes must have length ${expected.length}, got ${includes.length}`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    const got = includes[i];
    if (typeof got !== "string") {
      push(
        diags,
        `registry: ${label} includes[${i}] must be string "${expected[i]}", got ${JSON.stringify(got)}`,
      );
      continue;
    }
    if (got !== expected[i]) {
      push(
        diags,
        `registry: ${label} includes[${i}] must be "${expected[i]}", got ${JSON.stringify(got)}`,
      );
    }
  }
}

/**
 * Cross-validate opcodes.assigned.1 CONTROL_CBOR priority CONTROL and
 * priorities.assigned.0 CONTROL against the step-9 CONTROL priority contract.
 * Missing or non-object assigned maps produce deterministic diagnostics.
 */
function validateControlPriorityCrossBindings(
  registry: Record<string, unknown>,
  diags: string[],
): void {
  const opcodes = registry.opcodes;
  if (!isPlainObject(opcodes)) {
    push(diags, "registry: opcodes must be an object for CONTROL priority cross-binding");
  } else if (!isPlainObject(opcodes.assigned)) {
    push(diags, "registry: opcodes.assigned must be an object for CONTROL priority cross-binding");
  } else {
    const op1 = opcodes.assigned["1"];
    if (!isPlainObject(op1)) {
      push(diags, 'registry: opcodes.assigned["1"] must be an object (CONTROL_CBOR)');
    } else {
      if (op1.name !== "CONTROL_CBOR") {
        push(
          diags,
          `registry: opcodes.assigned["1"].name must be "CONTROL_CBOR", got ${JSON.stringify(op1.name)}`,
        );
      }
      if (op1.priority !== "CONTROL") {
        push(
          diags,
          `registry: opcodes.assigned["1"].priority must be "CONTROL", got ${JSON.stringify(op1.priority)}`,
        );
      }
    }
  }

  const priorities = registry.priorities;
  if (!isPlainObject(priorities)) {
    push(diags, "registry: priorities must be an object for CONTROL priority cross-binding");
  } else if (!isPlainObject(priorities.assigned)) {
    push(diags, "registry: priorities.assigned must be an object for CONTROL priority cross-binding");
  } else if (priorities.assigned["0"] !== "CONTROL") {
    push(
      diags,
      `registry: priorities.assigned["0"] must be "CONTROL", got ${JSON.stringify(priorities.assigned["0"])}`,
    );
  }
}

function validateErrorsAndValidationOrder(registry: Record<string, unknown>, diags: string[]): void {
  const errors = registry.errors;
  if (!isPlainObject(errors)) return;

  validateErrorRegistry(errors, diags);

  const byName = errorCodeByName(errors);
  const byCode = errorNameByCode(errors);

  const dispositionNames = declaredDispositionNames(registry.dispositions);

  const vo = registry.validation_order;
  if (!isPlainObject(vo)) return;

  for (const section of ["bootstrap", "selected_frame"] as const) {
    const rows = vo[section];
    if (!Array.isArray(rows)) {
      push(diags, `registry: validation_order.${section} must be an array`);
      continue;
    }
    if (rows.length === 0) {
      push(diags, `registry: validation_order.${section} must be non-empty`);
      continue;
    }

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const label = `validation_order.${section}[${i}]`;
      if (!isPlainObject(raw)) {
        push(diags, `registry: ${label} must be an object`);
        continue;
      }

      const step = raw.step;
      if (typeof step !== "number" || !Number.isInteger(step)) {
        push(diags, `registry: ${label} missing integer step`);
      } else if (step !== i + 1) {
        push(diags, `registry: ${label} step must be ${i + 1} (consecutive 1..N), got ${step}`);
      }

      if (typeof raw.check !== "string" || !raw.check) {
        push(diags, `registry: ${label} missing check name`);
      }

      const hasError = Object.prototype.hasOwnProperty.call(raw, "error");
      const errName = raw.error;
      const hasCode = Object.prototype.hasOwnProperty.call(raw, "code");
      const hasDisp = Object.prototype.hasOwnProperty.call(raw, "disposition");

      // Malformed: both error (non-null) and disposition
      if (errName !== null && errName !== undefined && hasDisp) {
        push(diags, `registry: ${label} must not combine error and disposition`);
      }

      if (errName === null || errName === undefined) {
        // disposition-only
        if (errName === undefined && !hasError) {
          // missing error key entirely without disposition
          if (!hasDisp) {
            push(diags, `registry: ${label} must have error (string|null) or disposition`);
            continue;
          }
        }
        if (typeof raw.disposition !== "string" || !raw.disposition) {
          push(diags, `registry: ${label} disposition-only row requires string disposition`);
        } else if (!dispositionNames.has(raw.disposition)) {
          push(
            diags,
            `registry: ${label} disposition "${raw.disposition}" is not declared in dispositions.assigned`,
          );
        }
        if (hasCode) {
          push(diags, `registry: ${label} disposition-only row must not include code`);
        }
        continue;
      }

      if (typeof errName !== "string") {
        push(diags, `registry: ${label} error must be string or null`);
        continue;
      }

      if (errName === "adapter_profile_mismatch") {
        push(diags, `registry: ${label} must not use out-of-band adapter_profile_mismatch`);
      }
      if (!byName.has(errName)) {
        push(diags, `registry: ${label} references unknown error name "${errName}"`);
      }

      if (!hasCode || typeof raw.code !== "number" || !Number.isInteger(raw.code)) {
        push(diags, `registry: ${label} error row requires integer code`);
      } else {
        if (raw.code === 20) {
          push(diags, `registry: ${label} must not use out-of-band code 20`);
        }
        const expected = byName.get(errName);
        if (expected !== undefined && expected !== raw.code) {
          push(
            diags,
            `registry: ${label} error "${errName}" code ${raw.code} does not match registry code ${expected}`,
          );
        }
        const regName = byCode.get(raw.code as number);
        if (regName && regName !== errName) {
          push(
            diags,
            `registry: ${label} code ${raw.code} is registered as "${regName}", not "${errName}"`,
          );
        }
      }

      // selected_frame step 9: CONTROL priority precedence (machine-readable includes)
      if (section === "selected_frame" && step === 9) {
        validateSelectedFrameStep9Priority(raw, label, diags);
      }
    }
  }

  // Cross-bind CONTROL_CBOR priority CONTROL to priorities.assigned.0 and step 9 includes.
  validateControlPriorityCrossBindings(registry, diags);

  // exact_codes: (code+name) XOR disposition; never code 20 / adapter_profile_mismatch
  if (!isPlainObject(vo.exact_codes)) {
    push(diags, "registry: validation_order.exact_codes must be an object");
  } else {
    if (Object.keys(vo.exact_codes).length === 0) {
      push(diags, "registry: validation_order.exact_codes must be a non-empty object");
    }
    for (const [key, body] of Object.entries(vo.exact_codes)) {
      const label = `validation_order.exact_codes.${key}`;
      if (!isPlainObject(body)) {
        push(diags, `registry: ${label} must be an object`);
        continue;
      }
      const hasCodeKey = Object.prototype.hasOwnProperty.call(body, "code");
      const hasNameKey = Object.prototype.hasOwnProperty.call(body, "name");
      const hasDispKey = Object.prototype.hasOwnProperty.call(body, "disposition");
      const code = body.code;
      const name = body.name;
      const disp = body.disposition;

      // Unconditional ban on code 20 / adapter_profile_mismatch in exact_codes
      if (code === 20 || name === "adapter_profile_mismatch") {
        push(
          diags,
          `registry: ${label} must not use code 20 or adapter_profile_mismatch (out-of-band; excluded from every Error payload)`,
        );
      }

      if (hasCodeKey || hasNameKey) {
        if (hasDispKey) {
          push(diags, `registry: ${label} must not mix code/name with disposition`);
        }
        if (typeof code !== "number" || !Number.isInteger(code)) {
          push(diags, `registry: ${label} requires integer code`);
        }
        if (typeof name !== "string" || !name) {
          push(diags, `registry: ${label} requires string name with code`);
        } else if (typeof code === "number" && Number.isInteger(code)) {
          const expected = byName.get(name);
          if (expected === undefined) {
            push(diags, `registry: ${label} unknown error name "${name}"`);
          } else if (expected !== code) {
            push(
              diags,
              `registry: ${label} name "${name}" code ${code} does not match registry code ${expected}`,
            );
          }
          // Legitimate sender-local sequence_exhausted (21) is allowed when mapped correctly
        }
      } else if (hasDispKey) {
        if (typeof disp !== "string" || !disp) {
          push(diags, `registry: ${label} disposition must be a non-empty string`);
        } else if (!dispositionNames.has(disp)) {
          push(
            diags,
            `registry: ${label} disposition "${disp}" is not declared in dispositions.assigned`,
          );
        }
      } else {
        push(diags, `registry: ${label} must be code+name XOR disposition`);
      }
    }
  }
}

function validateCddl(
  cddlText: string,
  registry: Record<string, unknown> | null,
  diags: string[],
): void {
  const { rules, diagnostics } = parseCddlRules(cddlText);
  for (const d of diagnostics) push(diags, d);
  if (rules.length === 0) return;

  if (rules[0].name !== "r2wp-v0-control") {
    push(
      diags,
      `cddl: root rule must be first definition "r2wp-v0-control", got "${rules[0].name}"`,
    );
  }

  const unbounded = findUnboundedCddlCollections(cddlText);
  for (const u of unbounded) {
    push(diags, `cddl: unbounded collection occurrence ${u}`);
  }

  const graph = buildCddlReferenceGraph(rules);
  for (const dead of graph.dead) {
    push(diags, `cddl: unreachable (dead) rule "${dead}"`);
  }
  for (const undef of graph.undefinedRefs) {
    push(diags, `cddl: undefined rule reference "${undef}"`);
  }

  const byName = new Map(rules.map((r) => [r.name, r]));

  // Exact error code sets excluding 20
  const wireRule = byName.get("wire-error-code");
  if (!wireRule) {
    push(diags, 'cddl: missing rule "wire-error-code"');
  } else {
    const expanded = expandCddlUintSet(wireRule.body);
    if (!expanded || !sameNumberSet(expanded, WIRE_ERROR_CODES)) {
      push(
        diags,
        `cddl: wire-error-code must expand to exactly [${WIRE_ERROR_CODES.join(", ")}] (code 20 excluded), got ${expanded ? `[${expanded.join(", ")}]` : JSON.stringify(wireRule.body)}`,
      );
    }
    if (expanded?.includes(20)) {
      push(diags, "cddl: wire-error-code must exclude code 20");
    }
  }

  const bootRule = byName.get("bootstrap-error-code");
  if (!bootRule) {
    push(diags, 'cddl: missing rule "bootstrap-error-code"');
  } else {
    const expanded = expandCddlUintSet(bootRule.body);
    if (!expanded || !sameNumberSet(expanded, BOOTSTRAP_ERROR_CODES)) {
      push(
        diags,
        `cddl: bootstrap-error-code must expand to exactly [${BOOTSTRAP_ERROR_CODES.join(", ")}] (code 20 excluded), got ${expanded ? `[${expanded.join(", ")}]` : JSON.stringify(bootRule.body)}`,
      );
    }
    if (expanded?.includes(20)) {
      push(diags, "cddl: bootstrap-error-code must exclude code 20");
    }
  }

  // Rule-local bound cross-check (values from ABSOLUTE_LIMIT_SPEC only)
  if (registry && isPlainObject(registry.absolute_limits)) {
    for (const m of CDDL_BOUND_SURFACES) {
      const rule = byName.get(m.ruleName);
      if (!rule) {
        push(diags, `bounds: CDDL missing rule "${m.ruleName}" for absolute_limits.${m.limitKey}`);
        continue;
      }
      const bodyNorm = normalizeCddlWs(rule.body);
      const patNorm = normalizeCddlWs(m.ruleBodyPattern);
      if (!bodyNorm.includes(patNorm)) {
        push(
          diags,
          `bounds: rule "${m.ruleName}" missing pattern ${JSON.stringify(m.ruleBodyPattern)} for absolute_limits.${m.limitKey} (${m.description})`,
        );
      }
    }
  }
}

/**
 * Pure validation over supplied registry JSON text and CDDL text.
 * Diagnostics are lexicographically sorted.
 */
export function validateProtocolContract(registryText: string, cddlText: string): ProtocolCheckResult {
  const diags: string[] = [];
  let registry: Record<string, unknown> | null = null;

  try {
    const parsed: unknown = JSON.parse(registryText);
    if (!isPlainObject(parsed)) {
      push(diags, "registry: JSON root must be an object");
    } else {
      registry = parsed;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(diags, `registry: malformed JSON: ${msg}`);
  }

  if (registry) {
    validateTopLevel(registry, diags);
    validateErrorsAndValidationOrder(registry, diags);
  }

  if (typeof cddlText !== "string" || cddlText.length === 0) {
    push(diags, "cddl: empty input");
  } else {
    validateCddl(cddlText, registry, diags);
  }

  diags.sort((a, b) => a.localeCompare(b));
  const ok = diags.length === 0;
  const summary = ok
    ? `status=ok registry_id=r2wp-v0 wire_version=0 phase_one_rows=${PHASE_ONE_ROWS.length} cddl_root=r2wp-v0-control bound_surfaces=${CDDL_BOUND_SURFACES.length} absolute_limits=${Object.keys(ABSOLUTE_LIMIT_SPEC).length}`
    : `status=fail diagnostics=${diags.length}`;

  return { ok, diagnostics: diags, summary };
}

export const DEFAULT_REGISTRY_REL = "protocol/registry/r2wp-v0.json";
export const DEFAULT_CDDL_REL = "protocol/schema/control-v0.cddl";

export async function loadAndValidateProtocolContract(
  root: string = process.cwd(),
): Promise<ProtocolCheckResult> {
  const registryPath = path.join(root, DEFAULT_REGISTRY_REL);
  const cddlPath = path.join(root, DEFAULT_CDDL_REL);
  let registryText = "";
  let cddlText = "";
  const loadDiags: string[] = [];
  try {
    registryText = await readFile(registryPath, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    loadDiags.push(`registry: failed to read ${DEFAULT_REGISTRY_REL}: ${msg}`);
  }
  try {
    cddlText = await readFile(cddlPath, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    loadDiags.push(`cddl: failed to read ${DEFAULT_CDDL_REL}: ${msg}`);
  }
  if (loadDiags.length) {
    loadDiags.sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      diagnostics: loadDiags,
      summary: `status=fail diagnostics=${loadDiags.length}`,
    };
  }
  return validateProtocolContract(registryText, cddlText);
}

export function formatProtocolCheck(result: ProtocolCheckResult): string {
  return result.summary;
}

async function main(): Promise<void> {
  const result = await loadAndValidateProtocolContract(process.cwd());
  for (const d of result.diagnostics) {
    console.error(d);
  }
  console.log(formatProtocolCheck(result));
  if (!result.ok) process.exit(1);
}

if (import.meta.main) {
  await main();
}
