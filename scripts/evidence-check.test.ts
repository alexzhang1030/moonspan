import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARTIFACT_ROLES,
  DECISIONS,
  EVIDENCE_LEVELS,
  GATES,
  REPORT_ID,
  SCHEMA_VERSION,
  SUPPORT_ROWS,
  checkEvidence,
  resolveUnderRoot,
  sha256Hex,
  stableJsonPretty,
  validateReportDocument,
  validateReportFile,
} from "./evidence-check.ts";

const root = path.resolve(import.meta.dir, "..");

function baseReport(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    report_id: REPORT_ID,
    gate: "M0",
    evidence_level: "foundation",
    identity: {
      code_revision: "e8d546af63c5fb8297f07d13a0d908b719a2cc1a",
      fixture_manifest_sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      package_versions: {
        bun: "1.3.14",
        just: "1.50.0",
      },
      image_digests: {
        "ci-runner":
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      environment: {
        platform: "linux/arm64",
        toolchain: {
          bun: "1.3.14",
          moonc: "0.10.6+80dc50f24",
          rustc: "1.97.1",
        },
      },
    },
    invocation: {
      commands: ["bun run check"],
      workload: "unit test synthetic report",
      budgets: {
        timeout_seconds: 60,
      },
      duration_seconds: 1,
      sample_count: 1,
      warmup_count: 0,
    },
    artifacts: [
      {
        role: "raw",
        path: "evidence/testdata/artifacts/smoke-raw.json",
        sha256: "1e421fda91e63790c6a56cb6167f1abcf3f4fa4a2f8d111e63c1c79fac72c4f4",
        byte_length: 63,
        media_type: "application/json",
        retention_policy: "repository-committed",
      },
    ],
    measurements: {
      errors: [],
      dispositions: [
        {
          name: "delivered",
          count: 1,
        },
      ],
    },
    review: {
      reviewer: "unit-test",
      decision: "provisional",
      decision_date: "2026-08-11",
      known_limits: ["synthetic"],
    },
  };
}

describe("evidence-check closed enums and helpers", () => {
  test("exports exact closed sets", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(REPORT_ID).toBe("moonspan-qualification-report-v1");
    expect([...GATES]).toEqual(["M0", "M1", "M2", "M3", "U0", "X0"]);
    expect([...EVIDENCE_LEVELS]).toEqual([
      "foundation",
      "N1",
      "N2",
      "N3",
      "operations",
      "security",
      "prototype",
    ]);
    expect([...SUPPORT_ROWS]).toEqual([
      "H-FT",
      "H-CY",
      "H-ZN",
      "J-FT",
      "J-CY",
      "J-ZN",
    ]);
    expect([...ARTIFACT_ROLES]).toEqual(["raw", "derived", "report"]);
    expect([...DECISIONS]).toEqual(["accept", "reject", "provisional"]);
  });

  test("resolveUnderRoot rejects traversal absolute and backslash paths", () => {
    expect(resolveUnderRoot(root, "../secret").ok).toBe(false);
    expect(resolveUnderRoot(root, "/etc/passwd").ok).toBe(false);
    expect(resolveUnderRoot(root, "a\\b").ok).toBe(false);
    expect(resolveUnderRoot(root, "a//b").ok).toBe(false);
    expect(resolveUnderRoot(root, "evidence/testdata/valid/smoke-foundation.json").ok).toBe(
      true,
    );
  });
});

