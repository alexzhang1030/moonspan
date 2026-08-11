#!/usr/bin/env bun
/**
 * Qualification report v1 filesystem checker and CLI (M0-05a).
 *
 * Model: evidence-model.ts. Runtime validation: evidence-contract.ts.
 * Schema generation: evidence-schema.ts.
 * This module owns schema write/check, corpus closure, artifact integrity, CLI.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_MAX_BYTES,
  REPORT_MAX_BYTES,
  SCHEMA_MAX_BYTES,
  SCHEMA_REL,
  VALID_DIR_REL,
  asciiCompare,
  resolveUnderRoot,
  stableJsonPretty,
} from "./evidence-model.ts";
import { validateReportDocument } from "./evidence-contract.ts";
import {
  buildQualificationReportSchema,
  schemaCanonicalBytes,
} from "./evidence-schema.ts";

export type EvidenceCheckResult = {
  ok: boolean;
  diagnostics: string[];
  summary: string;
  reports: number;
};

export type Mode = "check" | "write";

// Re-export the stable test-facing API (model + contract + schema).
export {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_ROLES,
  DECISIONS,
  EVIDENCE_LEVELS,
  GATES,
  GATE_EVIDENCE_LEVELS,
  LEVELS_REQUIRING_SUPPORT_ROW,
  MEDIA_TYPE_MAX_LENGTH,
  PATH_MAX_LENGTH,
  PATH_RELATIVE_PATTERN,
  PLATFORMS,
  REPORT_ID,
  REPORT_MAX_BYTES,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_MIN,
  SCHEMA_MAX_BYTES,
  SCHEMA_REL,
  SCHEMA_VERSION,
  SUPPORT_ROWS,
  VALID_DIR_REL,
  asciiCompare,
  isValidCalendarDate,
  resolveUnderRoot,
  stableJsonPretty,
} from "./evidence-model.ts";
export { validateReportDocument } from "./evidence-contract.ts";
export { buildQualificationReportSchema, schemaCanonicalBytes } from "./evidence-schema.ts";

export function parseCliMode(args: string[]): { mode: Mode } | { error: string } {
  if (args.length === 0) return { mode: "check" };
  if (args.length !== 1) {
    return { error: "usage: evidence-check.ts [--check|--write]" };
  }
  if (args[0] === "--check") return { mode: "check" };
  if (args[0] === "--write") return { mode: "write" };
  return { error: `unknown mode ${args[0]}` };
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function push(diags: string[], message: string): void {
  diags.push(message);
}

/** Reject symlinks in every ancestor from root through the relative path. */
export async function ensureRealPathChain(
  root: string,
  rel: string,
  opts: { mustExist: boolean; expect: "file" | "directory" | "either" },
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  const resolved = resolveUnderRoot(root, rel === "" ? "." : rel);
  // "." is special: validate root itself
  let abs: string;
  if (rel === "" || rel === ".") {
    abs = path.resolve(root);
  } else {
    if (!resolved.ok) return resolved;
    abs = resolved.abs;
  }

  try {
    const rootSt = await lstat(path.resolve(root));
    if (rootSt.isSymbolicLink()) return { ok: false, error: "root is a symlink" };
    if (!rootSt.isDirectory()) return { ok: false, error: "root is not a directory" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `root lstat failed: ${msg}` };
  }

  if (rel !== "" && rel !== ".") {
    const segments = rel.split("/").filter(Boolean);
    let cursor = path.resolve(root);
    for (let i = 0; i < segments.length; i++) {
      cursor = path.join(cursor, segments[i]!);
      try {
        const st = await lstat(cursor);
        if (st.isSymbolicLink()) {
          return { ok: false, error: `symlink rejected at ${segments.slice(0, i + 1).join("/")}` };
        }
        const isLast = i === segments.length - 1;
        if (!isLast && !st.isDirectory()) {
          return { ok: false, error: `ancestor is not a directory: ${segments.slice(0, i + 1).join("/")}` };
        }
        if (isLast) {
          if (opts.expect === "file" && !st.isFile()) {
            return { ok: false, error: "path must be a regular file" };
          }
          if (opts.expect === "directory" && !st.isDirectory()) {
            return { ok: false, error: "path must be a directory" };
          }
        }
      } catch (error) {
        if (!opts.mustExist && i === segments.length - 1) {
          // leaf may be missing when writing schema
          return { ok: true, abs };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `path lstat failed: ${msg}` };
      }
    }
  }
  return { ok: true, abs };
}

async function readUtf8Strict(
  abs: string,
  maxBytes: number,
  label: string,
  diags: string[],
): Promise<string | null> {
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
    const bytes = await readFile(abs);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      push(diags, `${label}: invalid UTF-8`);
      return null;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    push(diags, `${label}: read failed: ${msg}`);
    return null;
  }
}

async function readRegularFileBytes(
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

export async function writeSchema(root: string): Promise<void> {
  const text = schemaCanonicalBytes();
  const parentRel = path.dirname(SCHEMA_REL);
  const parentChain = await ensureRealPathChain(root, parentRel, {
    mustExist: true,
    expect: "directory",
  });
  if (!parentChain.ok) throw new Error(`schema write: ${parentChain.error}`);
  const target = path.join(root, SCHEMA_REL);
  try {
    const st = await lstat(target);
    if (st.isSymbolicLink()) throw new Error("schema write: target is a symlink");
    if (st.isDirectory()) throw new Error("schema write: target is a directory");
    if (!st.isFile()) throw new Error("schema write: target is not a regular file");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      // creatable leaf
    } else if (error instanceof Error && error.message.startsWith("schema write:")) {
      throw error;
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`schema write: target lstat failed: ${msg}`);
    }
  }
  await writeFile(target, text, "utf8");
}

