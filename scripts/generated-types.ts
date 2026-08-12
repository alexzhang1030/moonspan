#!/usr/bin/env bun
/**
 * M1-02b generated-types metadata generator / checker.
 *
 * Reads committed CDR corpus inputs under conformance/cdr/ and emits
 * deterministic artifacts under rclweb/generated/metadata/.
 *
 *   bun run scripts/generated-types.ts --write
 *   bun run scripts/generated-types.ts --check
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

export const CORPUS_REL = "conformance/cdr";
export const MANIFEST_REL = `${CORPUS_REL}/manifest.json`;
export const TAIL_SLACK_REL = `${CORPUS_REL}/tail-slack.json`;
export const PROVENANCE_REL = `${CORPUS_REL}/fixtures/provenance/jazzy-rihs-to-bundle.json`;
export const BUNDLES_REL = `${CORPUS_REL}/fixtures/bundles`;
export const OUT_REL = "rclweb/generated/metadata";

export const SCHEMA_VERSION = 1;
export const SCHEMA_GENERATION = 1;
export const ENCODING_CDR1 = 1;
export const CORPUS_ID = "moonspan-ros-cdr-v1";

export const PHASE1_ROOTS = [
  "moonspan_cdr_interfaces/msg/PrimitiveScalars",
  "moonspan_cdr_interfaces/msg/NestedSample",
  "moonspan_cdr_interfaces/msg/Collections",
  "moonspan_cdr_interfaces/srv/EchoNested_Request",
  "moonspan_cdr_interfaces/srv/EchoNested_Response",
  "moonspan_cdr_interfaces/action/MeasureSequence_Goal",
  "moonspan_cdr_interfaces/action/MeasureSequence_Result",
  "moonspan_cdr_interfaces/action/MeasureSequence_Feedback",
  "sensor_msgs/msg/PointCloud2",
] as const;

export type Phase1Root = (typeof PHASE1_ROOTS)[number];

export type RootKind =
  | "msg"
  | "srv_request"
  | "srv_response"
  | "action_goal"
  | "action_result"
  | "action_feedback";

export type Scheme = "moonspan-schema-v1" | "rep2011-rihs";
export type CdrRepresentation = "CDR_LE" | "CDR_BE";
export type Mode = "write" | "check";

export const BOUNDS = {
  max_registry_entries: 256,
  max_sources_per_bundle: 64,
  max_dependency_edges: 256,
  max_source_bytes: 1_048_576,
  max_bundle_bytes: 1_048_576,
  max_scheme_chars: 64,
  max_value_chars: 128,
  max_type_name_chars: 256,
  max_support_row_id_chars: 16,
} as const;

export const ARTIFACT_NAMES = [
  "descriptors.json",
  "identities.json",
  "wire_profiles.json",
  "provenance.json",
  "normalized_sources.json",
] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

export type DescriptorRow = {
  type_name: string;
  descriptor_id: string;
  kind: RootKind;
  bundle_sha256: string;
  dependency_type_names: string[];
};

export type IdentityRow = {
  scheme: Scheme;
  value: string;
  type_name: string;
  encoding: number;
  schema_generation: number;
  descriptor_id: string;
};

export type WireProfileRow = {
  type_name: string;
  support_row_id: string;
  cdr_representation: CdrRepresentation;
  zero_tail_bytes: number;
};

export type ProvenanceRow = {
  rihs: string;
  bundle_sha256: string;
  type_name: string;
};

export type NormalizedSourceRow = {
  type_name: string;
  section_sha256: string;
  field_names: string[];
};

export type Artifacts = {
  descriptors: { schema_version: number; roots: DescriptorRow[] };
  identities: { schema_version: number; identities: IdentityRow[] };
  wire_profiles: { schema_version: number; profiles: WireProfileRow[] };
  provenance: { schema_version: number; mappings: ProvenanceRow[] };
  normalized_sources: { schema_version: number; sources: NormalizedSourceRow[] };
};

export type ArtifactFiles = Record<ArtifactName, string>;

export type BuildOk = { ok: true; artifacts: Artifacts; files: ArtifactFiles };
export type BuildErr = {
  ok: false;
  code: "schema_input_invalid" | "schema_bounds_exceeded";
  reason: string;
};
export type BuildResult = BuildOk | BuildErr;

type BundleSource = {
  type_name: string;
  encoding: string;
  content: string;
};

type BundleDoc = {
  format: string;
  root_type_name: string;
  dependency_graph: Array<{ from: string; to: string }>;
  sources: BundleSource[];
  generator_revision?: string;
};

type ManifestFixture = {
  id: string;
  type_name: string;
  support_row_id: string;
  schema_generation: number;
  encoding: string;
  schema_identity: { scheme: string; value: string };
  type_description: {
    canonical_bundle_path: string;
    canonical_bundle_sha256: string;
  };
  serialized: { endianness: "little" | "big" };
};

type TailSlackFixture = {
  id: string;
  support_row_id: string;
  zero_tail_bytes: number;
};

// --- Pure helpers ---

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
    return { error: "usage: generated-types.ts --write|--check" };
  }
  if (args[0] === "--write") return { mode: "write" };
  if (args[0] === "--check") return { mode: "check" };
  return { error: `unknown mode ${args[0]}` };
}

export function isLowerHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isValidRihs(value: unknown): value is string {
  return typeof value === "string" && /^RIHS01_[0-9a-f]{64}$/.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function rootKind(typeName: string): RootKind | null {
  if (typeName.includes("/msg/")) return "msg";
  if (typeName.endsWith("_Request") && typeName.includes("/srv/")) return "srv_request";
  if (typeName.endsWith("_Response") && typeName.includes("/srv/")) return "srv_response";
  if (typeName.endsWith("_Goal") && typeName.includes("/action/")) return "action_goal";
  if (typeName.endsWith("_Result") && typeName.includes("/action/")) return "action_result";
  if (typeName.endsWith("_Feedback") && typeName.includes("/action/")) return "action_feedback";
  return null;
}

export function parentTypeName(typeName: string, kind: RootKind): string {
  switch (kind) {
    case "msg":
      return typeName;
    case "srv_request":
      return typeName.slice(0, -"_Request".length);
    case "srv_response":
      return typeName.slice(0, -"_Response".length);
    case "action_goal":
      return typeName.slice(0, -"_Goal".length);
    case "action_result":
      return typeName.slice(0, -"_Result".length);
    case "action_feedback":
      return typeName.slice(0, -"_Feedback".length);
  }
}

export function expectedSeparatorCount(kind: RootKind): number {
  switch (kind) {
    case "msg":
      return 0;
    case "srv_request":
    case "srv_response":
      return 1;
    case "action_goal":
    case "action_result":
    case "action_feedback":
      return 2;
  }
}

/**
 * Select the active field-section text for a root from parent interface text.
 * Separator lines are trimmed content exactly `---`.
 */
