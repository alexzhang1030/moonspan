import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
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
  REPORT_ID,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_MIN,
  SCHEMA_REL,
  SCHEMA_VERSION,
  SUPPORT_ROWS,
  asciiCompare,
  buildQualificationReportSchema,
  checkEvidence,
  checkSchema,
  isValidCalendarDate,
  parseCliMode,
  resolveUnderRoot,
  schemaCanonicalBytes,
  sha256Hex,
  stableJsonPretty,
  validateReportDocument,
  validateReportFile,
  writeSchema,
} from "./evidence-check.ts";
import * as evidenceContract from "./evidence-contract.ts";
import * as evidenceModel from "./evidence-model.ts";
import * as evidenceSchema from "./evidence-schema.ts";

const root = path.resolve(import.meta.dir, "..");

function baseReport(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    report_id: REPORT_ID,
    gate: "M0",
    evidence_level: "foundation",
    identity: {
      code_revision: "e8d546af63c5fb8297f07d13a0d908b719a2cc1a",
      fixture_manifests: {
        r2wp: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      },
      package_versions: {
        bun: "1.3.14",
      },
      image_digests: {},
      environment: {
        environment_id: "unit-test-env",
        platform: "linux/arm64",
        toolchain: {
          bun: "1.3.14",
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
        path: "evidence/testdata/payloads/smoke-raw.json",
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
      decision: "pending",
      known_limits: ["synthetic"],
    },
    ...overrides,
  };
}

describe("evidence contract enums and helpers", () => {
  test("exports exact closed sets and gate mapping", () => {
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
    expect([...DECISIONS]).toEqual(["pending", "accept", "reject", "provisional"]);
    expect(GATE_EVIDENCE_LEVELS.M0).toEqual(["foundation"]);
    expect(GATE_EVIDENCE_LEVELS.M1).toEqual(["N1"]);
    expect(GATE_EVIDENCE_LEVELS.M2).toEqual(["N2"]);
    expect(GATE_EVIDENCE_LEVELS.M3).toEqual(["operations", "security"]);
    expect(GATE_EVIDENCE_LEVELS.U0).toEqual(["prototype"]);
    expect(GATE_EVIDENCE_LEVELS.X0).toEqual(["N3"]);
    expect([...LEVELS_REQUIRING_SUPPORT_ROW]).toEqual(["N1", "N2"]);
    expect(ARTIFACT_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(PATH_MAX_LENGTH).toBe(512);
    expect(MEDIA_TYPE_MAX_LENGTH).toBe(128);
  });

  test("asciiCompare is deterministic code-unit order", () => {
    expect(asciiCompare("A", "B")).toBe(-1);
    expect(asciiCompare("b", "a")).toBe(1);
    expect(["z", "a", "m"].sort(asciiCompare)).toEqual(["a", "m", "z"]);
  });

  test("calendar date validation rejects impossible days", () => {
    expect(isValidCalendarDate("2026-08-11")).toBe(true);
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  test("CLI mode parsing", () => {
    expect(parseCliMode([])).toEqual({ mode: "check" });
    expect(parseCliMode(["--check"])).toEqual({ mode: "check" });
    expect(parseCliMode(["--write"])).toEqual({ mode: "write" });
    expect(parseCliMode(["--other"])).toHaveProperty("error");
  });
});

describe("evidence module wiring", () => {
  test("model owns constants and helpers; contract validates; schema builds", () => {
    // Model is the source of truth for enums/bounds/helpers.
    expect(evidenceModel.SCHEMA_VERSION).toBe(SCHEMA_VERSION);
    expect(evidenceModel.REPORT_ID).toBe(REPORT_ID);
    expect([...evidenceModel.GATES]).toEqual([...GATES]);
    expect(evidenceModel.ARTIFACT_MAX_BYTES).toBe(ARTIFACT_MAX_BYTES);
    expect(evidenceModel.asciiCompare("a", "b")).toBe(-1);
    expect(evidenceModel.isValidCalendarDate("2026-08-11")).toBe(true);
    expect(evidenceModel.resolveUnderRoot("/r", "a/b").ok).toBe(true);
    expect(evidenceModel.stableJsonPretty({ a: 1 })).toBe('{\n  "a": 1\n}\n');

    // Contract focuses on runtime document validation.
    expect(typeof evidenceContract.validateReportDocument).toBe("function");
    expect(evidenceContract.validateReportDocument(baseReport())).toEqual([]);
    expect(
      Object.keys(evidenceContract).filter((k) => k === "GATES" || k === "SCHEMA_VERSION"),
    ).toEqual([]);

    // Schema depends on model constants directly and produces the public schema.
    expect(typeof evidenceSchema.buildQualificationReportSchema).toBe("function");
    expect(typeof evidenceSchema.schemaCanonicalBytes).toBe("function");
    const schema = evidenceSchema.buildQualificationReportSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties).toBeDefined();
    expect(
      Object.keys(evidenceSchema).filter((k) => k === "GATES" || k === "validateReportDocument"),
    ).toEqual([]);

    // Check re-exports stay stable for tests and CLI consumers.
    expect(validateReportDocument).toBe(evidenceContract.validateReportDocument);
    expect(buildQualificationReportSchema).toBe(evidenceSchema.buildQualificationReportSchema);
    expect(schemaCanonicalBytes).toBe(evidenceSchema.schemaCanonicalBytes);
    expect(GATES).toBe(evidenceModel.GATES);
    expect(stableJsonPretty).toBe(evidenceModel.stableJsonPretty);
  });
});

describe("evidence document validation", () => {
  test("valid pending foundation report has no diagnostics", () => {
    expect(validateReportDocument(baseReport())).toEqual([]);
  });

  test("pending rejects fabricated reviewer and decision date", () => {
    const report = baseReport();
    (report.review as Record<string, unknown>).reviewer = "someone";
    (report.review as Record<string, unknown>).decision_date = "2026-08-11";
    const diags = validateReportDocument(report);
    expect(diags.some((d) => d.includes("reviewer"))).toBe(true);
    expect(diags.some((d) => d.includes("decision_date"))).toBe(true);
  });

  test("accept requires reviewer and valid calendar date", () => {
    const report = baseReport();
    report.review = {
      decision: "accept",
      known_limits: [],
    };
    expect(validateReportDocument(report).some((d) => d.includes("reviewer"))).toBe(true);
    report.review = {
      decision: "accept",
      reviewer: "human",
      decision_date: "2026-02-30",
      known_limits: [],
    };
    expect(validateReportDocument(report).some((d) => d.includes("decision_date"))).toBe(true);
    report.review = {
      decision: "accept",
      reviewer: "human",
      decision_date: "2026-08-11",
      known_limits: [],
    };
    expect(validateReportDocument(report)).toEqual([]);
  });

  test("gate and evidence level mapping is enforced", () => {
    const report = baseReport({ gate: "M1", evidence_level: "foundation" });
    expect(validateReportDocument(report).some((d) => d.includes("does not allow"))).toBe(true);
    const ok = baseReport({
      gate: "M1",
      evidence_level: "N1",
      provenance: { support_row_id: "H-FT" },
    });
    expect(validateReportDocument(ok)).toEqual([]);
  });

  test("N1 and N2 require support_row_id", () => {
    const n1 = baseReport({ gate: "M1", evidence_level: "N1" });
    expect(validateReportDocument(n1).some((d) => d.includes("support_row_id"))).toBe(true);
    const n2 = baseReport({
      gate: "M2",
      evidence_level: "N2",
      provenance: { support_row_id: "J-ZN" },
    });
    expect(validateReportDocument(n2)).toEqual([]);
  });

  test("fixture_manifests must be nonempty sorted map", () => {
    const report = baseReport();
    (report.identity as Record<string, unknown>).fixture_manifests = {};
    expect(validateReportDocument(report).some((d) => d.includes("fixture_manifests"))).toBe(
      true,
    );
  });

  test("empty image_digests is allowed", () => {
    const report = baseReport();
    expect(
      Object.keys(
        (report.identity as Record<string, unknown>).image_digests as Record<string, unknown>,
      ),
    ).toHaveLength(0);
    expect(validateReportDocument(report)).toEqual([]);
  });

  test("environment_id is required and sanitized", () => {
    const report = baseReport();
    const env = (report.identity as Record<string, unknown>).environment as Record<
      string,
      unknown
    >;
    env.environment_id = "../bad";
    expect(validateReportDocument(report).some((d) => d.includes("environment_id"))).toBe(true);
  });
});

describe("schema/runtime boundary parity", () => {
  const cases: Array<{
    name: string;
    mutate: (report: Record<string, unknown>) => void;
    needle: string;
  }> = [
    {
      name: "artifact byte_length above ARTIFACT_MAX_BYTES",
      mutate: (r) => {
        (r.artifacts as Array<Record<string, unknown>>)[0]!.byte_length =
          ARTIFACT_MAX_BYTES + 1;
      },
      needle: "byte_length",
    },
    {
      name: "path longer than PATH_MAX_LENGTH",
      mutate: (r) => {
        (r.artifacts as Array<Record<string, unknown>>)[0]!.path = `${"a/".repeat(300)}x.json`;
      },
      needle: "path",
    },
    {
      name: "media_type longer than MEDIA_TYPE_MAX_LENGTH",
      mutate: (r) => {
        (r.artifacts as Array<Record<string, unknown>>)[0]!.media_type =
          `application/${"x".repeat(200)}`;
      },
      needle: "media_type",
    },
    {
      name: "measurement timestamp non-string",
      mutate: (r) => {
        r.measurements = {
          timestamps: { started_at: 1 },
          errors: [],
          dispositions: [{ name: "delivered", count: 1 }],
        };
      },
      needle: "timestamps",
    },
    {
      name: "sample_count above maximum",
      mutate: (r) => {
        (r.invocation as Record<string, unknown>).sample_count = 100_000_001;
      },
      needle: "sample_count",
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const report = baseReport();
      c.mutate(report);
      expect(validateReportDocument(report).some((d) => d.includes(c.needle))).toBe(true);
    });
  }

  test("schema documents the same artifact byte ceiling", () => {
    const schema = JSON.parse(schemaCanonicalBytes()) as {
      properties: {
        artifacts: {
          items: { properties: { byte_length: { maximum: number } } };
        };
      };
    };
    expect(schema.properties.artifacts.items.properties.byte_length.maximum).toBe(
      ARTIFACT_MAX_BYTES,
    );
  });

  test("generated schema encodes gate/level mapping and N1/N2 provenance", () => {
    const schema = buildQualificationReportSchema() as {
      allOf: Array<Record<string, unknown>>;
      properties: {
        artifacts: {
          items: { properties: { path: { pattern: string } } };
        };
        review: {
          properties: { decision_date: { format?: string; pattern?: string } };
        };
        invocation: {
          properties: {
            budgets: { additionalProperties: { anyOf: unknown[] } };
          };
        };
        measurements: {
          properties: {
            queues: { additionalProperties: { anyOf: unknown[] } };
            resources: { additionalProperties: { anyOf: unknown[] } };
          };
        };
      };
    };
    expect(schema.allOf.length).toBeGreaterThanOrEqual(7);
    const n1n2 = schema.allOf.find((clause) => {
      const iff = clause.if as { properties?: { evidence_level?: { enum?: string[] } } };
      return iff?.properties?.evidence_level?.enum?.includes("N1");
    });
    expect(n1n2).toBeDefined();
    const then = n1n2!.then as {
      required: string[];
      properties: { provenance: { required: string[] } };
    };
    expect(then.required).toContain("provenance");
    expect(then.properties.provenance.required).toContain("support_row_id");
    const m0 = schema.allOf.find((clause) => {
      const iff = clause.if as { properties?: { gate?: { const?: string } } };
      return iff?.properties?.gate?.const === "M0";
    });
    expect(
      ((m0!.then as { properties: { evidence_level: { enum: string[] } } }).properties
        .evidence_level.enum),
    ).toEqual(["foundation"]);
    expect(schema.properties.artifacts.items.properties.path.pattern).toBe(
      PATH_RELATIVE_PATTERN,
    );
    expect(schema.properties.review.properties.decision_date.format).toBe("date");
    expect(schema.properties.review.properties.decision_date.pattern).toBe(
      "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    );
    const budgetAnyOf = schema.properties.invocation.properties.budgets
      .additionalProperties.anyOf as Array<Record<string, unknown>>;
    expect(budgetAnyOf).toHaveLength(3);
    const numberBranch = budgetAnyOf.find((b) => b.type === "number") as {
      minimum: number;
      maximum: number;
    };
    expect(numberBranch.minimum).toBe(SAFE_NUMBER_MIN);
    expect(numberBranch.maximum).toBe(SAFE_NUMBER_MAX);
    expect(
      schema.properties.measurements.properties.queues.additionalProperties.anyOf,
    ).toHaveLength(3);
    expect(
      schema.properties.measurements.properties.resources.additionalProperties.anyOf,
    ).toHaveLength(3);
  });

  test("runtime rejects numbers outside shared safe bounds", () => {
    const report = baseReport();
    (report.invocation as Record<string, unknown>).budgets = {
      timeout_seconds: SAFE_NUMBER_MAX + 1,
    };
    expect(validateReportDocument(report).some((d) => d.includes("safe bounds"))).toBe(true);
    (report.invocation as Record<string, unknown>).budgets = {
      timeout_seconds: SAFE_NUMBER_MIN - 1,
    };
    expect(validateReportDocument(report).some((d) => d.includes("safe bounds"))).toBe(true);
  });

  test("runtime rejects path pattern counterexamples", () => {
    for (const bad of ["../escape.json", "a//b.json", "/abs.json", "a\\b.json", ".hidden/x"]) {
      const report = baseReport();
      (report.artifacts as Array<Record<string, unknown>>)[0]!.path = bad;
      expect(validateReportDocument(report).some((d) => d.includes("path"))).toBe(true);
    }
  });
});

describe("schema write/check identity", () => {
  test("committed schema matches generated contract bytes", async () => {
    const diags = await checkSchema(root);
    expect(diags).toEqual([]);
  });

  test("schema write and check are identity-stable", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-schema-"));
    try {
      await mkdir(path.join(temp, "evidence", "schema"), { recursive: true });
      await mkdir(path.join(temp, "evidence", "testdata", "valid"), { recursive: true });
      await mkdir(path.join(temp, "evidence", "testdata", "payloads"), { recursive: true });
      // copy payloads and a valid report for full checkEvidence after write
      const raw = await Bun.file(
        path.join(root, "evidence/testdata/payloads/smoke-raw.json"),
      ).arrayBuffer();
      await writeFile(
        path.join(temp, "evidence/testdata/payloads/smoke-raw.json"),
        new Uint8Array(raw),
      );
      await writeFile(
        path.join(temp, "evidence/testdata/valid/smoke-foundation.json"),
        await Bun.file(path.join(root, "evidence/testdata/valid/smoke-foundation.json")).text(),
      );
      await writeSchema(temp);
      const first = await Bun.file(path.join(temp, SCHEMA_REL)).text();
      expect(first).toBe(schemaCanonicalBytes());
      await writeSchema(temp);
      const second = await Bun.file(path.join(temp, SCHEMA_REL)).text();
      expect(second).toBe(first);
      expect(await checkSchema(temp)).toEqual([]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("schema drift is diagnosed", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-schema-drift-"));
    try {
      await mkdir(path.join(temp, "evidence", "schema"), { recursive: true });
      await writeFile(path.join(temp, SCHEMA_REL), "{}\n");
      const diags = await checkSchema(temp);
      expect(diags.some((d) => d.includes("differ from generated"))).toBe(true);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("schema corruption invalid UTF-8 is diagnosed", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-schema-utf8-"));
    try {
      await mkdir(path.join(temp, "evidence", "schema"), { recursive: true });
      await writeFile(path.join(temp, SCHEMA_REL), Buffer.from([0xff, 0xfe, 0xfd]));
      const diags = await checkSchema(temp);
      expect(diags.some((d) => d.includes("UTF-8"))).toBe(true);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("writeSchema rejects existing symlink leaf with stable error", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-schema-symlink-"));
    try {
      await mkdir(path.join(temp, "evidence", "schema"), { recursive: true });
      const external = path.join(temp, "outside.json");
      await writeFile(external, "{}\n");
      await symlink(external, path.join(temp, SCHEMA_REL));
      await expect(writeSchema(temp)).rejects.toThrow(/symlink/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("writeSchema rejects existing directory leaf with stable error", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-schema-dir-"));
    try {
      await mkdir(path.join(temp, "evidence", "schema", "qualification-report-v1.json"), {
        recursive: true,
      });
      await expect(writeSchema(temp)).rejects.toThrow(/directory/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe("repository corpus", () => {
  test("committed valid corpus and schema pass checkEvidence", async () => {
    const result = await checkEvidence(root);
    expect(result.ok).toBe(true);
    expect(result.reports).toBe(1);
  });

  test("committed smoke report verifies artifact integrity", async () => {
    const diags = await validateReportFile(
      root,
      "evidence/testdata/valid/smoke-foundation.json",
    );
    expect(diags).toEqual([]);
  });
});

describe("filesystem safety and corpus closure", () => {
  const temps: string[] = [];
  afterEach(async () => {
    for (const dir of temps.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function seedTempCorpus(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "moonspan-evidence-fs-"));
    temps.push(dir);
    await mkdir(path.join(dir, "evidence", "schema"), { recursive: true });
    await mkdir(path.join(dir, "evidence", "testdata", "valid"), { recursive: true });
    await mkdir(path.join(dir, "evidence", "testdata", "payloads"), { recursive: true });
    await writeSchema(dir);
    const payload = '{"ok":true}\n';
    await writeFile(path.join(dir, "evidence/testdata/payloads/raw.json"), payload);
    const report = baseReport();
    report.artifacts = [
      {
        role: "raw",
        path: "evidence/testdata/payloads/raw.json",
        sha256: sha256Hex(payload),
        byte_length: payload.length,
        media_type: "application/json",
        retention_policy: "temp",
      },
    ];
    await writeFile(
      path.join(dir, "evidence/testdata/valid/report.json"),
      stableJsonPretty(report),
    );
    return dir;
  }

  test("extra non-report file in valid corpus is rejected", async () => {
    const dir = await seedTempCorpus();
    await writeFile(path.join(dir, "evidence/testdata/valid/notes.txt"), "nope\n");
    const result = await checkEvidence(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unexpected non-report file"))).toBe(
      true,
    );
  });

  test("extra directory in valid corpus is rejected", async () => {
    const dir = await seedTempCorpus();
    await mkdir(path.join(dir, "evidence/testdata/valid/extra"));
    const result = await checkEvidence(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unexpected directory"))).toBe(true);
  });

  test("symlink report entry is rejected", async () => {
    const dir = await seedTempCorpus();
    const external = path.join(dir, "outside.json");
    await writeFile(external, "{}\n");
    await rm(path.join(dir, "evidence/testdata/valid/report.json"));
    await symlink(external, path.join(dir, "evidence/testdata/valid/report.json"));
    const result = await checkEvidence(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("symlink"))).toBe(true);
  });

  test("ancestor symlink on valid corpus path is rejected", async () => {
    const dir = await seedTempCorpus();
    const realValid = path.join(dir, "real-valid");
    await mkdir(realValid, { recursive: true });
    await writeFile(
      path.join(realValid, "report.json"),
      await Bun.file(path.join(dir, "evidence/testdata/valid/report.json")).text(),
    );
    await rm(path.join(dir, "evidence/testdata/valid"), { recursive: true, force: true });
    await symlink(realValid, path.join(dir, "evidence/testdata/valid"));
    const result = await checkEvidence(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("symlink"))).toBe(true);
  });

  test("artifact symlink is rejected", async () => {
    const dir = await seedTempCorpus();
    const external = path.join(dir, "external.json");
    await writeFile(external, "{\"secret\":true}\n");
    await rm(path.join(dir, "evidence/testdata/payloads/raw.json"));
    await symlink(external, path.join(dir, "evidence/testdata/payloads/raw.json"));
    const diags = await validateReportFile(dir, "evidence/testdata/valid/report.json");
    expect(diags.some((d) => d.includes("symlink"))).toBe(true);
  });

  test("hash mismatch and diagnostics are stable sorted", async () => {
    const dir = await seedTempCorpus();
    const reportPath = path.join(dir, "evidence/testdata/valid/report.json");
    const report = JSON.parse(await Bun.file(reportPath).text()) as Record<string, unknown>;
    (report.artifacts as Array<Record<string, unknown>>)[0]!.sha256 = "0".repeat(64);
    (report.artifacts as Array<Record<string, unknown>>)[0]!.byte_length = 999;
    await writeFile(reportPath, stableJsonPretty(report));
    const diags = await validateReportFile(dir, "evidence/testdata/valid/report.json");
    expect(diags.some((d) => d.includes("sha256 mismatch"))).toBe(true);
    expect(diags.some((d) => d.includes("byte_length"))).toBe(true);
    const sorted = [...diags].sort(asciiCompare);
    expect(diags).toEqual(sorted);
  });

  test("path helper rejects traversal", () => {
    expect(resolveUnderRoot(root, "../secret").ok).toBe(false);
    expect(resolveUnderRoot(root, "/etc/passwd").ok).toBe(false);
  });
});
