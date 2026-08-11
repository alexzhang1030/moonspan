import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EXPECTED_REL,
  RECIPE_ID,
  RECIPE_PAYLOAD_FNV1A64_HEX,
  PHASE_ONE_TRIPLES,
  type AgreeDocument,
  checkExpected,
  repoRootFrom as agreeRepoRoot,
  sha256Hex,
  stableJsonPretty,
} from "./protocol-agree.ts";
import {
  OUTPUT_REL,
  OUTCOMES_TOTAL,
  SUCCESS_TOTAL,
  ERROR_TOTAL,
  RUST_BEGIN,
  RUST_END,
  MOONBIT_BEGIN,
  MOONBIT_END,
  type AgreementReport,
  type SpawnRequest,
  type SpawnResult,
  type SpawnRunner,
  checkAgreementReport,
  compareOutcomesExact,
  defaultSpawnRunner,
  diagnoseAgreementReport,
  diagnoseSpawnFailure,
  extractMarkerEnvelope,
  outcomesSha256,
  parseCliMode,
  runLiveAgreementGate,
  writeAgreementReport,
} from "./protocol-agree-run.ts";

const root = agreeRepoRoot(import.meta.dir);
const temps: string[] = [];

/** Counts real cargo/moon invocations through the default runner path. */
let realSubprocessCount = 0;

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "protocol-agree-run-"));
  temps.push(d);
  return d;
}