export function selectInterfaceSection(
  content: string,
  kind: RootKind,
): { ok: true; section: string } | { ok: false; reason: string } {
  const lines = content.split("\n");
  const separators: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") separators.push(i);
  }
  const expected = expectedSeparatorCount(kind);
  if (separators.length !== expected) {
    return {
      ok: false,
      reason: `expected ${expected} --- separator(s) for ${kind}, found ${separators.length}`,
    };
  }
  let start = 0;
  let end = lines.length;
  if (kind === "msg") {
    // whole body
  } else if (kind === "srv_request" || kind === "action_goal") {
    end = separators[0]!;
  } else if (kind === "srv_response") {
    start = separators[0]! + 1;
  } else if (kind === "action_result") {
    start = separators[0]! + 1;
    end = separators[1]!;
  } else if (kind === "action_feedback") {
    start = separators[1]! + 1;
  }
  const section = lines.slice(start, end).join("\n");
  if (section.trim().length === 0) {
    return { ok: false, reason: `empty interface section for ${kind}` };
  }
  return { ok: true, section };
}

/**
 * Parse ROS2 interface field names from a selected section.
 * Skips blanks, `#` comments, and constant lines (containing `=`).
 * Field name is the last whitespace-separated token on a field line.
 */
export function parseFieldNames(
  section: string,
): { ok: true; field_names: string[] } | { ok: false; reason: string } {
  const field_names: string[] = [];
  for (const rawLine of section.split("\n")) {
    const withoutComment = rawLine.replace(/#.*$/, "");
    const line = withoutComment.trim();
    if (line.length === 0) continue;
    if (line.includes("=")) continue;
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < 2) {
      return { ok: false, reason: `malformed field line: ${rawLine}` };
    }
    const name = tokens[tokens.length - 1]!;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return { ok: false, reason: `invalid field name: ${name}` };
    }
    field_names.push(name);
  }
  if (field_names.length === 0) {
    return { ok: false, reason: "interface section has no fields" };
  }
  return { ok: true, field_names };
}

export function endiannessToCdr(endianness: "little" | "big"): CdrRepresentation {
  return endianness === "little" ? "CDR_LE" : "CDR_BE";
}

