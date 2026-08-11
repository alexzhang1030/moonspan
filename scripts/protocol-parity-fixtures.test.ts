import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  cp,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  REQUIRED_TRANSPORT_RULE_IDS,
  SHARED_ARTIFACT_COUNT,
  VALID_COUNT,
  SEQUENCE_EVENT_COUNT,
  PARITY_REL,
  MANIFEST_ONLY_RECIPE_ID,
  buildParityDocument,
  buildTransportRules,
  checkParityFixtures,
  diagnoseParityValue,
  isCanonicalSequenceEventPath,
  isCanonicalValidArtifactPath,
  parseCliMode,
  parseSeqManifest,
  parseValidManifest,
  stableJson,
  writeParityFixtures,
  artifactId,
  semanticIdentity,
  type ParityDocument,
} from "./protocol-parity-fixtures.ts";
import { createHash } from "node:crypto";
import {
  AGGREGATE_CORPUS_ORDER,
  defaultCorpusRunners,
  runAggregateCheck,
  runAggregateWrite,
  type CorpusRunner,
} from "./protocol-fixtures.ts";
import { readFileSync } from "node:fs";
// readFileSync used for package script parse and recipe fixture load

const ROOT = path.resolve(import.meta.dir, "..");

async function scaffoldTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "parity-fx-"));
  // Copy registry + both source corpora (manifests + artifacts needed by parity check).
  await mkdir(path.join(dir, "protocol/registry"), { recursive: true });
  await cp(
    path.join(ROOT, "protocol/registry/r2wp-v0.json"),
    path.join(dir, "protocol/registry/r2wp-v0.json"),
  );
  await mkdir(path.join(dir, "protocol/testdata"), { recursive: true });
  await cp(path.join(ROOT, "protocol/testdata/manifest.json"), path.join(dir, "protocol/testdata/manifest.json"));
  await cp(path.join(ROOT, "protocol/testdata/valid"), path.join(dir, "protocol/testdata/valid"), {
    recursive: true,
  });
  await cp(
    path.join(ROOT, "protocol/testdata/sequences"),
    path.join(dir, "protocol/testdata/sequences"),
    { recursive: true },
  );
  await writeFile(path.join(dir, "package.json"), "{}\n");
  return dir;
}

