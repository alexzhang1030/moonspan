import { afterEach, describe, expect, test } from "bun:test";
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
import { $ } from "bun";
import { RECIPE_ID } from "./protocol-moonbit-fixtures.ts";
import {
  EXPECTED_REL,
  GENERATED_SOURCE_MAX_BYTES,
  OUTCOMES_TOTAL,
  OUTPUT_REL,
  VALID_MANIFEST_REL,
  buildAgreeJobs,
  checkJobs,
  parseCliMode,
  repoRootFrom,
  writeJobs,
} from "./protocol-moonbit-agree.ts";

const root = repoRootFrom(import.meta.dir);
const temps: string[] = [];

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "moonbit-agree-"));
  temps.push(d);
  return d;
}

/** Copy materialized valid binaries; the 64 MiB case remains recipe-backed. */
async function copyCorpusRoot(dest: string): Promise<void> {
  await mkdir(path.join(dest, "protocol/testdata/valid"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/malformed"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/sequences"), { recursive: true });
  await mkdir(path.join(dest, "protocol/registry"), { recursive: true });
  await mkdir(path.join(dest, "protocol/testdata/agreement"), { recursive: true });
  await mkdir(path.join(dest, "rclmbt/cmd/agree"), { recursive: true });

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
  await cp(
    path.join(root, EXPECTED_REL),
    path.join(dest, EXPECTED_REL),
  );
  // Seed committed jobs.mbt so checkJobs has a write target path.
  await cp(
    path.join(root, OUTPUT_REL),
    path.join(dest, OUTPUT_REL),
  );
}

function extractEnvelope(stdout: string): {
  begin: number;
  end: number;
  envelope: unknown;
} {
  const lines = stdout.split(/\r?\n/);
  const begins: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "MOONSPAN_R2WP_AGREEMENT_MOONBIT_BEGIN") begins.push(i);
    if (lines[i] === "MOONSPAN_R2WP_AGREEMENT_MOONBIT_END") ends.push(i);
  }
  expect(begins.length).toBe(1);
  expect(ends.length).toBe(1);
  expect(ends[0]).toBe(begins[0]! + 2);
  const raw = lines[begins[0]! + 1]!;
  const envelope = JSON.parse(raw) as unknown;
  return { begin: begins[0]!, end: ends[0]!, envelope };
}

describe("protocol-moonbit-agree helpers", () => {
  test("parseCliMode accepts exactly one mode", () => {
    expect(parseCliMode(["--write"])).toBe("write");
    expect(parseCliMode(["--check"])).toBe("check");
    expect(parseCliMode([])).toBeNull();
    expect(parseCliMode(["--write", "--check"])).toBeNull();
  });
});