export function isAcyclic(
  edges: ReadonlyArray<{ from: string; to: string }>,
): boolean {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const { from, to } of edges) {
    nodes.add(from);
    nodes.add(to);
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (n: string): boolean => {
    if (visited.has(n)) return true;
    if (visiting.has(n)) return false;
    visiting.add(n);
    for (const next of adj.get(n) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(n);
    visited.add(n);
    return true;
  };
  for (const n of nodes) {
    if (!visit(n)) return false;
  }
  return true;
}

function inputInvalid(reason: string): BuildErr {
  return { ok: false, code: "schema_input_invalid", reason };
}

function boundsExceeded(limit: string): BuildErr {
  return { ok: false, code: "schema_bounds_exceeded", reason: limit };
}

function checkStringBound(
  value: string,
  limitName: keyof typeof BOUNDS,
): BuildErr | null {
  const max = BOUNDS[limitName];
  if (value.length < 1 || value.length > max) {
    return boundsExceeded(limitName);
  }
  return null;
}

// --- Build ---

export function buildArtifacts(input: {
  manifestFixtures: ManifestFixture[];
  tailSlackFixtures: TailSlackFixture[];
  provenanceMappings: ProvenanceRow[];
  bundlesBySha: Map<string, { text: string; doc: BundleDoc }>;
}): BuildResult {
  const { manifestFixtures, tailSlackFixtures, provenanceMappings, bundlesBySha } =
    input;

  const phase1Set = new Set<string>(PHASE1_ROOTS);
  const rootsSeen = new Set<string>();

  // Index fixtures by type for Phase 1 roots.
  const fixturesByType = new Map<string, ManifestFixture[]>();
  for (const f of manifestFixtures) {
    if (!phase1Set.has(f.type_name)) {
      return inputInvalid(`unknown type_name outside Phase 1 surface: ${f.type_name}`);
    }
    rootsSeen.add(f.type_name);
    const list = fixturesByType.get(f.type_name) ?? [];
    list.push(f);
    fixturesByType.set(f.type_name, list);
  }
  for (const root of PHASE1_ROOTS) {
    if (!fixturesByType.has(root)) {
      return inputInvalid(`missing Phase 1 root fixtures: ${root}`);
    }
  }

  const tailById = new Map<string, TailSlackFixture>();
  for (const row of tailSlackFixtures) {
    if (tailById.has(row.id)) {
      return inputInvalid(`duplicate tail-slack fixture id ${row.id}`);
    }
    tailById.set(row.id, row);
  }

  // Provenance: exactly one mapping per Phase 1 root type_name.
  const provByType = new Map<string, ProvenanceRow>();
  for (const row of provenanceMappings) {
    if (!isValidRihs(row.rihs)) {
      return inputInvalid(`invalid RIHS form: ${row.rihs}`);
    }
    if (!isLowerHexSha256(row.bundle_sha256)) {
      return inputInvalid(`invalid provenance bundle_sha256: ${row.bundle_sha256}`);
    }
    const bound =
      checkStringBound(row.type_name, "max_type_name_chars") ??
      checkStringBound(row.rihs, "max_value_chars") ??
      checkStringBound(row.bundle_sha256, "max_value_chars");
    if (bound) return bound;
    if (provByType.has(row.type_name)) {
      return inputInvalid(`duplicate provenance type_name ${row.type_name}`);
    }
    provByType.set(row.type_name, row);
  }
  for (const root of PHASE1_ROOTS) {
    if (!provByType.has(root)) {
      return inputInvalid(`missing Jazzy RIHS provenance for ${root}`);
    }
  }
  if (provByType.size !== PHASE1_ROOTS.length) {
    return inputInvalid(
      `provenance mapping count ${provByType.size} != ${PHASE1_ROOTS.length}`,
    );
  }

  const descriptors: DescriptorRow[] = [];
  const identities: IdentityRow[] = [];
  const normalized_sources: NormalizedSourceRow[] = [];

  for (const type_name of [...PHASE1_ROOTS].sort(asciiCompare)) {
    const kind = rootKind(type_name);
    if (!kind) return inputInvalid(`cannot classify root kind: ${type_name}`);
    const fixtures = fixturesByType.get(type_name)!;
    const bundleShas = new Set(
      fixtures.map((f) => f.type_description.canonical_bundle_sha256),
    );
    if (bundleShas.size !== 1) {
      return inputInvalid(`inconsistent bundle digests for ${type_name}`);
    }
    const bundle_sha256 = [...bundleShas][0]!;
    if (!isLowerHexSha256(bundle_sha256)) {
      return inputInvalid(`invalid bundle_sha256 for ${type_name}`);
    }
    const loaded = bundlesBySha.get(bundle_sha256);
    if (!loaded) {
      return inputInvalid(`missing bundle file for ${bundle_sha256}`);
    }
    const digest = sha256Hex(loaded.text);
    if (digest !== bundle_sha256) {
      return inputInvalid(
        `bundle digest identity mismatch for ${bundle_sha256}: sha256(file)=${digest}`,
      );
    }
    const stemOk = bundlesBySha.has(bundle_sha256);
    if (!stemOk) {
      return inputInvalid(`bundle filename stem mismatch for ${bundle_sha256}`);
    }

    // Bounds: bundle bytes
    if (
      loaded.text.length < 1 ||
      loaded.text.length > BOUNDS.max_bundle_bytes
    ) {
      return boundsExceeded("max_bundle_bytes");
    }

    const doc = loaded.doc;
    if (doc.root_type_name !== type_name) {
      return inputInvalid(
        `bundle root_type_name ${doc.root_type_name} != ${type_name}`,
      );
    }
    if (!Array.isArray(doc.sources) || !Array.isArray(doc.dependency_graph)) {
      return inputInvalid(`bundle malformed for ${type_name}`);
    }
    if (
      doc.sources.length < 1 ||
      doc.sources.length > BOUNDS.max_sources_per_bundle
    ) {
      return boundsExceeded("max_sources_per_bundle");
    }
    if (doc.dependency_graph.length > BOUNDS.max_dependency_edges) {
      return boundsExceeded("max_dependency_edges");
    }

    const sourceNames = new Set<string>();
    const sourceByName = new Map<string, BundleSource>();
    for (const src of doc.sources) {
      if (typeof src.type_name !== "string" || src.type_name.length === 0) {
        return inputInvalid(`bundle source missing type_name in ${bundle_sha256}`);
      }
      if (sourceNames.has(src.type_name)) {
        return inputInvalid(
          `duplicate source type_name ${src.type_name} in ${bundle_sha256}`,
        );
      }
      sourceNames.add(src.type_name);
      if (src.encoding !== "ROS2_INTERFACE_TEXT") {
        return inputInvalid(
          `unsupported source encoding ${src.encoding} for ${src.type_name}`,
        );
      }
      if (typeof src.content !== "string") {
        return inputInvalid(`source content must be string for ${src.type_name}`);
      }
      const bytes = Buffer.byteLength(src.content, "utf8");
      if (bytes < 1 || bytes > BOUNDS.max_source_bytes) {
        return boundsExceeded("max_source_bytes");
      }
      sourceByName.set(src.type_name, src);
    }

    const parent = parentTypeName(type_name, kind);
    if (!sourceByName.has(parent) && !sourceByName.has(type_name)) {
      return inputInvalid(
        `bundle missing source for root/parent ${parent} (${type_name})`,
      );
    }
    // Root or parent must be present (sectioned roots use parent).
    if (kind === "msg") {
      if (!sourceByName.has(type_name)) {
        return inputInvalid(`bundle missing msg source ${type_name}`);
      }
    } else if (!sourceByName.has(parent)) {
      return inputInvalid(`bundle missing parent source ${parent} for ${type_name}`);
    }

    const knownTypes = new Set(sourceNames);
    knownTypes.add(type_name);
    for (const edge of doc.dependency_graph) {
      // Sectioned roots appear as graph endpoints while interface text lives on the parent.
      if (!knownTypes.has(edge.from) || !knownTypes.has(edge.to)) {
        return inputInvalid(
          `dependency endpoint missing in ${bundle_sha256}: ${edge.from} -> ${edge.to}`,
        );
      }
    }
    if (!isAcyclic(doc.dependency_graph)) {
      return inputInvalid(`cyclic dependency graph in ${bundle_sha256}`);
    }

    const dependency_type_names = [
      ...new Set(
        doc.dependency_graph
          .filter((e) => e.from === type_name)
          .map((e) => e.to),
      ),
    ].sort(asciiCompare);

    const sourceText = sourceByName.get(kind === "msg" ? type_name : parent)!;
    const selected = selectInterfaceSection(sourceText.content, kind);
    if (!selected.ok) {
      return inputInvalid(`${type_name}: ${selected.reason}`);
    }
    const parsed = parseFieldNames(selected.section);
    if (!parsed.ok) {
      return inputInvalid(`${type_name}: ${parsed.reason}`);
    }

    const descriptor_id = type_name;
    descriptors.push({
      type_name,
      descriptor_id,
      kind,
      bundle_sha256,
      dependency_type_names,
    });
    normalized_sources.push({
      type_name,
      section_sha256: sha256Hex(selected.section),
      field_names: parsed.field_names,
    });

    // Moonspan identity from bundle digest.
    const moonspanValue = bundle_sha256;
    const moonBound =
      checkStringBound("moonspan-schema-v1", "max_scheme_chars") ??
      checkStringBound(moonspanValue, "max_value_chars") ??
      checkStringBound(type_name, "max_type_name_chars");
    if (moonBound) return moonBound;

    // RIHS from provenance, joined to bundle + Jazzy fixtures.
    const prov = provByType.get(type_name)!;
    if (prov.bundle_sha256 !== bundle_sha256) {
      return inputInvalid(
        `provenance bundle_sha256 ${prov.bundle_sha256} != ${bundle_sha256} for ${type_name}`,
      );
    }
    const jazzyFixtures = fixtures.filter(
      (f) => f.schema_identity.scheme === "rep2011-rihs",
    );
    if (jazzyFixtures.length === 0) {
      return inputInvalid(`missing Jazzy RIHS fixtures for ${type_name}`);
    }
    for (const jf of jazzyFixtures) {
      if (jf.schema_identity.value !== prov.rihs) {
        return inputInvalid(
          `Jazzy RIHS fixture ${jf.id} value != provenance for ${type_name}`,
        );
      }
      if (jf.type_description.canonical_bundle_sha256 !== bundle_sha256) {
        return inputInvalid(
          `Jazzy fixture ${jf.id} bundle digest mismatch for ${type_name}`,
        );
      }
    }
    const humbleFixtures = fixtures.filter(
      (f) => f.schema_identity.scheme === "moonspan-schema-v1",
    );
    if (humbleFixtures.length === 0) {
      return inputInvalid(`missing Humble moonspan fixtures for ${type_name}`);
    }
    for (const hf of humbleFixtures) {
      if (hf.schema_identity.value !== moonspanValue) {
        return inputInvalid(
          `Humble moonspan fixture ${hf.id} value != bundle digest for ${type_name}`,
        );
      }
    }

    // Manifest join: encoding / schema_generation
    for (const f of fixtures) {
      if (f.encoding !== "CDR1") {
        return inputInvalid(`${f.id}: encoding must be CDR1`);
      }
      if (f.schema_generation !== SCHEMA_GENERATION) {
        return inputInvalid(`${f.id}: schema_generation must be ${SCHEMA_GENERATION}`);
      }
      if (
        f.type_description.canonical_bundle_path !==
        `fixtures/bundles/${bundle_sha256}.json`
      ) {
        return inputInvalid(`${f.id}: canonical_bundle_path mismatch`);
      }
      const rowBound = checkStringBound(f.support_row_id, "max_support_row_id_chars");
      if (rowBound) return rowBound;
    }

    identities.push({
      scheme: "moonspan-schema-v1",
      value: moonspanValue,
      type_name,
      encoding: ENCODING_CDR1,
      schema_generation: SCHEMA_GENERATION,
      descriptor_id,
    });
    identities.push({
      scheme: "rep2011-rihs",
      value: prov.rihs,
      type_name,
      encoding: ENCODING_CDR1,
      schema_generation: SCHEMA_GENERATION,
      descriptor_id,
    });
  }

  if (identities.length > BOUNDS.max_registry_entries) {
    return boundsExceeded("max_registry_entries");
  }
  if (identities.length !== PHASE1_ROOTS.length * 2) {
    return inputInvalid(
      `expected ${PHASE1_ROOTS.length * 2} identities, got ${identities.length}`,
    );
  }

  // Wire profiles from tail-slack joined to manifest fixtures.
  const profileMap = new Map<string, WireProfileRow>();
  for (const f of manifestFixtures) {
    const tail = tailById.get(f.id);
    if (!tail) {
      return inputInvalid(`missing tail-slack row for fixture ${f.id}`);
    }
    if (tail.support_row_id !== f.support_row_id) {
      return inputInvalid(`tail-slack support_row mismatch for ${f.id}`);
    }
    if (
      tail.zero_tail_bytes !== 0 &&
      tail.zero_tail_bytes !== 4 &&
      tail.zero_tail_bytes !== 12
    ) {
      return inputInvalid(
        `${f.id}: zero_tail_bytes ${tail.zero_tail_bytes} outside {0,4,12}`,
      );
    }
    const endianness = f.serialized.endianness;
    if (endianness !== "little" && endianness !== "big") {
      return inputInvalid(`${f.id}: invalid endianness`);
    }
    const cdr_representation = endiannessToCdr(endianness);
    const key = `${f.type_name}\0${f.support_row_id}\0${cdr_representation}`;
    const row: WireProfileRow = {
      type_name: f.type_name,
      support_row_id: f.support_row_id,
      cdr_representation,
      zero_tail_bytes: tail.zero_tail_bytes,
    };
    const prior = profileMap.get(key);
    if (prior && prior.zero_tail_bytes !== row.zero_tail_bytes) {
      return inputInvalid(
        `conflicting zero_tail for ${f.type_name}/${f.support_row_id}/${cdr_representation}`,
      );
    }
    profileMap.set(key, row);
  }

  // Every Phase 1 root must have both schemes (already enforced) and at least one profile.
  for (const root of PHASE1_ROOTS) {
    const has = [...profileMap.values()].some((p) => p.type_name === root);
    if (!has) return inputInvalid(`missing wire profiles for ${root}`);
  }

  const profiles = [...profileMap.values()].sort((a, b) => {
    const t = asciiCompare(a.type_name, b.type_name);
    if (t !== 0) return t;
    const s = asciiCompare(a.support_row_id, b.support_row_id);
    if (s !== 0) return s;
    return asciiCompare(a.cdr_representation, b.cdr_representation);
  });

  identities.sort((a, b) => {
    const t = asciiCompare(a.type_name, b.type_name);
    if (t !== 0) return t;
    const s = asciiCompare(a.scheme, b.scheme);
    if (s !== 0) return s;
    return asciiCompare(a.value, b.value);
  });

  const provenanceMappingsOut = [...provByType.values()].sort((a, b) =>
    asciiCompare(a.type_name, b.type_name),
  );

  const artifacts: Artifacts = {
    descriptors: { schema_version: SCHEMA_VERSION, roots: descriptors },
    identities: { schema_version: SCHEMA_VERSION, identities },
    wire_profiles: { schema_version: SCHEMA_VERSION, profiles },
    provenance: { schema_version: SCHEMA_VERSION, mappings: provenanceMappingsOut },
    normalized_sources: {
      schema_version: SCHEMA_VERSION,
      sources: normalized_sources,
    },
  };

  const files: ArtifactFiles = {
    "descriptors.json": stableJsonPretty(artifacts.descriptors),
    "identities.json": stableJsonPretty(artifacts.identities),
    "wire_profiles.json": stableJsonPretty(artifacts.wire_profiles),
    "provenance.json": stableJsonPretty(artifacts.provenance),
    "normalized_sources.json": stableJsonPretty(artifacts.normalized_sources),
  };

  return { ok: true, artifacts, files };
}

// --- I/O ---

async function readTextFile(
  root: string,
  rel: string,
  maxBytes: number,
): Promise<{ ok: true; text: string; bytes: Uint8Array } | { ok: false; error: string }> {
  const abs = path.join(root, rel);
  let st;
  try {
    st = await lstat(abs);
  } catch {
    return { ok: false, error: `missing file ${rel}` };
  }
  if (st.isSymbolicLink()) return { ok: false, error: `symlink rejected: ${rel}` };
  if (!st.isFile()) return { ok: false, error: `regular file required: ${rel}` };
  if (st.size > maxBytes) {
    return { ok: false, error: `file size ${st.size} exceeds max ${maxBytes}: ${rel}` };
  }
  const bytes = new Uint8Array(await readFile(abs));
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `read size exceeds max ${maxBytes}: ${rel}` };
  }
  return { ok: true, text: new TextDecoder().decode(bytes), bytes };
}