describe("evidence-check document validation", () => {
  test("valid synthetic document has no diagnostics", () => {
    expect(validateReportDocument(baseReport())).toEqual([]);
  });

  test("unknown top-level key is rejected", () => {
    const report = baseReport();
    report.extra = true;
    expect(validateReportDocument(report).some((d) => d.includes("unknown key"))).toBe(true);
  });

  test("missing required field is rejected", () => {
    const report = baseReport();
    delete report.review;
    expect(validateReportDocument(report).some((d) => d.includes("missing key \"review\""))).toBe(
      true,
    );
  });

  test("invalid gate enum is rejected", () => {
    const report = baseReport();
    report.gate = "M9";
    expect(validateReportDocument(report).some((d) => d.includes("gate"))).toBe(true);
  });

  test("unsorted package version keys are rejected", () => {
    const report = baseReport();
    (report.identity as Record<string, unknown>).package_versions = {
      just: "1.50.0",
      bun: "1.3.14",
    };
    expect(
      validateReportDocument(report).some((d) => d.includes("package_versions") && d.includes("sorted")),
    ).toBe(true);
  });

  test("unsorted artifact paths are rejected", () => {
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "z/file.json",
        sha256: "1e421fda91e63790c6a56cb6167f1abcf3f4fa4a2f8d111e63c1c79fac72c4f4",
        byte_length: 1,
        media_type: "application/json",
        retention_policy: "repository-committed",
      },
      {
        role: "derived",
        path: "a/file.json",
        sha256: "1e421fda91e63790c6a56cb6167f1abcf3f4fa4a2f8d111e63c1c79fac72c4f4",
        byte_length: 1,
        media_type: "application/json",
        retention_policy: "repository-committed",
      },
    ];
    expect(
      validateReportDocument(report).some((d) => d.includes("artifacts") && d.includes("sorted")),
    ).toBe(true);
  });

  test("path traversal in artifact path is rejected", () => {
    const report = baseReport();
    (report.artifacts as Array<Record<string, unknown>>)[0]!.path = "../outside.json";
    expect(validateReportDocument(report).some((d) => d.includes("path"))).toBe(true);
  });

  test("optional provenance accepts phase-one support row", () => {
    const report = baseReport();
    report.provenance = {
      support_row_id: "H-ZN",
      domain_ids: [0, 1],
      gateway_instance_id: "gateway-1",
      adapter_profile: "humble-zenoh",
    };
    expect(validateReportDocument(report)).toEqual([]);
  });

  test("invalid provenance support row is rejected", () => {
    const report = baseReport();
    report.provenance = { support_row_id: "K-FT" };
    expect(validateReportDocument(report).some((d) => d.includes("support_row_id"))).toBe(true);
  });

  test("bounds reject oversized sample count", () => {
    const report = baseReport();
    (report.invocation as Record<string, unknown>).sample_count = 100_000_001;
    expect(validateReportDocument(report).some((d) => d.includes("sample_count"))).toBe(true);
  });
});

describe("evidence-check repository corpus", () => {
  test("committed valid corpus and schema pass checkEvidence", async () => {
    const result = await checkEvidence(root);
    expect(result.ok).toBe(true);
    expect(result.reports).toBeGreaterThanOrEqual(1);
    expect(result.summary).toContain("status=ok");
  });

  test("committed smoke report verifies artifact integrity", async () => {
    const diags = await validateReportFile(
      root,
      "evidence/testdata/valid/smoke-foundation.json",
    );
    expect(diags).toEqual([]);
  });
});

describe("evidence-check integrity and path safety mutations", () => {
  const temps: string[] = [];
  afterEach(async () => {
    for (const dir of temps.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("hash mismatch is diagnosed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-hash-"));
    temps.push(dir);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await writeFile(path.join(dir, "artifacts", "raw.json"), "{\"ok\":true}\n");
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "artifacts/raw.json",
        sha256: "0".repeat(64),
        byte_length: 11,
        media_type: "application/json",
        retention_policy: "temp",
      },
    ];
    await writeFile(path.join(dir, "report.json"), stableJsonPretty(report));
    const diags = await validateReportFile(dir, "report.json");
    expect(diags.some((d) => d.includes("sha256 mismatch"))).toBe(true);
  });

  test("byte length mismatch is diagnosed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-len-"));
    temps.push(dir);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    const payload = "{\"ok\":true}\n";
    await writeFile(path.join(dir, "artifacts", "raw.json"), payload);
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "artifacts/raw.json",
        sha256: sha256Hex(payload),
        byte_length: 999,
        media_type: "application/json",
        retention_policy: "temp",
      },
    ];
    await writeFile(path.join(dir, "report.json"), stableJsonPretty(report));
    const diags = await validateReportFile(dir, "report.json");
    expect(diags.some((d) => d.includes("byte_length"))).toBe(true);
  });

  test("artifact symlink is rejected", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-symlink-"));
    temps.push(dir);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    const external = path.join(dir, "external.json");
    await writeFile(external, "{\"secret\":true}\n");
    await symlink(external, path.join(dir, "artifacts", "raw.json"));
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "artifacts/raw.json",
        sha256: sha256Hex("{\"secret\":true}\n"),
        byte_length: 16,
        media_type: "application/json",
        retention_policy: "temp",
      },
    ];
    await writeFile(path.join(dir, "report.json"), stableJsonPretty(report));
    const diags = await validateReportFile(dir, "report.json");
    expect(diags.some((d) => d.includes("symlink"))).toBe(true);
  });

  test("non-canonical pretty JSON is rejected", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-canon-"));
    temps.push(dir);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    const payload = "{\"ok\":true}\n";
    await writeFile(path.join(dir, "artifacts", "raw.json"), payload);
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "artifacts/raw.json",
        sha256: sha256Hex(payload),
        byte_length: payload.length,
        media_type: "application/json",
        retention_policy: "temp",
      },
    ];
    await writeFile(path.join(dir, "report.json"), JSON.stringify(report));
    const diags = await validateReportFile(dir, "report.json");
    expect(diags.some((d) => d.includes("canonical"))).toBe(true);
  });
});