export async function checkSchema(root: string): Promise<string[]> {
  const diags: string[] = [];
  const chain = await ensureRealPathChain(root, SCHEMA_REL, {
    mustExist: true,
    expect: "file",
  });
  if (!chain.ok) {
    push(diags, `schema: ${chain.error}`);
    return diags;
  }
  const text = await readUtf8Strict(chain.abs, SCHEMA_MAX_BYTES, "schema", diags);
  if (text === null) return diags;
  const expected = schemaCanonicalBytes();
  if (text !== expected) {
    push(diags, "schema: committed bytes differ from generated contract schema");
  }
  return diags;
}

export async function validateReportFile(
  root: string,
  reportRel: string,
  options: { verifyArtifacts?: boolean } = {},
): Promise<string[]> {
  const diags: string[] = [];
  const verifyArtifacts = options.verifyArtifacts !== false;
  const chain = await ensureRealPathChain(root, reportRel, {
    mustExist: true,
    expect: "file",
  });
  if (!chain.ok) {
    push(diags, `report ${reportRel}: ${chain.error}`);
    return diags;
  }
  const text = await readUtf8Strict(chain.abs, REPORT_MAX_BYTES, `report ${reportRel}`, diags);
  if (text === null) return diags;
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
  if (!verifyArtifacts || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return diags;
  }
  const report = parsed as Record<string, unknown>;
  if (!Array.isArray(report.artifacts)) return diags;
  for (const [i, art] of report.artifacts.entries()) {
    if (typeof art !== "object" || art === null || Array.isArray(art)) continue;
    const item = art as Record<string, unknown>;
    if (typeof item.path !== "string") continue;
    const label = `report ${reportRel}.artifacts[${i}]`;
    const artChain = await ensureRealPathChain(root, item.path, {
      mustExist: true,
      expect: "file",
    });
    if (!artChain.ok) {
      push(diags, `${label}: ${artChain.error}`);
      continue;
    }
    const artBytes = await readRegularFileBytes(
      artChain.abs,
      ARTIFACT_MAX_BYTES,
      `${label} file`,
      diags,
    );
    if (!artBytes) continue;
    if (typeof item.byte_length === "number" && artBytes.byteLength !== item.byte_length) {
      push(
        diags,
        `${label}: byte_length ${item.byte_length} does not match file size ${artBytes.byteLength}`,
      );
    }
    if (typeof item.sha256 === "string") {
      const digest = sha256Hex(artBytes);
      if (digest !== item.sha256) push(diags, `${label}: sha256 mismatch`);
    }
  }
  return diags;
}

export async function checkEvidence(root: string = process.cwd()): Promise<EvidenceCheckResult> {
  const diags: string[] = [];
  diags.push(...(await checkSchema(root)));

  const validChain = await ensureRealPathChain(root, VALID_DIR_REL, {
    mustExist: true,
    expect: "directory",
  });
  if (!validChain.ok) {
    push(diags, `valid corpus: ${validChain.error}`);
    diags.sort(asciiCompare);
    return {
      ok: false,
      diagnostics: diags,
      summary: `status=fail diagnostics=${diags.length}`,
      reports: 0,
    };
  }

  let reportNames: string[] = [];
  try {
    const entries = await readdir(validChain.abs, { withFileTypes: true });
    const names = entries.map((e) => e.name).sort(asciiCompare);
    for (const name of names) {
      const entry = entries.find((e) => e.name === name)!;
      const childAbs = path.join(validChain.abs, name);
      const st = await lstat(childAbs);
      if (st.isSymbolicLink()) {
        push(diags, `valid corpus: symlink entry rejected: ${name}`);
        continue;
      }
      if (st.isDirectory()) {
        push(diags, `valid corpus: unexpected directory: ${name}`);
        continue;
      }
      if (!st.isFile()) {
        push(diags, `valid corpus: unexpected entry type: ${name}`);
        continue;
      }
      if (!name.endsWith(".json")) {
        push(diags, `valid corpus: unexpected non-report file: ${name}`);
        continue;
      }
      reportNames.push(name);
    }
    reportNames = reportNames.sort(asciiCompare);
    if (reportNames.length === 0) {
      push(diags, "valid corpus: requires at least one report JSON");
    }
    for (const name of reportNames) {
      diags.push(...(await validateReportFile(root, `${VALID_DIR_REL}/${name}`)));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    push(diags, `valid corpus: read failed: ${msg}`);
  }

  diags.sort(asciiCompare);
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
  const parsed = parseCliMode(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(import.meta.dir, "..");
  if (parsed.mode === "write") {
    await writeSchema(root);
    const result = await checkEvidence(root);
    if (!result.ok) {
      for (const d of result.diagnostics) console.error(d);
      process.exitCode = 1;
    }
    console.log(`status=ok mode=write ${result.summary}`);
    return;
  }
  const result = await checkEvidence(root);
  if (!result.ok) {
    for (const d of result.diagnostics) console.error(d);
    process.exitCode = 1;
  }
  console.log(result.summary);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`evidence-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