function parseManifestFixtures(
  raw: unknown,
): { ok: true; fixtures: ManifestFixture[] } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) return { ok: false, reason: "manifest root must be object" };
  if (raw.corpus !== CORPUS_ID) {
    return { ok: false, reason: `manifest corpus ${String(raw.corpus)} != ${CORPUS_ID}` };
  }
  if (!Array.isArray(raw.fixtures)) {
    return { ok: false, reason: "manifest.fixtures must be an array" };
  }
  const fixtures: ManifestFixture[] = [];
  for (const entry of raw.fixtures) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: "manifest fixture must be object" };
    }
    if (
      typeof entry.id !== "string" ||
      typeof entry.type_name !== "string" ||
      typeof entry.support_row_id !== "string" ||
      typeof entry.encoding !== "string" ||
      typeof entry.schema_generation !== "number" ||
      !isPlainObject(entry.schema_identity) ||
      !isPlainObject(entry.type_description) ||
      !isPlainObject(entry.serialized)
    ) {
      return { ok: false, reason: `manifest fixture malformed: ${String(entry.id)}` };
    }
    const scheme = entry.schema_identity.scheme;
    const value = entry.schema_identity.value;
    if (typeof scheme !== "string" || typeof value !== "string") {
      return { ok: false, reason: `${entry.id}: schema_identity malformed` };
    }
    const pathRel = entry.type_description.canonical_bundle_path;
    const sha = entry.type_description.canonical_bundle_sha256;
    if (typeof pathRel !== "string" || typeof sha !== "string") {
      return { ok: false, reason: `${entry.id}: type_description malformed` };
    }
    const endianness = entry.serialized.endianness;
    if (endianness !== "little" && endianness !== "big") {
      return { ok: false, reason: `${entry.id}: endianness must be little|big` };
    }
    fixtures.push({
      id: entry.id,
      type_name: entry.type_name,
      support_row_id: entry.support_row_id,
      schema_generation: entry.schema_generation,
      encoding: entry.encoding,
      schema_identity: { scheme, value },
      type_description: {
        canonical_bundle_path: pathRel,
        canonical_bundle_sha256: sha,
      },
      serialized: { endianness },
    });
  }
  return { ok: true, fixtures };
}