async function withParity(mut: (dir: string, doc: ParityDocument) => Promise<void>): Promise<string[]> {
  const dir = await scaffoldTemp();
  try {
    const doc = await writeParityFixtures(dir);
    await mut(dir, doc);
    return (await checkParityFixtures(dir)).diags;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("protocol-parity-fixtures helpers", () => {
  test.each([
    [["--write"], "write"],
    [["--check"], "check"],
    [[], null],
    [["--write", "--check"], null],
    [["--check", "x"], null],
  ] as const)("parseCliMode %j → %j", (argv, want) => {
    expect(parseCliMode([...argv])).toBe(want);
  });

  test("required rule set is sorted unique and closed", () => {
    const rules = buildTransportRules();
    expect(rules.map((r) => r.id)).toEqual([...REQUIRED_TRANSPORT_RULE_IDS]);
    expect(rules.length).toBe(20);
    expect(SHARED_ARTIFACT_COUNT).toBe(VALID_COUNT + SEQUENCE_EVENT_COUNT);
  });
});

describe("protocol-parity-fixtures corpus", () => {
  test("build counts and identity equality", async () => {
    const doc = await buildParityDocument(ROOT);
    expect(doc.shared_artifacts.length).toBe(46);
    expect(doc.transport_rules.length).toBe(20);
    expect(doc.source_manifests.map((s) => s.id)).toEqual(["sequences", "valid_boundary"].sort());
    const valid = doc.shared_artifacts.filter((a) => a.source_corpus === "valid_boundary");
    const seq = doc.shared_artifacts.filter((a) => a.source_corpus === "sequences");
    expect(valid.length).toBe(20);
    expect(seq.length).toBe(26);
    for (const a of doc.shared_artifacts) {
      expect(a.id).toBe(artifactId(a.source_corpus, a.source_id));
      expect(a.webtransport.sha256).toBe(a.sha256);
      expect(a.binary_wss.sha256).toBe(a.sha256);
      expect(a.webtransport.byte_length).toBe(a.byte_length);
      expect(a.binary_wss.byte_length).toBe(a.byte_length);
      expect(a.webtransport.semantic_identity).toBe(semanticIdentity(a.source_corpus, a.source_id));
      expect(a.binary_wss.semantic_identity).toBe(a.webtransport.semantic_identity);
    }
  });

  test("committed check green and read-only", async () => {
    // Committed parity.json is required input; this test only verifies read-only check behavior.
    const before = await readFile(path.join(ROOT, PARITY_REL), "utf8");
    expect((await checkParityFixtures(ROOT)).diags).toEqual([]);
    const after = await readFile(path.join(ROOT, PARITY_REL), "utf8");
    expect(after).toBe(before);
  });

  test("legitimate segment recipe null path is accepted by parser", () => {
    const raw = JSON.parse(
      readFileSync(path.join(ROOT, "protocol/testdata/manifest.json"), "utf8"),
    );
    const fixtures = parseValidManifest(raw);
    const recipe = fixtures.find((f) => f.id === MANIFEST_ONLY_RECIPE_ID);
    expect(recipe).toBeDefined();
    expect(recipe!.path).toBeNull();
    expect(isCanonicalValidArtifactPath(MANIFEST_ONLY_RECIPE_ID, null)).toBe(true);
    expect(isCanonicalValidArtifactPath("bootstrap-client-hello-maxima", null)).toBe(false);
    expect(
      isCanonicalValidArtifactPath(
        "bootstrap-client-hello-maxima",
        "valid/bootstrap-client-hello-maxima.bin",
      ),
    ).toBe(true);
  });
});

describe("protocol-parity-fixtures diagnose", () => {
  test.each([
    [null, "null"],
    [[], "array"],
    [{}, "missing"],
  ])("root %p rejected", (v, needle) => {
    const d = diagnoseParityValue(v);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.toLowerCase().includes(needle))).toBe(true);
  });

  test("unknown top-level key rejected", async () => {
    const doc = (await buildParityDocument(ROOT)) as unknown as Record<string, unknown>;
    doc.extra = true;
    expect(diagnoseParityValue(doc).some((d) => d.includes("unknown key"))).toBe(true);
  });

  test("duplicate shared artifact id rejected", async () => {
    const doc = await buildParityDocument(ROOT);
    doc.shared_artifacts.push({ ...doc.shared_artifacts[0]! });
    expect(diagnoseParityValue(doc).some((d) => d.includes("duplicate"))).toBe(true);
  });

  test("WT/WSS hash mismatch rejected", async () => {
    const doc = await buildParityDocument(ROOT);
    doc.shared_artifacts[0]!.webtransport.sha256 = "0".repeat(64);
    expect(diagnoseParityValue(doc).some((d) => d.includes("sha256"))).toBe(true);
  });

  test("missing required rule rejected", async () => {
    const doc = await buildParityDocument(ROOT);
    doc.transport_rules = doc.transport_rules.filter((r) => r.id !== "service_response_reliable_stream");
    expect(diagnoseParityValue(doc).some((d) => d.includes("service_response"))).toBe(true);
  });

  test("datagram without negotiation rejected", async () => {
    const doc = await buildParityDocument(ROOT);
    const r = doc.transport_rules.find((x) => x.wt_transport === "datagram")!;
    r.negotiation = false;
    expect(diagnoseParityValue(doc).some((d) => d.includes("negotiation"))).toBe(true);
  });
});