/** Copy corpus sources needed for checkExpected and report write. */
async function copyCorpusRoot(dest: string): Promise<void> {
  await mkdir(path.join(dest, "protocol/testdata/valid"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/malformed"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/sequences"), { recursive: true });
  await mkdir(path.join(dest, "protocol/registry"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/agreement"), { recursive: true });

  await cp(
    path.join(root, "protocol/testdata/manifest.json"),
    path.join(dest, "protocol/testdata/manifest.json"),
  );
  await cp(
    path.join(root, "protocol/testdata/malformed"),
    path.join(dest, "protocol/testdata/malformed"),
    { recursive: true },
  );
  await cp(
    path.join(root, "protocol/testdata/sequences"),
    path.join(dest, "protocol/testdata/sequences"),
    { recursive: true },
  );
  await cp(
    path.join(root, "protocol/testdata/parity.json"),
    path.join(dest, "protocol/testdata/parity.json"),
  );
  await cp(
    path.join(root, "protocol/registry/r2wp-v0.json"),
    path.join(dest, "protocol/registry/r2wp-v0.json"),
  );
  await cp(
    path.join(root, "protocol/testdata/valid"),
    path.join(dest, "protocol/testdata/valid"),
    { recursive: true },
  );
  await cp(path.join(root, EXPECTED_REL), path.join(dest, EXPECTED_REL));
  await cp(path.join(root, OUTPUT_REL), path.join(dest, OUTPUT_REL));
}

function envelopeLine(
  implementation: string,
  outcomes: unknown[] = [],
): string {
  return JSON.stringify({
    implementation,
    outcomes,
    protocol: "r2wp-v0",
    schema_version: 1,
  });
}

function markerStdout(
  begin: string,
  end: string,
  implementation: string,
  outcomes: unknown[],
): string {
  return ["preamble", begin, envelopeLine(implementation, outcomes), end, "ok"].join(
    "\n",
  );
}

/** Injected runner that mirrors TypeScript outcomes for non-live tests. */
function passThroughRunner(doc: AgreeDocument): SpawnRunner {
  return (req: SpawnRequest): SpawnResult => {
    const isRust = req.cmd[0] === "cargo";
    const implementation = isRust ? "rust" : "moonbit";
    const begin = isRust ? RUST_BEGIN : MOONBIT_BEGIN;
    const end = isRust ? RUST_END : MOONBIT_END;
    const body = JSON.stringify({
      implementation,
      outcomes: doc.outcomes,
      protocol: "r2wp-v0",
      schema_version: 1,
    });
    return {
      exitCode: 0,
      signal: null,
      stdout: [begin, body, end].join("\n"),
      stderr: "",
      timedOut: false,
      outputTruncated: false,
    };
  };
}

/** Counts each real cargo/moon spawn through the exported default runner. */
function countingRealRunner(): SpawnRunner {
  return (req: SpawnRequest): SpawnResult => {
    realSubprocessCount += 1;
    return defaultSpawnRunner(req);
  };
}

let sharedLive:
  | { ok: true; report: AgreementReport; reportText: string }
  | { ok: false; diagnostics: string[] };

beforeAll(async () => {
  realSubprocessCount = 0;
  sharedLive = await runLiveAgreementGate(root, countingRealRunner());
}, 600_000);

describe("protocol-agree-run CLI helpers", () => {
  test("parseCliMode accepts exactly one mode", () => {
    expect(parseCliMode(["--write"])).toBe("write");
    expect(parseCliMode(["--check"])).toBe("check");
    expect(parseCliMode([])).toBeNull();
    expect(parseCliMode(["--write", "--check"])).toBeNull();
  });

  test("spawn failure diagnostics cover nonzero timeout and overflow", () => {
    expect(
      diagnoseSpawnFailure("rust", {
        exitCode: 1,
        signal: null,
        stdout: "x",
        stderr: "boom",
        timedOut: false,
        outputTruncated: false,
      }),
    ).toMatch(/exit 1/);
    expect(
      diagnoseSpawnFailure("rust", {
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "slow",
        timedOut: true,
        outputTruncated: false,
      }),
    ).toMatch(/timed out/);
    expect(
      diagnoseSpawnFailure("rust", {
        exitCode: null,
        signal: null,
        stdout: "big",
        stderr: "",
        timedOut: false,
        outputTruncated: true,
      }),
    ).toMatch(/maxBuffer/);
    expect(
      diagnoseSpawnFailure("rust", {
        exitCode: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        timedOut: false,
        outputTruncated: false,
      }),
    ).toMatch(/signal SIGTERM/);
    expect(
      diagnoseSpawnFailure("rust", {
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        outputTruncated: false,
      }),
    ).toBeNull();
  });
});

describe("protocol-agree-run marker parser", () => {
  const outcomes = Array.from({ length: OUTCOMES_TOTAL }, (_, i) => ({
    id: `id-${String(i).padStart(3, "0")}`,
  }));

  test("accepts valid marker envelope", () => {
    const stdout = markerStdout(RUST_BEGIN, RUST_END, "rust", outcomes);
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope.implementation).toBe("rust");
      expect(r.envelope.outcomes.length).toBe(OUTCOMES_TOTAL);
    }
  });

  test("rejects missing begin", () => {
    const stdout = [envelopeLine("rust", outcomes), RUST_END].join("\n");
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });

  test("rejects duplicate markers", () => {
    const body = envelopeLine("rust", outcomes);
    const stdout = [RUST_BEGIN, body, RUST_END, RUST_BEGIN, body, RUST_END].join(
      "\n",
    );
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });

  test("rejects multi-line span between markers", () => {
    const stdout = [RUST_BEGIN, "line1", "line2", RUST_END].join("\n");
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });

  test("rejects reversed begin/end marker order", () => {
    const body = envelopeLine("rust", outcomes);
    const stdout = [RUST_END, body, RUST_BEGIN].join("\n");
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });

  test("rejects extra envelope key", () => {
    const bad = JSON.stringify({
      implementation: "rust",
      outcomes,
      protocol: "r2wp-v0",
      schema_version: 1,
      extra: true,
    });
    const stdout = [RUST_BEGIN, bad, RUST_END].join("\n");
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exact set/);
  });

  test("rejects wrong implementation", () => {
    const stdout = markerStdout(RUST_BEGIN, RUST_END, "moonbit", outcomes);
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });

  test("rejects malformed JSON", () => {
    const stdout = [RUST_BEGIN, "{not-json", RUST_END].join("\n");
    const r = extractMarkerEnvelope(stdout, RUST_BEGIN, RUST_END, "rust");
    expect(r.ok).toBe(false);
  });
});