function parseTailSlack(
  raw: unknown,
): { ok: true; fixtures: TailSlackFixture[] } | { ok: false; reason: string } {
  if (!isPlainObject(raw) || !Array.isArray(raw.fixtures)) {
    return { ok: false, reason: "tail-slack.json malformed" };
  }
  const fixtures: TailSlackFixture[] = [];
  for (const entry of raw.fixtures) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: "tail-slack fixture must be object" };
    }
    if (
      typeof entry.id !== "string" ||
      typeof entry.support_row_id !== "string" ||
      typeof entry.zero_tail_bytes !== "number"
    ) {
      return { ok: false, reason: "tail-slack fixture fields malformed" };
    }
    fixtures.push({
      id: entry.id,
      support_row_id: entry.support_row_id,
      zero_tail_bytes: entry.zero_tail_bytes,
    });
  }
  return { ok: true, fixtures };
}

function parseProvenance(
  raw: unknown,
): { ok: true; mappings: ProvenanceRow[] } | { ok: false; reason: string } {
  if (!isPlainObject(raw) || !Array.isArray(raw.mappings)) {
    return { ok: false, reason: "provenance mappings malformed" };
  }
  const mappings: ProvenanceRow[] = [];
  for (const entry of raw.mappings) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: "provenance entry must be object" };
    }
    if (
      typeof entry.rihs !== "string" ||
      typeof entry.bundle_sha256 !== "string" ||
      typeof entry.type_name !== "string"
    ) {
      return { ok: false, reason: "provenance entry fields malformed" };
    }
    mappings.push({
      rihs: entry.rihs,
      bundle_sha256: entry.bundle_sha256,
      type_name: entry.type_name,
    });
  }
  return { ok: true, mappings };
}

