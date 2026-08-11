#!/usr/bin/env bun
/**
 * R2WP v0 → MoonBit Wasm agreement job generator (M0-03h3).
 *
 * Reads committed valid/boundary, sequence, and malformed sources under
 * protocol/testdata/, closed-validates paths/lengths/SHA-256, and emits
 * deterministic job source at rclmbt/cmd/agree/jobs.mbt for the Wasm emitter.
 *
 * --write  regenerate the committed MoonBit job source
 * --check  regenerate in memory and byte-compare the committed source
 *
 * Jobs embed inputs and malformed oracles only. Success records come from the
 * public MoonBit protocol parsers at emit time.
 */
import path from "node:path";
import {
  checkExpected,
  readBoundedBytes as agreeReadBytes,
  readBoundedText as agreeReadText,
  writeBoundedTextAtomic,
} from "./protocol-agree.ts";
import {
  BINARY_MAX_BYTES,
  FIXTURE_ID_PATTERN,
  MANIFEST_MAX_BYTES,
  ORACLE_TOKEN_PATTERN,
  RECIPE_BYTE_LENGTH,
  RECIPE_CHANNEL_ID,
  RECIPE_CLOCK_ID,
  RECIPE_ID,
  RECIPE_OPCODE,
  RECIPE_PAYLOAD_LENGTH,
  RECIPE_PATTERN_HEX,
  RECIPE_PRIORITY,
  RECIPE_SEQUENCE,
  RECIPE_SHA256,
  compactBytes,
  defaultDecoderContext,
  expandChunks,
  moonStringLiteral,
  parseDecoderContext,
  sha256Hex,
  type ByteChunk,
  type FrameDecoderContext,
  type MalformedOracle,
  type RecipeDescriptor,
} from "./protocol-moonbit-fixtures.ts";

// ---------------------------------------------------------------------------
// Paths and counts
// ---------------------------------------------------------------------------

export const VALID_MANIFEST_REL = "protocol/testdata/manifest.json";
export const MALFORMED_MANIFEST_REL = "protocol/testdata/malformed/manifest.json";
export const SEQUENCES_MANIFEST_REL = "protocol/testdata/sequences/manifest.json";
export const SEQUENCES_DIR_REL = "protocol/testdata/sequences";
export const TESTDATA_REL = "protocol/testdata";
export const EXPECTED_REL = "protocol/testdata/agreement/expected.json";
export const OUTPUT_REL = "rclmbt/cmd/agree/jobs.mbt";
export const GENERATED_BY = "scripts/protocol-moonbit-agree.ts";
export const PROTOCOL_ID = "r2wp-v0";
export const SCHEMA_VERSION = 1;
export const BATCH_ID = "M0-03h3";

export const VALID_TOTAL = 22;
export const SEQUENCES_TOTAL = 28;
export const MALFORMED_TOTAL = 55;
export const OUTCOMES_TOTAL = 105;

/**
 * Generated-source size ceiling (bytes, UTF-8).
 *
 * Reasoned value: 512 KiB. Compact raw/repeat chunks compress ~1 MiB of binary
 * corpus (including the 1 MiB CONTROL payload) plus 26 sequence events into a
 * few tens of kilobytes of job text. Metadata for 101 jobs fits under 64 KiB.
 * 512 KiB leaves headroom while keeping the committed source far below a naive
 * full-payload hex dump.
 */
export const GENERATED_SOURCE_MAX_BYTES = 512 * 1024;

const SOURCE_ID_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgreeJob = {
  id: string;
  corpus: "valid_boundary" | "sequences" | "malformed";
  sourceId: string;
  parserKind: "bootstrap" | "frame";
  representation: "binary" | "segment_recipe";
  byteLength: number;
  inputSha256: string;
  chunks: ByteChunk[] | null;
  recipe: RecipeDescriptor | null;
  decoderContext: FrameDecoderContext | null;
  oracle: MalformedOracle | null;
  expectSuccess: boolean;
};