describe("protocol-agree-run live integration", () => {
  test("real triple gate runs exactly once and builds report pins", () => {
    expect(sharedLive.ok).toBe(true);
    // One real gate: rust + moonbit = 2 subprocesses.
    expect(realSubprocessCount).toBe(2);
    if (!sharedLive.ok) return;
    const r = sharedLive.report;
    expect(r.canonical.counts.outcomes_total).toBe(OUTCOMES_TOTAL);
    expect(r.agreement.success_total).toBe(SUCCESS_TOTAL);
    expect(r.agreement.error_total).toBe(ERROR_TOTAL);
    expect(r.implementations.map((i) => i.implementation)).toEqual([
      "typescript",
      "rust",
      "moonbit",
    ]);
    const sha = r.agreement.outcomes_sha256;
    expect(r.implementations.every((i) => i.outcomes_sha256 === sha)).toBe(true);
    expect(r.implementations.every((i) => i.matches_canonical)).toBe(true);
    const recipe = r.canonical.outcomes.find((o) => o.source_id === RECIPE_ID);
    expect(recipe).toBeDefined();
    expect(
      recipe &&
        recipe.record &&
        "payload" in recipe.record &&
        recipe.record.payload.form === "application" &&
        recipe.record.payload.payload_fnv1a64_hex,
    ).toBe(RECIPE_PAYLOAD_FNV1A64_HEX);
    expect(r.canonical.phase_one_triples).toEqual(
      PHASE_ONE_TRIPLES.map((t) => ({ ...t })),
    );
    expect(r.canonical.transport_bindings.length).toBe(46);
    expect(
      r.canonical.transport_bindings.every((b) => b.equal_wt_wss === true),
    ).toBe(true);
    expect(diagnoseAgreementReport(r)).toEqual([]);
  });

  test("committed report check is green via replay runner", async () => {
    expect(sharedLive.ok).toBe(true);
    if (!sharedLive.ok) return;
    const runner = passThroughRunner(sharedLive.report.canonical);
    const a = await checkAgreementReport(root, runner);
    const b = await checkAgreementReport(root, runner);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(stableJsonPretty(a.report)).toBe(stableJsonPretty(b.report));
      expect(a.report.agreement.outcomes_sha256).toBe(
        b.report.agreement.outcomes_sha256,
      );
      expect(a.report.agreement.outcomes_sha256).toBe(
        sharedLive.report.agreement.outcomes_sha256,
      );
    }
  }, 180_000);
});

