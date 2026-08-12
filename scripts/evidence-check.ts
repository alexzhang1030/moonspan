#!/usr/bin/env bun
/**
 * Thin qualification-report index (R4-03).
 *
 * Reports under docs/evidence/reports/ name a gate, point at committed
 * measurement files, and record a review decision. The checker verifies
 * those files exist and that sha256 still matches. It does not enforce
 * the pre-restructure closed M0-05a ceremony (sorted maps, generated
 * JSON Schema, synthetic fixtures, media types, invocation bounds).
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const REPORTS_DIR_REL = "docs/evidence/reports";
export const GATES = ["R0", "R1", "R2", "R3", "R4", "U0", "X0"] as const;
export const SUPPORT_ROWS = ["H-FT", "H-CY", "H-ZN", "J-FT", "J-CY", "J-ZN"] as const;
export const DECISIONS = ["pending", "accept", "reject", "provisional"] as const;
export const SHA256_RE = /^[0-9a-f]{64}$/;

export type EvidenceCheckResult = {
  ok: boolean;
  diagnostics: string[];
  summary: string;
  reports: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function resolveUnderRoot(
  root: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (typeof rel !== "string" || rel.length === 0) {
    return { ok: false, error: "empty path rejected" };
  }
  if (path.isAbsolute(rel) || rel.includes("\0") || rel.includes("\\")) {
    return { ok: false, error: `unsafe path: ${rel}` };
  }
  const segments = rel.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    return { ok: false, error: `path escapes or is noncanonical: ${rel}` };
  }
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `path escapes root: ${rel}` };
  }
  return { ok: true, abs };
}

export function validateReportDocument(value: unknown, pathLabel = "report"): string[] {
  const diags: string[] = [];
  if (!isPlainObject(value)) {
    diags.push(`${pathLabel}: JSON root must be an object`);
    return diags;
  }
  if (typeof value.gate !== "string" || !(GATES as readonly string[]).includes(value.gate)) {
    diags.push(`${pathLabel}.gate: must be one of ${GATES.join(", ")}`);
  }
  if (value.support_row !== undefined) {
    if (
      typeof value.support_row !== "string" ||
      !(SUPPORT_ROWS as readonly string[]).includes(value.support_row)
    ) {
      diags.push(`${pathLabel}.support_row: unknown row`);
    }
  }
  if (!isPlainObject(value.review)) {
    diags.push(`${pathLabel}.review: must be an object`);
  } else {
    const decision = value.review.decision;
    if (typeof decision !== "string" || !(DECISIONS as readonly string[]).includes(decision)) {
      diags.push(`${pathLabel}.review.decision: must be pending, accept, reject, or provisional`);
    } else if (decision === "pending") {
      if (value.review.reviewer !== undefined) {
        diags.push(`${pathLabel}.review.reviewer: omit until a human decides`);
      }
    } else if (typeof value.review.reviewer !== "string" || value.review.reviewer.length === 0) {
      diags.push(`${pathLabel}.review.reviewer: required for ${decision}`);
    }
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1) {
    diags.push(`${pathLabel}.artifacts: requires at least one entry`);
    return diags;
  }
  for (const [i, art] of value.artifacts.entries()) {
    const p = `${pathLabel}.artifacts[${i}]`;
    if (!isPlainObject(art)) {
      diags.push(`${p}: must be an object`);
      continue;
    }
    if (typeof art.path !== "string") {
      diags.push(`${p}.path: must be a string`);
    } else {
      const resolved = resolveUnderRoot("/virtual-root", art.path);
      if (!resolved.ok) diags.push(`${p}.path: ${resolved.error}`);
    }
    if (typeof art.sha256 !== "string" || !SHA256_RE.test(art.sha256)) {
      diags.push(`${p}.sha256: requires 64 lowercase hex`);
    }
  }
  return diags;
}

async function validateReportFile(root: string, reportRel: string): Promise<string[]> {
  const diags: string[] = [];
  const resolved = resolveUnderRoot(root, reportRel);
  if (!resolved.ok) {
    diags.push(`report ${reportRel}: ${resolved.error}`);
    return diags;
  }
  let st;
  try {
    st = await lstat(resolved.abs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    diags.push(`report ${reportRel}: read failed: ${msg}`);
    return diags;
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    diags.push(`report ${reportRel}: must be a regular file`);
    return diags;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolved.abs, "utf8"));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    diags.push(`report ${reportRel}: malformed JSON: ${msg}`);
    return diags;
  }
  diags.push(...validateReportDocument(parsed, `report ${reportRel}`));
  if (!isPlainObject(parsed) || !Array.isArray(parsed.artifacts)) return diags;
  for (const [i, art] of parsed.artifacts.entries()) {
    if (!isPlainObject(art) || typeof art.path !== "string") continue;
    const label = `report ${reportRel}.artifacts[${i}]`;
    const artResolved = resolveUnderRoot(root, art.path);
    if (!artResolved.ok) {
      diags.push(`${label}: ${artResolved.error}`);
      continue;
    }
    try {
      const artSt = await lstat(artResolved.abs);
      if (artSt.isSymbolicLink() || !artSt.isFile()) {
        diags.push(`${label}: artifact must be a regular file`);
        continue;
      }
      const bytes = new Uint8Array(await readFile(artResolved.abs));
      if (typeof art.sha256 === "string" && sha256Hex(bytes) !== art.sha256) {
        diags.push(`${label}: sha256 mismatch`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      diags.push(`${label}: read failed: ${msg}`);
    }
  }
  return diags;
}

export async function checkEvidence(root: string = process.cwd()): Promise<EvidenceCheckResult> {
  const diags: string[] = [];
  const dirResolved = resolveUnderRoot(root, REPORTS_DIR_REL);
  if (!dirResolved.ok) {
    return {
      ok: false,
      diagnostics: [`gate reports: ${dirResolved.error}`],
      summary: "status=fail diagnostics=1",
      reports: 0,
    };
  }
  let names: string[] = [];
  try {
    const entries = await readdir(dirResolved.abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        diags.push(`gate reports: unexpected directory: ${entry.name}`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        diags.push(`gate reports: unexpected file: ${entry.name}`);
        continue;
      }
      names.push(entry.name);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    diags.push(`gate reports: read failed: ${msg}`);
  }
  names.sort();
  if (names.length === 0) {
    diags.push("gate reports: requires at least one report JSON");
  }
  for (const name of names) {
    diags.push(...(await validateReportFile(root, `${REPORTS_DIR_REL}/${name}`)));
  }
  diags.sort();
  const ok = diags.length === 0;
  return {
    ok,
    diagnostics: diags,
    summary: ok
      ? `status=ok reports=${names.length}`
      : `status=fail diagnostics=${diags.length}`,
    reports: names.length,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "--check") {
    console.error("usage: evidence-check.ts [--check]");
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(import.meta.dir, "..");
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