function parseBundle(
  text: string,
  sha: string,
): { ok: true; doc: BundleDoc } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `bundle ${sha}: invalid JSON` };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, reason: `bundle ${sha}: root must be object` };
  }
  if (typeof raw.root_type_name !== "string") {
    return { ok: false, reason: `bundle ${sha}: missing root_type_name` };
  }
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.dependency_graph)) {
    return { ok: false, reason: `bundle ${sha}: sources/dependency_graph required` };
  }
  const sources: BundleSource[] = [];
  for (const s of raw.sources) {
    if (!isPlainObject(s)) {
      return { ok: false, reason: `bundle ${sha}: source entry must be object` };
    }
    if (
      typeof s.type_name !== "string" ||
      typeof s.encoding !== "string" ||
      typeof s.content !== "string"
    ) {
      return { ok: false, reason: `bundle ${sha}: source fields malformed` };
    }
    sources.push({
      type_name: s.type_name,
      encoding: s.encoding,
      content: s.content,
    });
  }
  const dependency_graph: Array<{ from: string; to: string }> = [];
  for (const e of raw.dependency_graph) {
    if (!isPlainObject(e) || typeof e.from !== "string" || typeof e.to !== "string") {
      return { ok: false, reason: `bundle ${sha}: dependency edge malformed` };
    }
    dependency_graph.push({ from: e.from, to: e.to });
  }
  return {
    ok: true,
    doc: {
      format: typeof raw.format === "string" ? raw.format : "",
      root_type_name: raw.root_type_name,
      dependency_graph,
      sources,
      generator_revision:
        typeof raw.generator_revision === "string" ? raw.generator_revision : undefined,
    },
  };
}