describe("protocol-agree-run report validator mutations", () => {
  test("table-driven report mutations", () => {
    expect(sharedLive.ok).toBe(true);
    if (!sharedLive.ok) return;
    const base = JSON.parse(sharedLive.reportText) as Record<string, unknown>;

    type Case = { name: string; mut: (c: Record<string, unknown>) => void; needle: RegExp };
    const cases: Case[] = [
      {
        name: "root extra key",
        mut: (c) => {
          c.extra_probe = true;
        },
        needle: /unknown key "extra_probe"/,
      },
      {
        name: "agreement nested extra key",
        mut: (c) => {
          (c.agreement as Record<string, unknown>).extra_probe = true;
        },
        needle: /agreement: unknown key "extra_probe"/,
      },
      {
        name: "expected_file sha256 drift",
        mut: (c) => {
          const a = c.agreement as {
            expected_file: { sha256: string };
          };
          a.expected_file.sha256 = "0".repeat(64);
        },
        needle: /agreement\.expected_file\.sha256/,
      },
      {
        name: "implementation reorder",
        mut: (c) => {
          const impl = c.implementations as Array<{ implementation: string }>;
          const tmp = impl[0]!;
          impl[0] = impl[1]!;
          impl[1] = tmp;
        },
        needle: /implementation order/,
      },
      {
        name: "outcomes digest drift",
        mut: (c) => {
          const a = c.agreement as { outcomes_sha256: string };
          a.outcomes_sha256 = "0".repeat(64);
        },
        needle: /outcomes_sha256/,
      },
      {
        name: "canonical semantic drift",
        mut: (c) => {
          const canon = c.canonical as {
            outcomes: Array<{ id: string }>;
          };
          canon.outcomes[0]!.id = "valid_boundary:mutated";
        },
        needle: /agreement\.canonical_sha256|corpus-qualified/,
      },
      {
        name: "transport equality drift",
        mut: (c) => {
          const canon = c.canonical as {
            transport_bindings: Array<{ equal_wt_wss: boolean }>;
          };
          (canon.transport_bindings[0] as { equal_wt_wss: boolean }).equal_wt_wss =
            false as unknown as true;
        },
        needle: /equal_wt_wss/,
      },
      {
        name: "phase one drift",
        mut: (c) => {
          const canon = c.canonical as {
            phase_one_triples: Array<{ ros_distro: string }>;
          };
          canon.phase_one_triples[0]!.ros_distro = "mutated";
        },
        needle: /phase_one_triples/,
      },
      {
        name: "implementation mismatch flag",
        mut: (c) => {
          const impl = c.implementations as Array<{ matches_canonical: boolean }>;
          impl[0]!.matches_canonical = false;
        },
        needle: /matches_canonical/,
      },
    ];

    for (const tc of cases) {
      const clone = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      tc.mut(clone);
      const d = diagnoseAgreementReport(clone);
      expect(d.length).toBeGreaterThan(0);
      expect(d.some((x) => tc.needle.test(x))).toBe(true);
    }
  });
});

describe("protocol-agree-run temp-root I/O", () => {
  test("two writes produce byte and SHA-256 identity", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const ts = await checkExpected(dest);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const runner = passThroughRunner(ts.doc);
    const first = await writeAgreementReport(dest, runner);
    const second = await writeAgreementReport(dest, runner);
    expect(first.text).toBe(second.text);
    expect(sha256Hex(first.text)).toBe(sha256Hex(second.text));
    const check = await checkAgreementReport(dest, runner);
    expect(check.ok).toBe(true);
    const committed = await readFile(path.join(dest, OUTPUT_REL), "utf8");
    expect(committed).toBe(first.text);
    expect(sha256Hex(committed)).toBe(sha256Hex(first.text));
  }, 300_000);

  test("stale report fails check", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const ts = await checkExpected(dest);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const runner = passThroughRunner(ts.doc);
    await writeAgreementReport(dest, runner);
    const abs = path.join(dest, OUTPUT_REL);
    const cur = await readFile(abs, "utf8");
    await writeFile(abs, `${cur}\n`, "utf8");
    const check = await checkAgreementReport(dest, runner);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(
        check.diagnostics.some((d) => /canonical rebuild/.test(d)),
      ).toBe(true);
    }
  }, 300_000);

  test("report write target symlink is rejected", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const ts = await checkExpected(dest);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const runner = passThroughRunner(ts.doc);
    const abs = path.join(dest, OUTPUT_REL);
    await rm(abs, { force: true });
    const real = path.join(dest, "report-real.json");
    await writeFile(real, "{}\n", "utf8");
    await symlink(real, abs);
    await expect(writeAgreementReport(dest, runner)).rejects.toThrow(
      /symlink write target rejected/,
    );
  }, 300_000);

  test("agreement directory symlink is rejected on write", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const ts = await checkExpected(dest);
    expect(ts.ok).toBe(true);
    if (!ts.ok) return;
    const runner = passThroughRunner(ts.doc);
    const agree = path.join(dest, "protocol/testdata/agreement");
    const real = path.join(dest, "agreement-real");
    await rename(agree, real);
    await symlink(real, agree);
    await expect(writeAgreementReport(dest, runner)).rejects.toThrow(/symlink/);
  }, 300_000);
});

