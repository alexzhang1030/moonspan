import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DECISIONS,
  GATES,
  REPORTS_DIR_REL,
  checkEvidence,
  resolveUnderRoot,
  sha256Hex,
  validateReportDocument,
} from "./evidence-check.ts";

const root = path.resolve(import.meta.dir, "..");

function baseReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gate: "R1",
    artifacts: [
      {
        path: "docs/evidence/r1-04-wasm-size.json",
        sha256: "d5186cee0863cfddb497e02d39799a260f0a9cd9b268a9489552098f004d754e",
      },
    ],
    review: { decision: "pending" },
    ...overrides,
  };
}

describe("evidence report index", () => {
  test("closed gate and decision sets", () => {
    expect([...GATES]).toEqual(["R0", "R1", "R2", "R3", "R4", "U0", "X0"]);
    expect([...DECISIONS]).toEqual(["pending", "accept", "reject", "provisional"]);
  });

  test("valid pending report has no diagnostics", () => {
    expect(validateReportDocument(baseReport())).toEqual([]);
  });

  test("unknown gate is rejected", () => {
    expect(validateReportDocument(baseReport({ gate: "M0" })).some((d) => d.includes("gate"))).toBe(
      true,
    );
  });

  test("pending rejects a fabricated reviewer", () => {
    const report = baseReport();
    (report.review as Record<string, unknown>).reviewer = "someone";
    expect(validateReportDocument(report).some((d) => d.includes("reviewer"))).toBe(true);
  });

  test("accept requires a reviewer", () => {
    expect(
      validateReportDocument(baseReport({ review: { decision: "accept" } })).some((d) =>
        d.includes("reviewer"),
      ),
    ).toBe(true);
    expect(
      validateReportDocument(
        baseReport({ review: { decision: "accept", reviewer: "human" } }),
      ),
    ).toEqual([]);
  });

  test("path helper rejects traversal", () => {
    expect(resolveUnderRoot(root, "../secret").ok).toBe(false);
    expect(resolveUnderRoot(root, "/etc/passwd").ok).toBe(false);
  });
});

describe("repository reports", () => {
  test("committed gate reports pass checkEvidence", async () => {
    const result = await checkEvidence(root);
    expect(result.ok).toBe(true);
    expect(result.reports).toBe(3);
  });
});

describe("artifact integrity", () => {
  const temps: string[] = [];
  afterEach(async () => {
    for (const dir of temps.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("sha256 mismatch and missing artifact fail", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rclweb-evidence-"));
    temps.push(dir);
    await mkdir(path.join(dir, REPORTS_DIR_REL), { recursive: true });
    await mkdir(path.join(dir, "docs/evidence"), { recursive: true });
    const payload = '{"ok":true}\n';
    await writeFile(path.join(dir, "docs/evidence/raw.json"), payload);
    const report = {
      gate: "R1",
      artifacts: [{ path: "docs/evidence/raw.json", sha256: "0".repeat(64) }],
      review: { decision: "pending" },
    };
    await writeFile(path.join(dir, `${REPORTS_DIR_REL}/r1.json`), `${JSON.stringify(report, null, 2)}\n`);
    const mismatch = await checkEvidence(dir);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.diagnostics.some((d) => d.includes("sha256 mismatch"))).toBe(true);

    report.artifacts[0]!.sha256 = sha256Hex(payload);
    report.artifacts[0]!.path = "docs/evidence/missing.json";
    await writeFile(path.join(dir, `${REPORTS_DIR_REL}/r1.json`), `${JSON.stringify(report, null, 2)}\n`);
    const missing = await checkEvidence(dir);
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics.some((d) => d.includes("read failed") || d.includes("missing"))).toBe(
      true,
    );
  });
});