describe("protocol-parity-fixtures temp adversarial", () => {
  test("two-write byte identity", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeParityFixtures(dir);
      const a = await readFile(path.join(dir, PARITY_REL));
      await writeParityFixtures(dir);
      const b = await readFile(path.join(dir, PARITY_REL));
      expect(Buffer.compare(a, b)).toBe(0);
      expect((await checkParityFixtures(dir)).diags).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("check creates nothing when parity missing", async () => {
    const dir = await scaffoldTemp();
    try {
      const before = await readdir(path.join(dir, "protocol/testdata"));
      const { diags } = await checkParityFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(await readdir(path.join(dir, "protocol/testdata"))).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("canonical whitespace drift fails", async () => {
    const diags = await withParity(async (dir) => {
      const p = path.join(dir, PARITY_REL);
      const obj = JSON.parse(await readFile(p, "utf8"));
      await writeFile(p, JSON.stringify(obj));
    });
    expect(diags.some((d) => d.includes("canonical") || d.includes("raw text"))).toBe(true);
  });

  test("source manifest hash drift fails", async () => {
    const diags = await withParity(async (dir) => {
      const p = path.join(dir, "protocol/testdata/manifest.json");
      await writeFile(p, (await readFile(p, "utf8")) + "\n");
    });
    expect(diags.some((d) => d.includes("sha256") || d.includes("length") || d.includes("source"))).toBe(
      true,
    );
  });

  test("source artifact length drift fails", async () => {
    const diags = await withParity(async (dir, doc) => {
      const a = doc.shared_artifacts.find((x) => x.source_corpus === "sequences")!;
      a.byte_length = a.byte_length + 1;
      a.webtransport.byte_length = a.byte_length;
      a.binary_wss.byte_length = a.byte_length;
      await writeFile(path.join(dir, PARITY_REL), stableJson(doc));
    });
    expect(diags.some((d) => d.includes("byte_length") || d.includes("length"))).toBe(true);
  });

  test("missing shared source id fails", async () => {
    const diags = await withParity(async (dir, doc) => {
      doc.shared_artifacts = doc.shared_artifacts.filter(
        (a) => a.source_id !== "evt-authenticate",
      );
      await writeFile(path.join(dir, PARITY_REL), stableJson(doc));
    });
    expect(diags.some((d) => d.includes("missing") || d.includes("count") || d.includes("evt-authenticate"))).toBe(
      true,
    );
  });

  test.each([...REQUIRED_TRANSPORT_RULE_IDS])("rule mutation %s fails check", async (ruleId) => {
    const diags = await withParity(async (dir, doc) => {
      const r = doc.transport_rules.find((x) => x.id === ruleId)!;
      r.semantic = "mutated_semantic";
      await writeFile(path.join(dir, PARITY_REL), stableJson(doc));
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("registry transport section removed fails cross-bind", async () => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      delete reg.transport;
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes("registry") || d.includes("transport"))).toBe(true);
  });

  test.each([
    [
      "wt datagram_rule",
      (reg: Record<string, unknown>) => {
        (reg.transport as Record<string, unknown>).webtransport = {
          ...((reg.transport as Record<string, unknown>).webtransport as object),
          datagram_rule: "wrong",
        };
      },
      "datagram_rule",
    ],
    [
      "wss message_rule",
      (reg: Record<string, unknown>) => {
        (reg.transport as Record<string, unknown>).binary_wss = {
          ...((reg.transport as Record<string, unknown>).binary_wss as object),
          message_rule: "wrong",
        };
      },
      "message_rule",
    ],
    [
      "wss admission",
      (reg: Record<string, unknown>) => {
        const wss = (reg.transport as Record<string, unknown>).binary_wss as Record<string, unknown>;
        const be = {
          ...(wss.best_effort_topic_and_action_feedback_status as object),
          admission: "wrong",
        };
        wss.best_effort_topic_and_action_feedback_status = be;
      },
      "admission",
    ],
    [
      "ACTION_FEEDBACK BE datagram",
      (reg: Record<string, unknown>) => {
        const assigned = (reg.opcodes as Record<string, unknown>).assigned as Record<
          string,
          Record<string, unknown>
        >;
        const row = assigned["6"]!;
        const tr = { ...(row.transport as Record<string, unknown>) };
        const be = { ...(tr.BEST_EFFORT as Record<string, unknown>), datagram: "wrong" };
        tr.BEST_EFFORT = be;
        row.transport = tr;
      },
      "datagram",
    ],
    [
      "action_feedback_status prose",
      (reg: Record<string, unknown>) => {
        const ofr = (reg.transport as Record<string, unknown>)
          .operation_frame_transport_rule as Record<string, unknown>;
        ofr.action_feedback_status = "wrong";
      },
      "action_feedback_status",
    ],
    // Relational probes (review round 3)
    [
      "topic_publish opcode",
      (reg: Record<string, unknown>) => {
        const row = (reg.payload_channel_mapping as Array<Record<string, unknown>>).find(
          (r) => r.semantic === "topic_publish",
        )!;
        row.opcode = "MEDIA_CHUNK";
      },
      "topic_publish",
    ],
    [
      "topic_subscribe selection",
      (reg: Record<string, unknown>) => {
        const row = (reg.payload_channel_mapping as Array<Record<string, unknown>>).find(
          (r) => r.semantic === "topic_subscribe",
        )!;
        const tr = { ...(row.transport as Record<string, unknown>), selection: "wrong" };
        row.transport = tr;
      },
      "selection",
    ],
    [
      "service_client opcodes",
      (reg: Record<string, unknown>) => {
        const row = (reg.payload_channel_mapping as Array<Record<string, unknown>>).find(
          (r) => r.semantic === "service_client",
        )!;
        row.opcodes = ["MEDIA_CHUNK"];
      },
      "opcodes",
    ],
    [
      "action_client opcodes",
      (reg: Record<string, unknown>) => {
        const row = (reg.payload_channel_mapping as Array<Record<string, unknown>>).find(
          (r) => r.semantic === "action_client",
        )!;
        row.opcodes = ["MEDIA_CHUNK"];
      },
      "opcodes",
    ],
    [
      "action_client FEEDBACK.from",
      (reg: Record<string, unknown>) => {
        const row = (reg.payload_channel_mapping as Array<Record<string, unknown>>).find(
          (r) => r.semantic === "action_client",
        )!;
        const tr = { ...(row.transport as Record<string, unknown>) };
        const fb = { ...(tr.ACTION_FEEDBACK as Record<string, unknown>), from: "wrong" };
        tr.ACTION_FEEDBACK = fb;
        row.transport = tr;
      },
      "from",
    ],
    [
      "ACTION_FEEDBACK transport.source",
      (reg: Record<string, unknown>) => {
        const assigned = (reg.opcodes as Record<string, unknown>).assigned as Record<
          string,
          Record<string, unknown>
        >;
        const row = assigned["6"]!;
        const tr = { ...(row.transport as Record<string, unknown>), source: "wrong" };
        row.transport = tr;
      },
      "source",
    ],
    [
      "wss applies_to",
      (reg: Record<string, unknown>) => {
        const wss = (reg.transport as Record<string, unknown>).binary_wss as Record<string, unknown>;
        const be = {
          ...(wss.best_effort_topic_and_action_feedback_status as object),
          applies_to: ["wrong"],
        };
        wss.best_effort_topic_and_action_feedback_status = be;
      },
      "applies_to",
    ],
    [
      "shared_semantic_fixtures",
      (reg: Record<string, unknown>) => {
        (reg.transport as Record<string, unknown>).shared_semantic_fixtures = false;
      },
      "shared_semantic_fixtures",
    ],
  ] as const)("registry corruption %s fails disk-first check", async (_label, mut, needle) => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      mut(reg);
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes(needle) || d.includes("expected"))).toBe(true);
  });
  test("payload mapping removal fails cross-bind", async () => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      reg.payload_channel_mapping = reg.payload_channel_mapping.filter(
        (r: { semantic: string }) => r.semantic !== "topic_publish",
      );
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes("topic_publish") || d.includes("payload"))).toBe(true);
  });

  test("payload mapping value drift fails cross-bind", async () => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      const row = reg.payload_channel_mapping.find(
        (r: { semantic: string }) => r.semantic === "service_client",
      );
      row.transport = "wrong_stream";
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes("service_client") || d.includes("expected"))).toBe(true);
  });

  test("nested registry_bind unknown key fails diagnose", async () => {
    const doc = await buildParityDocument(ROOT);
    const bind = doc.transport_rules[0]!.registry_bind as unknown as Record<string, unknown>;
    bind.extra = true;
    const d = diagnoseParityValue(doc);
    expect(d.some((x) => x.includes("unknown key") && x.includes("registry_bind"))).toBe(true);
  });

  test("nested registry_bind type drift fails diagnose", async () => {
    const doc = await buildParityDocument(ROOT);
    const bind = doc.transport_rules[0]!.registry_bind;
    bind.opcodes = "nope" as never;
    const d = diagnoseParityValue(doc);
    expect(d.some((x) => x.includes("opcodes") && x.includes("array"))).toBe(true);
  });

  test("symlink parity file rejected", async () => {
    const diags = await withParity(async (dir) => {
      const abs = path.join(dir, PARITY_REL);
      const ext = path.join(dir, "ext-parity.json");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.some((d) => d.includes("symlink") || d.includes("parity"))).toBe(true);
  });

  test("malformed parity JSON fails", async () => {
    const diags = await withParity(async (dir) => {
      await writeFile(path.join(dir, PARITY_REL), "{not-json");
    });
    expect(diags.some((d) => d.toLowerCase().includes("malformed"))).toBe(true);
  });

  test("write rejects symlinked testdata parent", async () => {
    const dir = await scaffoldTemp();
    try {
      await rm(path.join(dir, "protocol/testdata"), { recursive: true, force: true });
      const ext = path.join(dir, "ext-td");
      await mkdir(ext);
      await symlink(ext, path.join(dir, "protocol/testdata"));
      await expect(writeParityFixtures(dir)).rejects.toThrow(/symlink/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("attack A: sequence event path escape to package.json fails", async () => {
    const dir = await scaffoldTemp();
    try {
      const pkgAbs = path.join(dir, "package.json");
      const pkgBytes = new Uint8Array(await readFile(pkgAbs));
      const pkgHash = createHash("sha256").update(pkgBytes).digest("hex");
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8"));
      const ev = man.events.find((e: { id: string }) => e.id === "evt-authenticate")!;
      ev.path = "../../../package.json";
      ev.byte_length = pkgBytes.length;
      ev.sha256 = pkgHash;
      await writeFile(manPath, JSON.stringify(man, null, 2) + "\n");
      // Parser rejects before any artifact read.
      expect(() => parseSeqManifest(man)).toThrow(/events\/evt-authenticate\.bin/);
      await expect(writeParityFixtures(dir)).rejects.toThrow(/events\/evt-authenticate\.bin|path must be exactly/);
      // Even if an old parity doc were present, check re-parses source and fails.
      const cleanRoot = await scaffoldTemp();
      try {
        await writeParityFixtures(cleanRoot);
        // copy clean parity into attacked tree then re-check with attacked sequences manifest
        await cp(
          path.join(cleanRoot, PARITY_REL),
          path.join(dir, PARITY_REL),
        );
        // rebuild parity hash for source manifests entry won't match, but also parse fails
        const { diags } = await checkParityFixtures(dir);
        expect(diags.some((d) => d.includes("path") || d.includes("events/"))).toBe(true);
      } finally {
        await rm(cleanRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("attack B: ordinary valid fixture path null with fake length/hash fails", async () => {
    const dir = await scaffoldTemp();
    try {
      const manPath = path.join(dir, "protocol/testdata/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8"));
      const fx = man.fixtures.find(
        (f: { id: string }) => f.id === "bootstrap-client-hello-maxima",
      )!;
      fx.path = null;
      fx.byte_length = 1;
      fx.sha256 = "0".repeat(64);
      await writeFile(manPath, JSON.stringify(man, null, 2) + "\n");
      expect(() => parseValidManifest(man)).toThrow(/null path rejected|valid\//);
      await expect(writeParityFixtures(dir)).rejects.toThrow(/null path rejected|valid\//);
      // Recipe still parses when only recipe is null.
      const clean = JSON.parse(
        await readFile(path.join(ROOT, "protocol/testdata/manifest.json"), "utf8"),
      );
      expect(() => parseValidManifest(clean)).not.toThrow();
      const recipe = parseValidManifest(clean).find((f) => f.id === MANIFEST_ONLY_RECIPE_ID)!;
      expect(recipe.path).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("canonical sequence path helper rejects traversal", () => {
    expect(isCanonicalSequenceEventPath("evt-authenticate", "events/evt-authenticate.bin")).toBe(
      true,
    );
    expect(
      isCanonicalSequenceEventPath("evt-authenticate", "../../../package.json"),
    ).toBe(false);
    expect(isCanonicalSequenceEventPath("evt-authenticate", "events/other.bin")).toBe(false);
  });

  test("sequences parent symlink fails check", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeParityFixtures(dir);
      const seqRel = path.join(dir, "protocol/testdata/sequences");
      const ext = path.join(dir, "ext-sequences");
      await cp(seqRel, ext, { recursive: true });
      await rm(seqRel, { recursive: true, force: true });
      await symlink(ext, seqRel);
      const { diags } = await checkParityFixtures(dir);
      expect(diags.some((d) => d.includes("symlink") || d.includes("path chain"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("valid parent symlink fails check", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeParityFixtures(dir);
      const validRel = path.join(dir, "protocol/testdata/valid");
      const ext = path.join(dir, "ext-valid");
      await cp(validRel, ext, { recursive: true });
      await rm(validRel, { recursive: true, force: true });
      await symlink(ext, validRel);
      const { diags } = await checkParityFixtures(dir);
      expect(diags.some((d) => d.includes("symlink") || d.includes("path chain"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("duplicate payload_channel_mapping semantic fails cross-bind", async () => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      const pub = reg.payload_channel_mapping.find(
        (r: { semantic: string }) => r.semantic === "topic_publish",
      );
      reg.payload_channel_mapping.push({ ...pub });
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes("duplicate") && d.includes("topic_publish"))).toBe(true);
  });

  test("duplicate assigned opcode name fails cross-bind", async () => {
    const diags = await withParity(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      // Add a second assigned key with the same name ROS_SAMPLE.
      reg.opcodes.assigned["999"] = {
        ...reg.opcodes.assigned["2"],
        name: "ROS_SAMPLE",
      };
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.some((d) => d.includes("duplicate") && d.includes("ROS_SAMPLE"))).toBe(true);
  });
});
describe("protocol-fixtures aggregate", () => {
  test("AGGREGATE_CORPUS_ORDER fixed", () => {
    expect([...AGGREGATE_CORPUS_ORDER]).toEqual([
      "valid_boundary",
      "malformed",
      "sequences",
      "parity",
    ]);
  });

  test("injected runners prove exact-once write order", async () => {
    const order: string[] = [];
    const runners: CorpusRunner[] = AGGREGATE_CORPUS_ORDER.map((name) => ({
      name,
      write: async () => {
        order.push(`write:${name}`);
        return { ok: true, diagnostics: [], counts: { n: 1 } };
      },
      check: async () => {
        order.push(`check:${name}`);
        return { ok: true, diagnostics: [], counts: { n: 1 } };
      },
    }));
    const w = await runAggregateWrite("/tmp", runners);
    expect(w.ok).toBe(true);
    expect(order).toEqual([
      "write:valid_boundary",
      "write:malformed",
      "write:sequences",
      "write:parity",
    ]);
    order.length = 0;
    const c = await runAggregateCheck("/tmp", runners);
    expect(c.ok).toBe(true);
    expect(order).toEqual([
      "check:valid_boundary",
      "check:malformed",
      "check:sequences",
      "check:parity",
    ]);
    // each corpus exactly once
    for (const name of AGGREGATE_CORPUS_ORDER) {
      expect(order.filter((x) => x === `check:${name}`).length).toBe(1);
    }
  });

  test("default runners include four corpora", () => {
    expect(defaultCorpusRunners().map((r) => r.name)).toEqual([...AGGREGATE_CORPUS_ORDER]);
  });

  test("package test:protocol-fixtures lists four files exactly once", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const script: string = pkg.scripts["test:protocol-fixtures"];
    const files = [
      "scripts/protocol-fixtures.test.ts",
      "scripts/protocol-malformed-fixtures.test.ts",
      "scripts/protocol-sequence-fixtures.test.ts",
      "scripts/protocol-parity-fixtures.test.ts",
    ];
    for (const f of files) {
      const re = new RegExp(f.replace(/\./g, "\\."), "g");
      const matches = script.match(re) ?? [];
      expect(matches.length).toBe(1);
    }
    // order
    let last = -1;
    for (const f of files) {
      const idx = script.indexOf(f);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });
});