export async function loadAndBuild(root: string): Promise<BuildResult> {
  const man = await readTextFile(root, MANIFEST_REL, 4 * 1024 * 1024);
  if (!man.ok) return inputInvalid(man.error);
  let manRaw: unknown;
  try {
    manRaw = JSON.parse(man.text);
  } catch {
    return inputInvalid("manifest.json: invalid JSON");
  }
  const fixtures = parseManifestFixtures(manRaw);
  if (!fixtures.ok) return inputInvalid(fixtures.reason);

  const tail = await readTextFile(root, TAIL_SLACK_REL, 2 * 1024 * 1024);
  if (!tail.ok) return inputInvalid(tail.error);
  let tailRaw: unknown;
  try {
    tailRaw = JSON.parse(tail.text);
  } catch {
    return inputInvalid("tail-slack.json: invalid JSON");
  }
  const tailFixtures = parseTailSlack(tailRaw);
  if (!tailFixtures.ok) return inputInvalid(tailFixtures.reason);

  const prov = await readTextFile(root, PROVENANCE_REL, 1 * 1024 * 1024);
  if (!prov.ok) return inputInvalid(prov.error);
  let provRaw: unknown;
  try {
    provRaw = JSON.parse(prov.text);
  } catch {
    return inputInvalid("jazzy-rihs-to-bundle.json: invalid JSON");
  }
  const mappings = parseProvenance(provRaw);
  if (!mappings.ok) return inputInvalid(mappings.reason);

  // Load only bundles referenced by Phase 1 fixtures.
  const needed = new Set<string>();
  for (const f of fixtures.fixtures) {
    needed.add(f.type_description.canonical_bundle_sha256);
  }
  const bundlesBySha = new Map<string, { text: string; doc: BundleDoc }>();
  for (const sha of needed) {
    if (!isLowerHexSha256(sha)) {
      return inputInvalid(`invalid referenced bundle sha ${sha}`);
    }
    const rel = `${BUNDLES_REL}/${sha}.json`;
    const file = await readTextFile(root, rel, BOUNDS.max_bundle_bytes);
    if (!file.ok) return inputInvalid(file.error);
    // Preserve exact file bytes as text for digest identity (UTF-8).
    const text = file.text;
    if (sha256Hex(text) !== sha) {
      return inputInvalid(
        `bundle filename stem ${sha} != sha256 of file bytes`,
      );
    }
    const parsed = parseBundle(text, sha);
    if (!parsed.ok) return inputInvalid(parsed.reason);
    bundlesBySha.set(sha, { text, doc: parsed.doc });
  }

  return buildArtifacts({
    manifestFixtures: fixtures.fixtures,
    tailSlackFixtures: tailFixtures.fixtures,
    provenanceMappings: mappings.mappings,
    bundlesBySha,
  });
}