describe("protocol-agree-run injected runner", () => {
  test("nonzero child exit produces process diagnostics", async () => {
    const runner: SpawnRunner = (_req: SpawnRequest): SpawnResult => ({
      exitCode: 2,
      signal: null,
      stdout: "",
      stderr: "fixture nonzero stderr",
      timedOut: false,
      outputTruncated: false,
    });
    const live = await runLiveAgreementGate(root, runner);
    expect(live.ok).toBe(false);
    if (!live.ok) {
      expect(live.diagnostics.some((d) => /rust: process exit 2/.test(d))).toBe(
        true,
      );
      expect(
        live.diagnostics.some((d) => /moonbit: process exit 2/.test(d)),
      ).toBe(true);
    }
  }, 180_000);

  test("throwing runner yields implementation-scoped spawn diagnostics", async () => {
    // Both branches throw so each implementation records its own spawn diagnostic.
    const runner: SpawnRunner = (req: SpawnRequest): SpawnResult => {
      if (req.cmd[0] === "cargo") {
        throw new Error("fixture missing cargo executable");
      }
      throw new Error("fixture missing moon executable");
    };
    const live = await runLiveAgreementGate(root, runner);
    expect(live.ok).toBe(false);
    if (!live.ok) {
      expect(live.diagnostics.some((d) => /rust: spawn failed:/.test(d))).toBe(
        true,
      );
      expect(
        live.diagnostics.some((d) => /moonbit: spawn failed:/.test(d)),
      ).toBe(true);
      // Spawn diagnostics stay implementation-scoped and length-bounded.
      expect(
        live.diagnostics.every((d) => d.length < 600),
      ).toBe(true);
    }
  }, 180_000);
});

describe("protocol-agree-run root wiring shape", () => {
  test("package.json and justfile invoke agreement exactly once in check chains", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["protocol-agree:check"]).toBe(
      "bun run scripts/protocol-agree-run.ts --check",
    );
    expect(pkg.scripts["protocol-agree:write"]).toBe(
      "bun run scripts/protocol-agree-run.ts --write",
    );
    expect(pkg.scripts["protocol-agree"]).toBe("bun run protocol-agree:check");
    expect(pkg.scripts["test:protocol-agree"]).toBe(
      "bun test scripts/protocol-agree-run.test.ts",
    );
    const check = pkg.scripts.check;
    expect(check).toContain("protocol-moonbit-fixtures:check");
    expect(check).toContain("protocol-agree:check");
    const agreeHits = check.split("protocol-agree:check").length - 1;
    expect(agreeHits).toBe(1);

    const just = await readFile(path.join(root, "justfile"), "utf8");
    expect(just).toMatch(/protocol-agree: toolchain-check/);
    expect(just).toMatch(/protocol-agree-write: toolchain-check/);
    expect(just).toMatch(/bun run protocol-agree\b/);
    expect(just).toMatch(/bun run protocol-agree:write/);
    expect(just).toMatch(/bun run check/);
  });
});

describe("protocol-agree-run compare helpers", () => {
  test("compareOutcomesExact identifies first path", () => {
    const a = [{ id: "a", x: 1 }];
    const b = [{ id: "a", x: 2 }];
    const d = compareOutcomesExact("rust", a, b);
    expect(d).toMatch(/rust: first divergent outcome id=a path=outcome\.x/);
    expect(outcomesSha256(a)).not.toBe(outcomesSha256(b));
  });

  test("reports real subprocess count from beforeAll", () => {
    // beforeAll records one cargo call and one moon call.
    expect(realSubprocessCount).toBe(2);
  });
});