describe("protocol-moonbit-agree generator", () => {
  test("buildAgreeJobs is deterministic and closed", async () => {
    const a = await buildAgreeJobs(root);
    const b = await buildAgreeJobs(root);
    expect(a.sourceText).toBe(b.sourceText);
    expect(a.jobs.length).toBe(OUTCOMES_TOTAL);
    expect(Buffer.byteLength(a.sourceText, "utf8")).toBeLessThanOrEqual(
      GENERATED_SOURCE_MAX_BYTES,
    );
    const success = a.jobs.filter((j) => j.expectSuccess).length;
    const error = a.jobs.filter((j) => !j.expectSuccess).length;
    expect(success).toBe(46);
    expect(error).toBe(55);
    const recipe = a.jobs.find((j) => j.sourceId === RECIPE_ID);
    expect(recipe).toBeDefined();
    expect(recipe!.representation).toBe("segment_recipe");
    expect(recipe!.recipe).not.toBeNull();
  }, 180_000);

  test("checkJobs accepts committed generated source", async () => {
    const r = await checkJobs(root);
    expect(r.ok).toBe(true);
  }, 180_000);

  test("stale committed jobs.mbt fails checkJobs with rebuild diagnostic", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    await writeJobs(dest);
    const jobsAbs = path.join(dest, OUTPUT_REL);
    const text = await readFile(jobsAbs, "utf8");
    await writeFile(jobsAbs, `${text}\n// stale mutation\n`, "utf8");
    const r = await checkJobs(dest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.diagnostics.some((d) =>
          /committed source requires canonical rebuild/.test(d),
        ),
      ).toBe(true);
    }
  }, 300_000);

  test("unknown top-level valid manifest key is rejected", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const manAbs = path.join(dest, VALID_MANIFEST_REL);
    const man = JSON.parse(await readFile(manAbs, "utf8")) as Record<
      string,
      unknown
    >;
    man.unexpected_h3_probe = true;
    await writeFile(manAbs, `${JSON.stringify(man, null, 2)}\n`, "utf8");
    await expect(buildAgreeJobs(dest)).rejects.toThrow(
      /closed agreement validation requires success/,
    );
  }, 300_000);

  test("intermediate valid directory symlink is rejected", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const validAbs = path.join(dest, "protocol/testdata/valid");
    const realValid = path.join(dest, "protocol/testdata/valid-real");
    await rename(validAbs, realValid);
    await symlink(realValid, validAbs);
    await expect(buildAgreeJobs(dest)).rejects.toThrow(
      /closed agreement validation requires success|symlink directory rejected/,
    );
  }, 300_000);

  test("writeJobs rejects symlink write target", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const jobsAbs = path.join(dest, OUTPUT_REL);
    await rm(jobsAbs, { force: true });
    const realTarget = path.join(dest, "jobs-real.mbt");
    await writeFile(realTarget, "// real\n", "utf8");
    await symlink(realTarget, jobsAbs);
    await expect(writeJobs(dest)).rejects.toThrow(/symlink write target rejected/);
  }, 300_000);

  test("generator rejects missing manifests under bad root", async () => {
    const dest = await tempDir();
    await expect(buildAgreeJobs(dest)).rejects.toThrow();
  });
});

describe("protocol-moonbit-agree emitter", () => {
  test("moon run emits one closed envelope matching expected.json", async () => {
    const proc =
      await $`moon run --frozen --release --target wasm rclmbt/cmd/agree`.quiet();
    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    const { envelope } = extractEnvelope(stdout);
    expect(Object.keys(envelope as object).sort()).toEqual([
      "implementation",
      "outcomes",
      "protocol",
      "schema_version",
    ]);
    expect(envelope).toMatchObject({
      schema_version: 1,
      protocol: "r2wp-v0",
      implementation: "moonbit",
    });
    const env = envelope as {
      outcomes: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(env.outcomes)).toBe(true);
    expect(env.outcomes.length).toBe(OUTCOMES_TOTAL);
    for (let i = 1; i < env.outcomes.length; i++) {
      const prev = String(env.outcomes[i - 1]!.id);
      const cur = String(env.outcomes[i]!.id);
      expect(prev < cur).toBe(true);
    }
    const expectedText = await readFile(path.join(root, EXPECTED_REL), "utf8");
    const expected = JSON.parse(expectedText) as {
      outcomes: Array<Record<string, unknown>>;
    };
    expect(env.outcomes).toEqual(expected.outcomes);
    const recipe = env.outcomes.find(
      (o) => o.source_id === RECIPE_ID,
    ) as {
      record: { payload: { payload_fnv1a64_hex: string; payload_len: number } };
    };
    expect(recipe.record.payload.payload_fnv1a64_hex).toBe("3a07afcfc8222325");
    expect(recipe.record.payload.payload_len).toBe(67_108_864);
  }, 300_000);

  test("marker parser rejects missing begin marker", () => {
    expect(() =>
      extractEnvelope("MOONSPAN_R2WP_AGREEMENT_MOONBIT_END\n"),
    ).toThrow();
  });

  test("marker parser rejects duplicate marker pairs", () => {
    const body = JSON.stringify({
      schema_version: 1,
      protocol: "r2wp-v0",
      implementation: "moonbit",
      outcomes: [],
    });
    const text = [
      "MOONSPAN_R2WP_AGREEMENT_MOONBIT_BEGIN",
      body,
      "MOONSPAN_R2WP_AGREEMENT_MOONBIT_END",
      "MOONSPAN_R2WP_AGREEMENT_MOONBIT_BEGIN",
      body,
      "MOONSPAN_R2WP_AGREEMENT_MOONBIT_END",
    ].join("\n");
    expect(() => extractEnvelope(text)).toThrow();
  });
});