async function writeArtifactsAtomic(
  root: string,
  files: ArtifactFiles,
): Promise<void> {
  const outDir = path.join(root, OUT_REL);
  await mkdir(outDir, { recursive: true });
  // Reject if outDir is a symlink.
  const st = await lstat(outDir);
  if (st.isSymbolicLink()) {
    throw new Error(`symlink rejected: ${OUT_REL}`);
  }
  const temps: string[] = [];
  try {
    for (const name of ARTIFACT_NAMES) {
      const tmp = path.join(
        outDir,
        `.${name}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
      );
      temps.push(tmp);
      const flags =
        fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0);
      const fh: FileHandle = await open(tmp, flags, 0o644);
      try {
        await fh.writeFile(files[name], "utf8");
      } finally {
        await fh.close();
      }
    }
    for (let i = 0; i < ARTIFACT_NAMES.length; i++) {
      const name = ARTIFACT_NAMES[i]!;
      const tmp = temps[i]!;
      const dest = path.join(outDir, name);
      await rename(tmp, dest);
    }
    temps.length = 0;
  } finally {
    for (const tmp of temps) {
      try {
        await unlink(tmp);
      } catch {
        // already gone
      }
    }
  }
}

export function formatStatusLine(artifacts: Artifacts): string {
  return (
    `generated-types: status=ok roots=${artifacts.descriptors.roots.length}` +
    ` identities=${artifacts.identities.identities.length}` +
    ` profiles=${artifacts.wire_profiles.profiles.length}` +
    ` provenance=${artifacts.provenance.mappings.length}` +
    ` sources=${artifacts.normalized_sources.sources.length}`
  );
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
  const built = await loadAndBuild(root);
  if (!built.ok) {
    console.error(`${built.code}: ${built.reason}`);
    return 1;
  }
  if (parsed.mode === "write") {
    try {
      await writeArtifactsAtomic(root, built.files);
    } catch (err) {
      console.error(
        `schema_input_invalid: write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
    console.log(formatStatusLine(built.artifacts));
    return 0;
  }

  // --check: byte identity against committed artifacts
  for (const name of ARTIFACT_NAMES) {
    const rel = `${OUT_REL}/${name}`;
    const existing = await readTextFile(root, rel, 4 * 1024 * 1024);
    if (!existing.ok) {
      console.error(`schema_generation_drift: missing committed artifact ${rel}`);
      return 1;
    }
    if (existing.text !== built.files[name]) {
      console.error(`schema_generation_drift: ${rel}`);
      return 1;
    }
  }
  console.log(formatStatusLine(built.artifacts));
  return 0;
}

if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