export type AgreeModel = {
  jobs: AgreeJob[];
  sourceText: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function repoRootFrom(importMetaDir: string): string {
  return path.resolve(importMetaDir, "..");
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

function assertCanonicalRel(rel: string, label: string): void {
  if (
    !rel ||
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    rel.includes("//") ||
    rel.split("/").some((p) => p === "" || p === "." || p === "..")
  ) {
    throw new Error(`${label} requires a canonical repository-relative path: ${rel}`);
  }
}

/**
 * Load a repository-relative binary through the h1 real-directory-chain and
 * bounded regular-file reader. Intermediate directory symlinks are rejected.
 */
async function loadBinaryRel(
  root: string,
  rel: string,
  expectedLen: number,
  expectedSha: string,
  label: string,
): Promise<Uint8Array> {
  assertCanonicalRel(rel, label);
  const read = await agreeReadBytes(root, rel, BINARY_MAX_BYTES);
  if (!read.ok) {
    throw new Error(`${label}: ${read.error}`);
  }
  if (read.bytes.length !== expectedLen) {
    throw new Error(`${label} requires byte_length ${expectedLen}, got ${read.bytes.length}`);
  }
  const hash = sha256Hex(read.bytes);
  if (hash !== expectedSha) {
    throw new Error(`${label} requires sha256 ${expectedSha}, got ${hash}`);
  }
  return read.bytes;
}

async function readJsonRel(
  root: string,
  rel: string,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const read = await agreeReadText(root, rel, maxBytes);
  if (!read.ok) {
    throw new Error(`${label}: ${read.error}`);
  }
  try {
    return JSON.parse(read.text);
  } catch (e) {
    throw new Error(
      `${label}: JSON parse requires success: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function parseOracle(expected: Record<string, unknown>, id: string): MalformedOracle {
  const code = expected.registry_code;
  const name = expected.registry_name;
  const reason = expected.reason;
  const offset = expected.offset;
  const plane = expected.plane;
  const step = expected.step;
  if (typeof code !== "number" || !Number.isSafeInteger(code) || code < 1) {
    throw new Error(`${id}: registry_code requires positive safe integer`);
  }
  if (typeof name !== "string" || !ORACLE_TOKEN_PATTERN.test(name)) {
    throw new Error(`${id}: registry_name requires token form`);
  }
  if (typeof reason !== "string" || !ORACLE_TOKEN_PATTERN.test(reason)) {
    throw new Error(`${id}: reason requires token form`);
  }
  if (plane !== "bootstrap" && plane !== "selected_frame") {
    throw new Error(`${id}: plane requires bootstrap or selected_frame`);
  }
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`${id}: offset requires non-negative safe integer`);
  }
  if (typeof step !== "number" || !Number.isSafeInteger(step)) {
    throw new Error(`${id}: step requires safe integer`);
  }
  if (plane === "bootstrap" && (step < 1 || step > 9)) {
    throw new Error(`${id}: bootstrap step requires 1..9`);
  }
  if (plane === "selected_frame" && (step < 1 || step > 16)) {
    throw new Error(`${id}: selected_frame step requires 1..16`);
  }
  return { code, name, reason, offset, plane, step };
}

function parseRecipe(entry: Record<string, unknown>): RecipeDescriptor {
  const id = String(entry.id);
  if (id !== RECIPE_ID) throw new Error(`segment_recipe requires id ${RECIPE_ID}`);
  if (entry.byte_length !== RECIPE_BYTE_LENGTH) {
    throw new Error(`${id}: recipe byte_length pin`);
  }
  if (entry.payload_length !== RECIPE_PAYLOAD_LENGTH) {
    throw new Error(`${id}: recipe payload_length pin`);
  }
  if (entry.sha256 !== RECIPE_SHA256) throw new Error(`${id}: recipe sha256 pin`);
  const source = entry.source as Record<string, unknown>;
  if (!source || source.$type !== "frame") {
    throw new Error(`${id}: recipe source requires $type frame`);
  }
  const payload = source.payload as Record<string, unknown>;
  if (!payload || payload.$type !== "recipe" || payload.kind !== "pattern_fill") {
    throw new Error(`${id}: recipe payload requires pattern_fill`);
  }
  if (payload.pattern_hex !== RECIPE_PATTERN_HEX) {
    throw new Error(`${id}: recipe pattern_hex pin`);
  }
  if (payload.length !== RECIPE_PAYLOAD_LENGTH) {
    throw new Error(`${id}: recipe length pin`);
  }
  const recipe: RecipeDescriptor = {
    patternHex: RECIPE_PATTERN_HEX,
    length: RECIPE_PAYLOAD_LENGTH,
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
    throw new Error(`${id}: recipe header field pin`);
  }
  return recipe;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildAgreeJobs(root: string): Promise<AgreeModel> {
  // Authoritative h1 closed agreement checker: closed manifests, real directory
  // chains, bounded regular files, and rebuilt expected outcomes.
  const closed = await checkExpected(root);
  if (!closed.ok) {
    const head = closed.diagnostics.slice(0, 24).join("\n");
    throw new Error(
      `closed agreement validation requires success (${closed.diagnostics.length} diagnostics):\n${head}`,
    );
  }
  const expectedIds = closed.doc.outcomes.map((o) => o.id);
  if (expectedIds.length !== OUTCOMES_TOTAL) {
    throw new Error(`expected outcomes require total ${OUTCOMES_TOTAL}`);
  }

  const valid = (await readJsonRel(
    root,
    VALID_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    VALID_MANIFEST_REL,
  )) as { fixtures: Record<string, unknown>[] };
  const malformed = (await readJsonRel(
    root,
    MALFORMED_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    MALFORMED_MANIFEST_REL,
  )) as { fixtures: Record<string, unknown>[] };
  const sequences = (await readJsonRel(
    root,
    SEQUENCES_MANIFEST_REL,
    MANIFEST_MAX_BYTES,
    SEQUENCES_MANIFEST_REL,
  )) as { events: Record<string, unknown>[] };

  if (!Array.isArray(valid.fixtures) || valid.fixtures.length !== VALID_TOTAL) {
    throw new Error(`valid fixtures require total ${VALID_TOTAL}`);
  }
  if (!Array.isArray(malformed.fixtures) || malformed.fixtures.length !== MALFORMED_TOTAL) {
    throw new Error(`malformed fixtures require total ${MALFORMED_TOTAL}`);
  }
  if (!Array.isArray(sequences.events) || sequences.events.length !== SEQUENCES_TOTAL) {
    throw new Error(`sequence events require total ${SEQUENCES_TOTAL}`);
  }

  const jobs: AgreeJob[] = [];

  for (const raw of valid.fixtures) {
    const id = String(raw.id);
    if (!FIXTURE_ID_PATTERN.test(id) && !SOURCE_ID_TOKEN.test(id)) {
      throw new Error(`valid fixture id form: ${id}`);
    }
    const kind = raw.kind;
    const representation = raw.representation;
    const byteLength = Number(raw.byte_length);
    const sha256 = String(raw.sha256);
    if (kind !== "bootstrap" && kind !== "frame") {
      throw new Error(`${id}: kind requires bootstrap or frame`);
    }
    if (representation === "segment_recipe") {
      const recipe = parseRecipe(raw);
      jobs.push({
        id: `valid_boundary:${id}`,
        corpus: "valid_boundary",
        sourceId: id,
        parserKind: "frame",
        representation: "segment_recipe",
        byteLength,
        inputSha256: sha256,
        chunks: null,
        recipe,
        decoderContext: defaultDecoderContext(),
        oracle: null,
        expectSuccess: true,
      });
      continue;
    }
    if (representation !== "binary") {
      throw new Error(`${id}: representation requires binary or segment_recipe`);
    }
    const rel = String(raw.path);
    assertCanonicalRel(rel, `${id} path`);
    if (!(rel.startsWith("valid/") || rel.startsWith("malformed/"))) {
      throw new Error(`${id} path requires valid/ or malformed/ prefix`);
    }
    const repoRel = path.posix.join(TESTDATA_REL, rel);
    const bytes = await loadBinaryRel(root, repoRel, byteLength, sha256, id);
    const chunks = compactBytes(bytes);
    const expanded = expandChunks(chunks);
    if (expanded.length !== bytes.length || sha256Hex(expanded) !== sha256) {
      throw new Error(`${id}: compact roundtrip requires identity`);
    }
    jobs.push({
      id: `valid_boundary:${id}`,
      corpus: "valid_boundary",
      sourceId: id,
      parserKind: kind,
      representation: "binary",
      byteLength,
      inputSha256: sha256,
      chunks,
      recipe: null,
      decoderContext: kind === "frame" ? defaultDecoderContext() : null,
      oracle: null,
      expectSuccess: true,
    });
  }

  for (const raw of sequences.events) {
    const id = String(raw.id);
    const carrier = String(raw.carrier);
    const rel = String(raw.path);
    const byteLength = Number(raw.byte_length);
    const sha256 = String(raw.sha256);
    assertCanonicalRel(rel, `${id} path`);
    const repoRel = path.posix.join(SEQUENCES_DIR_REL, rel);
    const bytes = await loadBinaryRel(root, repoRel, byteLength, sha256, id);
    const chunks = compactBytes(bytes);
    const expanded = expandChunks(chunks);
    if (expanded.length !== bytes.length || sha256Hex(expanded) !== sha256) {
      throw new Error(`${id}: compact roundtrip requires identity`);
    }
    let parserKind: "bootstrap" | "frame";
    if (carrier === "bootstrap") parserKind = "bootstrap";
    else if (carrier === "control_cbor" || carrier === "ros_sample") parserKind = "frame";
    else throw new Error(`${id}: carrier requires bootstrap, control_cbor, or ros_sample`);
    jobs.push({
      id: `sequences:${id}`,
      corpus: "sequences",
      sourceId: id,
      parserKind,
      representation: "binary",
      byteLength,
      inputSha256: sha256,
      chunks,
      recipe: null,
      decoderContext: parserKind === "frame" ? defaultDecoderContext() : null,
      oracle: null,
      expectSuccess: true,
    });
  }

  for (const raw of malformed.fixtures) {
    const id = String(raw.id);
    const kind = raw.kind;
    const rel = String(raw.path);
    const byteLength = Number(raw.byte_length);
    const sha256 = String(raw.sha256);
    if (kind !== "bootstrap" && kind !== "frame") {
      throw new Error(`${id}: kind requires bootstrap or frame`);
    }
    assertCanonicalRel(rel, `${id} path`);
    if (!(rel.startsWith("valid/") || rel.startsWith("malformed/"))) {
      throw new Error(`${id} path requires valid/ or malformed/ prefix`);
    }
    const repoRel = path.posix.join(TESTDATA_REL, rel);
    const bytes = await loadBinaryRel(root, repoRel, byteLength, sha256, id);
    const chunks = compactBytes(bytes);
    const expanded = expandChunks(chunks);
    if (expanded.length !== bytes.length || sha256Hex(expanded) !== sha256) {
      throw new Error(`${id}: compact roundtrip requires identity`);
    }
    if (!raw.expected || typeof raw.expected !== "object") {
      throw new Error(`${id}: malformed requires expected oracle`);
    }
    const oracle = parseOracle(raw.expected as Record<string, unknown>, id);
    const decoderContext =
      kind === "frame"
        ? parseDecoderContext(raw.decoder_context as Record<string, unknown> | undefined)
        : null;
    jobs.push({
      id: `malformed:${id}`,
      corpus: "malformed",
      sourceId: id,
      parserKind: kind,
      representation: "binary",
      byteLength,
      inputSha256: sha256,
      chunks,
      recipe: null,
      decoderContext,
      oracle,
      expectSuccess: false,
    });
  }

  jobs.sort((a, b) => asciiCompare(a.id, b.id));
  if (jobs.length !== OUTCOMES_TOTAL) {
    throw new Error(`jobs total ${jobs.length} requires ${OUTCOMES_TOTAL}`);
  }
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i]!.id !== expectedIds[i]) {
      throw new Error(
        `job id order requires expected.json match at ${i}: ${jobs[i]!.id} vs ${expectedIds[i]}`,
      );
    }
  }
  const success = jobs.filter((j) => j.expectSuccess).length;
  const error = jobs.filter((j) => !j.expectSuccess).length;
  if (success !== VALID_TOTAL + SEQUENCES_TOTAL || error !== MALFORMED_TOTAL) {
    throw new Error(
      `jobs success/error counts require ${VALID_TOTAL + SEQUENCES_TOTAL}/${MALFORMED_TOTAL}, got ${success}/${error}`,
    );
  }

  const sourceText = renderJobsSource(jobs);
  const size = Buffer.byteLength(sourceText, "utf8");
  if (size > GENERATED_SOURCE_MAX_BYTES) {
    throw new Error(
      `generated source ${size} bytes exceeds ceiling ${GENERATED_SOURCE_MAX_BYTES}`,
    );
  }
  return { jobs, sourceText };
}

// ---------------------------------------------------------------------------
// MoonBit rendering
// ---------------------------------------------------------------------------

function renderChunks(chunks: ByteChunk[]): string {
  const parts = chunks.map((c) => {
    if (c.kind === "raw") {
      return `ByteChunk::Raw(${moonStringLiteral(c.hex)})`;
    }
    return `ByteChunk::Rep(${moonStringLiteral(c.hex)}, ${c.count})`;
  });
  return `[${parts.join(", ")}]`;
}

function renderDecoderContext(ctx: FrameDecoderContext): string {
  return `{ selected_version: ${ctx.selectedVersion}, experimental_opcodes_enabled: ${
    ctx.experimentalOpcodesEnabled ? "true" : "false"
  }, available_clock_ids: [${ctx.availableClockIds.join(", ")}] }`;
}

function renderOracle(o: MalformedOracle): string {
  return `{ code: ${o.code}, name: ${moonStringLiteral(o.name)}, reason: ${moonStringLiteral(
    o.reason,
  )}, offset: ${o.offset}, plane: ${moonStringLiteral(o.plane)}, step: ${o.step} }`;
}

function renderRecipe(r: RecipeDescriptor): string {
  return `{ pattern_hex: ${moonStringLiteral(r.patternHex)}, length: ${r.length}, opcode: ${
    r.opcode
  }, channel_id: ${r.channelId}, sequence: ${r.sequence}, priority: ${r.priority}, clock_id: ${
    r.clockId
  } }`;
}

function renderJob(job: AgreeJob): string {
  const body =
    job.recipe !== null
      ? `JobBody::SegmentRecipe(${renderRecipe(job.recipe)})`
      : `JobBody::Binary(${renderChunks(job.chunks!)})`;
  const ctx =
    job.decoderContext === null
      ? "None"
      : `Some(${renderDecoderContext(job.decoderContext)})`;
  const oracle = job.oracle === null ? "None" : `Some(${renderOracle(job.oracle)})`;
  return `{
    id: ${moonStringLiteral(job.id)},
    corpus: ${moonStringLiteral(job.corpus)},
    source_id: ${moonStringLiteral(job.sourceId)},
    parser_kind: ${moonStringLiteral(job.parserKind)},
    representation: ${moonStringLiteral(job.representation)},
    byte_length: ${job.byteLength},
    input_sha256: ${moonStringLiteral(job.inputSha256)},
    body: ${body},
    decoder_context: ${ctx},
    oracle: ${oracle},
    expect_success: ${job.expectSuccess ? "true" : "false"},
  }`;
}

export function renderJobsSource(jobs: AgreeJob[]): string {
  const lines: string[] = [];
  lines.push(`// Generated by ${GENERATED_BY}.`);
  lines.push("// Regenerate with bun run scripts/protocol-moonbit-agree.ts --write.");
  lines.push(`// protocol: ${PROTOCOL_ID}`);
  lines.push(`// batch: ${BATCH_ID}`);
  lines.push(
    `// sources: ${VALID_MANIFEST_REL}, ${SEQUENCES_MANIFEST_REL}, ${MALFORMED_MANIFEST_REL}`,
  );
  lines.push("//");
  lines.push("// Agreement job table for M0-03h3: embeds compact input bytes, the");
  lines.push("// 64 MiB segment recipe descriptor, decoder contexts, and malformed");
  lines.push("// oracles. Success records come from parse_bootstrap/parse_frame.");
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
  lines.push("priv enum JobBody {");
  lines.push("  Binary(Array[ByteChunk])");
  lines.push("  SegmentRecipe(RecipeDescriptor)");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("priv struct AgreeJob {");
  lines.push("  id : String");
  lines.push("  corpus : String");
  lines.push("  source_id : String");
  lines.push("  parser_kind : String");
  lines.push("  representation : String");
  lines.push("  byte_length : Int");
  lines.push("  input_sha256 : String");
  lines.push("  body : JobBody");
  lines.push("  decoder_context : FrameDecoderContext?");
  lines.push("  oracle : MalformedOracle?");
  lines.push("  expect_success : Bool");
  lines.push("}");
  lines.push("");
  lines.push("///|");
  lines.push("let agree_jobs : Array[AgreeJob] = [");
  for (let i = 0; i < jobs.length; i++) {
    const rendered = renderJob(jobs[i]!);
    lines.push(rendered + (i + 1 < jobs.length ? "," : ","));
  }
  lines.push("]");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

export async function writeJobs(root: string): Promise<AgreeModel> {
  const model = await buildAgreeJobs(root);
  const w = await writeBoundedTextAtomic(
    root,
    OUTPUT_REL,
    model.sourceText,
    GENERATED_SOURCE_MAX_BYTES,
  );
  if (!w.ok) {
    throw new Error(`write ${OUTPUT_REL}: ${w.error}`);
  }
  return model;
}

export async function checkJobs(
  root: string,
): Promise<{ ok: true; model: AgreeModel } | { ok: false; diagnostics: string[] }> {
  const diags: string[] = [];
  let model: AgreeModel;
  try {
    model = await buildAgreeJobs(root);
  } catch (e) {
    return {
      ok: false,
      diagnostics: [`build failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const read = await agreeReadText(root, OUTPUT_REL, GENERATED_SOURCE_MAX_BYTES);
  if (!read.ok) {
    return {
      ok: false,
      diagnostics: [`${OUTPUT_REL}: ${read.error}`],
    };
  }
  if (read.text !== model.sourceText) {
    diags.push(`${OUTPUT_REL}: committed source requires canonical rebuild`);
  }
  if (diags.length > 0) return { ok: false, diagnostics: diags };
  return { ok: true, model };
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
      const model = await writeJobs(root);
      console.log(
        JSON.stringify({
          mode: "write",
          output: OUTPUT_REL,
          jobs: model.jobs.length,
          bytes: Buffer.byteLength(model.sourceText, "utf8"),
          status: "ok",
        }),
      );
      return 0;
    }
    const result = await checkJobs(root);
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
        jobs: result.model.jobs.length,
        bytes: Buffer.byteLength(result.model.sourceText, "utf8"),
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
