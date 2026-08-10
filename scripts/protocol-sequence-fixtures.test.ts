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
import { readFileSync } from "node:fs";
import { tmpdir } from "os";
import path from "path";
import {
  REQUIRED_COVERAGE,
  PHASE_ONE_ROWS,
  asciiCompare,
  applyEvent,
  buildCorpus,
  buildEventLibrary,
  checkSequenceFixtures,
  diagnoseEventOutcome,
  diagnoseManifestValue,
  diagnoseScenarioValue,
  loadRegistryIndex,
  parseCliMode,
  sha256Hex,
  stableJson,
  writeSequenceFixtures,
  decodeEventBytes,
  ensureRealDirectoryChain,
  findUndeclaredStateKeys,
  expectedDirectionForDecoded,
  SESSION_ID_HEX_PATTERN,
  CHANNEL_ID_MAX,
  CHANNEL_ID_MIN,
  isCanonicalChannelIdKey,
  isChannelId,
  diagnoseCompositionState,
  SEQUENCES_README,
  type Manifest,
  type CompositionState,
  type DecodedEvent,
} from "./protocol-sequence-fixtures.ts";

const ROOT = path.resolve(import.meta.dir, "..");

function registry() {
  return loadRegistryIndex(
    JSON.parse(readFileSync(path.join(ROOT, "protocol/registry/r2wp-v0.json"), "utf8")),
  );
}

async function scaffoldTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "seq-fx-"));
  await mkdir(path.join(dir, "protocol/registry"), { recursive: true });
  await mkdir(path.join(dir, "protocol/testdata"), { recursive: true });
  await cp(
    path.join(ROOT, "protocol/registry/r2wp-v0.json"),
    path.join(dir, "protocol/registry/r2wp-v0.json"),
  );
  await writeFile(path.join(dir, "package.json"), "{}\n");
  return dir;
}

async function withCorpus(
  mut: (dir: string, man: Manifest) => Promise<void>,
): Promise<string[]> {
  const dir = await scaffoldTemp();
  try {
    const man = await writeSequenceFixtures(dir);
    await mut(dir, man);
    return (await checkSequenceFixtures(dir)).diags;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers / unit
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures helpers", () => {
  test.each([
    [["--write"], "write"],
    [["--check"], "check"],
    [[], null],
    [["--check", "extra"], null],
    [["--write", "--check"], null],
    [["extra"], null],
    [["--write", "extra"], null],
  ] as const)("parseCliMode %j → %j", (argv, want) => {
    expect(parseCliMode([...argv])).toBe(want);
  });

  test("phase one rows exact", () => {
    expect(Object.keys(PHASE_ONE_ROWS).sort()).toEqual(["H-CY", "H-FT", "J-CY", "J-FT"]);
  });

  test("findUndeclaredStateKeys rejects _pending_acks", () => {
    const state = {
      processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "g" } },
      sessions: {
        "sess-H-FT": {
          phase: "ready",
          process_id: "proc-H-FT",
          selected_version: 0,
          extension_capabilities: [],
          gateway_instance_id: "g",
          session_id_hex: null,
          support_row: "H-FT",
          entry_path: "fresh",
          pending_resume_claim: null,
          ready: true,
          terminal: false,
          channels: {},
          sequences: {},
          server_wire_versions: [0],
          server_gateway_instance_id: "g",
          server_support_row: "H-FT",
          _pending_acks: [1],
        },
      },
    } as unknown as CompositionState;
    expect(findUndeclaredStateKeys(state).some((k) => k.includes("_pending_acks"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corpus shape / oracle
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures corpus", () => {
  test("sorted ids, required coverage, counts", () => {
    const { manifest, scenarios, events } = buildCorpus(registry());
    expect(manifest.scenarios.map((s) => s.id)).toEqual(
      [...manifest.scenarios.map((s) => s.id)].sort(asciiCompare),
    );
    expect(manifest.events.map((e) => e.id)).toEqual(
      [...manifest.events.map((e) => e.id)].sort(asciiCompare),
    );
    const cov = new Set<string>();
    for (const s of scenarios) for (const c of s.coverage) cov.add(c);
    for (const req of REQUIRED_COVERAGE) expect(cov.has(req)).toBe(true);
    expect(scenarios.length).toBe(13);
    expect(events.length).toBe(26);
  });

  test("every event decodes with matching direction", () => {
    for (const e of buildEventLibrary()) {
      const d = decodeEventBytes(e.kind, e.bytes);
      expect(() => d).not.toThrow();
      const side = expectedDirectionForDecoded(d);
      if (side) expect(e.direction).toBe(side);
    }
  });

  test("key oracle outcomes and registry steps", () => {
    const { scenarios } = buildCorpus(registry());
    const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));
    expect(byId["no-common-version"]!.events[0]!.expected.step).toBe(11);
    expect(byId["no-common-version"]!.events[0]!.expected.registry_code).toBe(2);
    expect(byId["no-common-version"]!.events[0]!.expected.registry_name).toBe("no_common_version");
    const gap = byId["best-effort-sequence-gap"]!.events.at(-1)!;
    expect(gap.expected.disposition_name).toBe("sequence_gap");
    expect(gap.expected.disposition_code).toBe(2);
    expect(gap.expected.step).toBe(26);
    const stale = byId["best-effort-stale-sequence"]!.events.at(-1)!;
    expect(stale.expected.disposition_name).toBe("stale_sequence");
    expect(stale.expected.step).toBe(27);
    expect(stale.state_after.sessions["sess-H-FT"]!.sequences["1:gateway_to_browser"]!.highest_accepted).toBe(2);
    const rel = byId["reliable-sequence-mismatch"]!.events.at(-1)!;
    expect(rel.expected.registry_code).toBe(25);
    expect(rel.expected.registry_name).toBe("protocol_violation");
    expect(rel.expected.step).toBe(25);
    expect(rel.state_after.sessions["sess-H-FT"]!.sequences["1:gateway_to_browser"]!.next_expected).toBe(1);
    const gw = byId["gateway-instance-mismatch"]!.events.at(-1)!;
    expect(gw.expected.registry_code).toBe(18);
    expect(gw.expected.registry_name).toBe("gateway_instance_mismatch");
    expect(gw.expected.plane).toBeNull();
    expect(gw.expected.step).toBeNull();
    expect(gw.state_after.sessions["sess-H-FT"]!.ready).toBe(false);
    const row = byId["support-row-mismatch"]!.events.at(-1)!;
    expect(row.expected.registry_code).toBe(19);
    expect(row.expected.registry_name).toBe("support_row_mismatch");
    expect(row.expected.plane).toBeNull();
    const pre = byId["pre-ready-open-channel"]!.events.at(-1)!;
    expect(pre.expected.registry_code).toBe(27);
    expect(pre.expected.step).toBe(17);
    const pending = byId["pending-channel-data"]!.events.at(-1)!;
    expect(pending.expected.registry_code).toBe(25);
    expect(pending.expected.step).toBe(19);
    const never = byId["never-opened-channel-data"]!.events.at(-1)!;
    expect(never.expected.registry_code).toBe(7);
    expect(never.expected.step).toBe(20);
    const resumeMid = byId["resume-success"]!.events.find((e) => e.event_id === "evt-session-resume")!;
    const claim = resumeMid.state_after.sessions["sess-H-FT"]!.pending_resume_claim;
    expect(claim).not.toBeNull();
    expect(claim!.gateway_instance_id).toBe("gateway-H-FT");
    expect(claim!.support_row).toBe("H-FT");
    expect(SESSION_ID_HEX_PATTERN.test(claim!.previous_session_id_hex)).toBe(true);
    expect(claim!.previous_session_id_hex.startsWith("42")).toBe(true);
    expect(claim!.channel_acks).toEqual([{ channel_id: 1, acknowledged_sequence: 1 }]);
    expect(
      Object.keys(resumeMid.state_after.sessions["sess-H-FT"]!).includes("_pending_acks"),
    ).toBe(false);
    // process binding stays immutable while claim is pending
    expect(resumeMid.state_after.processes["proc-H-FT"]).toEqual({
      support_row: "H-FT",
      gateway_instance_id: "gateway-H-FT",
    });
    expect(resumeMid.state_after.sessions["sess-H-FT"]!.gateway_instance_id).toBeNull();
    const resumeFinal = byId["resume-success"]!.events.at(-1)!.state_after.sessions["sess-H-FT"]!;
    expect(resumeFinal.ready).toBe(true);
    expect(resumeFinal.session_id_hex).toBe(claim!.previous_session_id_hex);
    expect(resumeFinal.pending_resume_claim).toBeNull();
    expect(resumeFinal.gateway_instance_id).toBe("gateway-H-FT");
    // next_sequence=2 after acknowledged_sequence=1
    expect(resumeFinal.sequences["1:gateway_to_browser"]).toEqual({
      next_expected: 2,
      highest_accepted: 1,
    });
    const cross = byId["cross-row-independent-sessions"]!.events.at(-1)!.state_after;
    for (const r of Object.keys(PHASE_ONE_ROWS)) {
      expect(cross.sessions[`sess-${r}`]!.ready).toBe(true);
      expect(cross.sessions[`sess-${r}`]!.support_row).toBe(r);
      expect(cross.processes[`proc-${r}`]!.support_row).toBe(r);
    }
    expect(Object.keys(cross.sessions).length).toBe(4);
    expect(Object.keys(cross.processes).length).toBe(4);
    const multi = byId["multi-domain-same-row"]!.events.at(-1)!.state_after;
    expect(Object.keys(multi.sessions)).toEqual(["sess-H-FT"]);
    expect(multi.sessions["sess-H-FT"]!.channels["1"]!.domain_id).toBe(0);
    expect(multi.sessions["sess-H-FT"]!.channels["2"]!.domain_id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Closed schema diagnose (table-driven)
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures diagnoseManifestValue", () => {
  test.each([
    [null, "null"],
    [[], "object"],
    ["x", "object"],
    [42, "object"],
    [{}, "missing"],
  ])("root %p rejected (%s)", (value, needle) => {
    const d = diagnoseManifestValue(value);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.toLowerCase().includes(needle))).toBe(true);
  });

  test("unknown top-level key rejected", () => {
    const m = buildCorpus(registry()).manifest as unknown as Record<string, unknown>;
    m.extra = true;
    expect(diagnoseManifestValue(m).some((d) => d.includes("unknown key"))).toBe(true);
  });

  test.each([
    ["schema_version", 99, "schema_version"],
    ["protocol", "other", "protocol"],
    ["byte_order", "host", "byte_order"],
    ["generated_by", "evil", "generated_by"],
  ])("scalar %s drift rejected", (key, val, needle) => {
    const m = structuredClone(buildCorpus(registry()).manifest) as Record<string, unknown>;
    m[key] = val;
    expect(diagnoseManifestValue(m).some((d) => d.includes(needle))).toBe(true);
  });

  test("duplicate scenario id rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.scenarios.push({ ...m.scenarios[0]! });
    expect(diagnoseManifestValue(m).some((d) => d.includes("duplicate id"))).toBe(true);
  });

  test("unsorted scenario ids rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    if (m.scenarios.length >= 2) {
      const tmp = m.scenarios[0]!;
      m.scenarios[0] = m.scenarios[m.scenarios.length - 1]!;
      m.scenarios[m.scenarios.length - 1] = tmp;
      expect(diagnoseManifestValue(m).some((d) => d.includes("not sorted"))).toBe(true);
    }
  });

  test("bad event kind/direction/carrier rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.events[0]!.kind = "frame";
    expect(diagnoseManifestValue(m).some((d) => d.includes("bad kind"))).toBe(true);
    const m2 = structuredClone(buildCorpus(registry()).manifest);
    m2.events[0]!.direction = "sideways";
    expect(diagnoseManifestValue(m2).some((d) => d.includes("bad direction"))).toBe(true);
    const m3 = structuredClone(buildCorpus(registry()).manifest);
    m3.events[0]!.carrier = "json";
    expect(diagnoseManifestValue(m3).some((d) => d.includes("bad carrier"))).toBe(true);
  });

  test("kind/carrier pairing rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    const ev = m.events.find((e) => e.kind === "bootstrap")!;
    ev.carrier = "control_cbor";
    expect(diagnoseManifestValue(m).some((d) => d.includes("kind/carrier"))).toBe(true);
  });

  test("non-canonical path rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.events[0]!.path = `events/../${m.events[0]!.id}.bin`;
    expect(diagnoseManifestValue(m).some((d) => d.includes("bad path"))).toBe(true);
  });

  test("unresolved scenario event_id rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.scenarios[0]!.event_ids = ["evt-does-not-exist"];
    expect(diagnoseManifestValue(m).some((d) => d.includes("unresolved"))).toBe(true);
  });

  test("duplicate coverage rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.scenarios[0]!.coverage = ["a", "a"];
    expect(diagnoseManifestValue(m).some((d) => d.includes("duplicate coverage"))).toBe(true);
  });
});

describe("protocol-sequence-fixtures diagnoseScenarioValue", () => {
  test.each([
    [null, "null"],
    [[], "array"],
    ["x", "object"],
  ])("root %p rejected", (value, needle) => {
    const d = diagnoseScenarioValue(value, "x");
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.toLowerCase().includes(needle))).toBe(true);
  });

  test("unknown top-level key rejected", () => {
    const d = diagnoseScenarioValue(
      { id: "x", coverage: [], initial: { processes: {}, sessions: {} }, events: [], extra: 1 },
      "x",
    );
    expect(d.some((x) => x.includes("unknown key"))).toBe(true);
  });

  test("missing keys rejected", () => {
    const d = diagnoseScenarioValue({ id: "x" }, "x");
    expect(d.some((x) => x.includes("missing"))).toBe(true);
  });

  test("id mismatch rejected", () => {
    const d = diagnoseScenarioValue(
      { id: "y", coverage: [], initial: { processes: {}, sessions: {} }, events: [] },
      "x",
    );
    expect(d.some((x) => x.includes("id mismatch"))).toBe(true);
  });

  test("undeclared _pending_acks in state_after rejected", () => {
    const d = diagnoseScenarioValue(
      {
        id: "x",
        coverage: [],
        initial: { processes: {}, sessions: {} },
        events: [
          {
            event_id: "evt-a",
            session_id: "s",
            expected: {
              status: "success",
              registry_code: null,
              registry_name: null,
              disposition_code: null,
              disposition_name: null,
              plane: null,
              step: null,
              reason: null,
            },
            state_after: {
              processes: {},
              sessions: {
                s: {
                  phase: "ready",
                  process_id: "p",
                  selected_version: 0,
                  extension_capabilities: [],
                  gateway_instance_id: null,
                  session_id_hex: null,
                  support_row: null,
                  entry_path: null,
                  pending_resume_claim: null,
                  ready: true,
                  terminal: false,
                  channels: {},
                  sequences: {},
                  server_wire_versions: [0],
                  server_gateway_instance_id: "g",
                  server_support_row: "H-FT",
                  _pending_acks: [],
                },
              },
            },
          },
        ],
      },
      "x",
    );
    expect(d.some((x) => x.includes("_pending_acks"))).toBe(true);
  });

  test("bad expected status rejected", () => {
    const d = diagnoseScenarioValue(
      {
        id: "x",
        coverage: [],
        initial: { processes: {}, sessions: {} },
        events: [
          {
            event_id: "evt-a",
            session_id: "s",
            expected: { status: "maybe" },
            state_after: { processes: {}, sessions: {} },
          },
        ],
      },
      "x",
    );
    expect(d.some((x) => x.includes("bad status"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Repository committed corpus
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures repository", () => {
  test("committed check read-only and green", async () => {
    const before = await readFile(path.join(ROOT, "protocol/testdata/sequences/manifest.json"), "utf8");
    const beforeScen = await readdir(path.join(ROOT, "protocol/testdata/sequences/scenarios"));
    const beforeEvt = await readdir(path.join(ROOT, "protocol/testdata/sequences/events"));
    expect((await checkSequenceFixtures(ROOT)).diags).toEqual([]);
    const after = await readFile(path.join(ROOT, "protocol/testdata/sequences/manifest.json"), "utf8");
    expect(after).toBe(before);
    expect(await readdir(path.join(ROOT, "protocol/testdata/sequences/scenarios"))).toEqual(beforeScen);
    expect(await readdir(path.join(ROOT, "protocol/testdata/sequences/events"))).toEqual(beforeEvt);
  });
});

// ---------------------------------------------------------------------------
// Temp adversarial matrix
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures temp adversarial", () => {
  test("two-write byte identity", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      const snap = async () => {
        const files: Record<string, Buffer> = {};
        async function walk(rel: string) {
          for (const ent of await readdir(path.join(dir, rel), { withFileTypes: true })) {
            const r = path.join(rel, ent.name);
            if (ent.isDirectory()) await walk(r);
            else files[r] = await readFile(path.join(dir, r));
          }
        }
        await walk("protocol/testdata/sequences");
        return files;
      };
      const a = await snap();
      await writeSequenceFixtures(dir);
      const b = await snap();
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const k of Object.keys(a)) expect(Buffer.compare(a[k]!, b[k]!)).toBe(0);
      expect((await checkSequenceFixtures(dir)).diags).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("write prunes stale extra files", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      await writeFile(path.join(dir, "protocol/testdata/sequences/events/stale.bin"), new Uint8Array([1]));
      await writeFile(
        path.join(dir, "protocol/testdata/sequences/scenarios/stale.json"),
        "{}\n",
      );
      await writeSequenceFixtures(dir);
      const evts = await readdir(path.join(dir, "protocol/testdata/sequences/events"));
      const scens = await readdir(path.join(dir, "protocol/testdata/sequences/scenarios"));
      expect(evts.includes("stale.bin")).toBe(false);
      expect(scens.includes("stale.json")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("disk state_after tamper caught without buildScenarios", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/fresh-open-success.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      scen.events[0].state_after.sessions["sess-H-FT"].phase = "ready";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("state_after mismatch") || d.includes("fresh-open-success"))).toBe(
      true,
    );
  });

  test("disk expected outcome tamper caught", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/no-common-version.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      scen.events[0].expected.registry_code = 99;
      scen.events[0].expected.registry_name = "fake";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "no-common-version")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("outcome mismatch") || d.includes("registry"))).toBe(true);
  });

  test.each([
    ["extra newline", async (man: string) => {
      await writeFile(man, (await readFile(man, "utf8")) + "\n");
    }],
    ["minified", async (man: string) => {
      await writeFile(man, JSON.stringify(JSON.parse(await readFile(man, "utf8"))));
    }],
    ["leading space", async (man: string) => {
      await writeFile(man, " " + (await readFile(man, "utf8")));
    }],
  ])("manifest %s fails canonical raw text", async (_label, mut) => {
    const diags = await withCorpus(async (dir) => {
      await mut(path.join(dir, "protocol/testdata/sequences/manifest.json"));
    });
    expect(diags.some((d) => d.includes("canonical") || d.includes("raw text"))).toBe(true);
  });

  test("scenario canonical whitespace drift", async () => {
    const diags = await withCorpus(async (dir) => {
      const p = path.join(dir, "protocol/testdata/sequences/scenarios/fresh-open-success.json");
      const obj = JSON.parse(await readFile(p, "utf8"));
      await writeFile(p, JSON.stringify(obj)); // minified
      // keep hash matching minified so we pass hash and hit canonical gate
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = JSON.stringify(obj);
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      // also break manifest canonicality if we re-stableJson; write minified body only
      // re-write man with stableJson so only scenario is non-canonical
      await writeFile(manPath, stableJson(man));
      await writeFile(p, body);
    });
    expect(diags.some((d) => d.includes("canonical") || d.includes("raw text"))).toBe(true);
  });

  test("event byte drift", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const ev = m.events[0]!;
      const abs = path.join(dir, "protocol/testdata/sequences", ev.path);
      const b = new Uint8Array(await readFile(abs));
      b[0] = (b[0]! + 1) & 0xff;
      await writeFile(abs, b);
    });
    expect(diags.some((d) => d.includes("sha256") || d.includes("bytes") || d.includes("decode"))).toBe(
      true,
    );
  });

  test("event length drift in manifest", async () => {
    const diags = await withCorpus(async (dir) => {
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      man.events[0]!.byte_length = man.events[0]!.byte_length + 1;
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("length") || d.includes("byte"))).toBe(true);
  });

  test("missing/extra event and scenario files", async () => {
    const dir = await scaffoldTemp();
    try {
      const m = await writeSequenceFixtures(dir);
      const ev = m.events[0]!;
      await rm(path.join(dir, "protocol/testdata/sequences", ev.path));
      let diags = (await checkSequenceFixtures(dir)).diags;
      expect(diags.some((d) => d.includes("missing") || d.includes(ev.id))).toBe(true);
      await writeSequenceFixtures(dir);
      await writeFile(path.join(dir, "protocol/testdata/sequences/events/extra.bin"), new Uint8Array([1]));
      diags = (await checkSequenceFixtures(dir)).diags;
      expect(diags.some((d) => d.includes("extra"))).toBe(true);
      await writeSequenceFixtures(dir);
      await writeFile(
        path.join(dir, "protocol/testdata/sequences/scenarios/extra.json"),
        "{}\n",
      );
      diags = (await checkSequenceFixtures(dir)).diags;
      expect(diags.some((d) => d.includes("extra"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("check creates nothing when sequences missing", async () => {
    const dir = await scaffoldTemp();
    try {
      const before = await readdir(path.join(dir, "protocol/testdata"));
      const { diags } = await checkSequenceFixtures(dir);
      expect(diags.length).toBeGreaterThan(0);
      expect(await readdir(path.join(dir, "protocol/testdata"))).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("symlink sequences dir write rejected", async () => {
    const dir = await scaffoldTemp();
    try {
      await ensureRealDirectoryChain(dir, ["protocol", "testdata"], true);
      const ext = path.join(dir, "ext-seq");
      await mkdir(ext);
      await symlink(ext, path.join(dir, "protocol/testdata/sequences"));
      await expect(writeSequenceFixtures(dir)).rejects.toThrow(/symlink/i);
      expect((await readdir(ext)).length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("event symlink rejected on check", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const ev = m.events[0]!;
      const abs = path.join(dir, "protocol/testdata/sequences", ev.path);
      const ext = path.join(dir, "ext.bin");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.some((d) => d.includes("symlink") || d.includes("artifact"))).toBe(true);
  });

  test("scenario symlink rejected on check", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const sc = m.scenarios[0]!;
      const abs = path.join(dir, "protocol/testdata/sequences", sc.path);
      const ext = path.join(dir, "ext.json");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.some((d) => d.includes("symlink") || d.includes("scenario"))).toBe(true);
  });

  test("manifest symlink rejected on check", async () => {
    const diags = await withCorpus(async (dir) => {
      const abs = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const ext = path.join(dir, "ext-manifest.json");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.some((d) => d.includes("symlink") || d.includes("manifest"))).toBe(true);
  });

  test("registry symlink rejected on check", async () => {
    const diags = await withCorpus(async (dir) => {
      const abs = path.join(dir, "protocol/registry/r2wp-v0.json");
      const ext = path.join(dir, "ext-reg.json");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("malformed scenario JSON", async () => {
    const diags = await withCorpus(async (dir) => {
      const p = path.join(dir, "protocol/testdata/sequences/scenarios/fresh-open-success.json");
      await writeFile(p, "{not-json");
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("malformed manifest JSON", async () => {
    const diags = await withCorpus(async (dir) => {
      await writeFile(path.join(dir, "protocol/testdata/sequences/manifest.json"), "{nope");
    });
    expect(diags.some((d) => d.toLowerCase().includes("malformed") || d.includes("JSON"))).toBe(
      true,
    );
  });

  test("oversized scenario rejected", async () => {
    const diags = await withCorpus(async (dir) => {
      const p = path.join(dir, "protocol/testdata/sequences/scenarios/fresh-open-success.json");
      // 300 KiB > SCENARIO_MAX_BYTES (256 KiB)
      await writeFile(p, "x".repeat(300 * 1024));
    });
    expect(diags.some((d) => d.includes("size") || d.includes("max") || d.includes("exceed"))).toBe(
      true,
    );
  });

  test("registry disposition name drift returns diags (no throw)", async () => {
    const diags = await withCorpus(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      reg.dispositions.assigned["2"] = "not_sequence_gap";
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("registry error name drift", async () => {
    const diags = await withCorpus(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      reg.errors["25"].name = "not_protocol_violation";
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("registry step disposition rebinding drift", async () => {
    const diags = await withCorpus(async (dir) => {
      const regPath = path.join(dir, "protocol/registry/r2wp-v0.json");
      const reg = JSON.parse(await readFile(regPath, "utf8"));
      for (const row of reg.validation_order.selected_frame) {
        if (row.step === 26) row.disposition = "stale_sequence";
      }
      await writeFile(regPath, JSON.stringify(reg));
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("scenario event_id order vs manifest", async () => {
    const diags = await withCorpus(async (dir) => {
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.event_ids = [...entry.event_ids].reverse();
      await writeFile(manPath, stableJson(man));
    });
    expect(
      diags.some(
        (d) =>
          d.includes("event_ids") ||
          d.includes("canonical") ||
          d.includes("writer reference") ||
          d.includes("fresh-open-success"),
      ),
    ).toBe(true);
  });

  test("scenario event order body vs manifest (body reverse)", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/fresh-open-success.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      scen.events = [...scen.events].reverse();
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      // keep manifest event_ids original → order mismatch
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("event_ids") || d.includes("event order"))).toBe(true);
  });

  test("session_id tamper to wrong session", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/fresh-open-success.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      scen.events[0].session_id = "sess-DOES-NOT-EXIST";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("session") || d.includes("unknown") || d.includes("oracle"))).toBe(
      true,
    );
  });

  test("initial process binding tamper causes resume mismatch projection fail", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/gateway-instance-mismatch.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      // Make process already match the wrong claim → reject code 18 no longer expected
      scen.initial.processes["proc-H-FT"].gateway_instance_id = "gateway-OTHER";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "gateway-instance-mismatch")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("outcome") || d.includes("state_after") || d.includes("mismatch"))).toBe(
      true,
    );
  });

  test("cross-session leakage: wrong session_id in multi-row", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/cross-row-independent-sessions.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      // Point an H-FT ready event at J-FT session
      const idx = scen.events.findIndex(
        (e: { event_id: string }) => e.event_id === "evt-session-ready-h-ft",
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      scen.events[idx].session_id = "sess-J-FT";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "cross-row-independent-sessions")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("outcome") || d.includes("state_after") || d.includes("mismatch"))).toBe(
      true,
    );
  });

  test("unused event index fails closure", async () => {
    const diags = await withCorpus(async (dir) => {
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      // Drop all scenario references to first event id without removing the event entry
      const drop = man.events[0]!.id;
      for (const s of man.scenarios) {
        s.event_ids = s.event_ids.filter((id) => id !== drop);
      }
      // Also strip from scenario bodies so event order still matches
      for (const s of man.scenarios) {
        const p = path.join(dir, "protocol/testdata/sequences", s.path);
        const body = JSON.parse(await readFile(p, "utf8"));
        body.events = body.events.filter((e: { event_id: string }) => e.event_id !== drop);
        body.coverage = body.coverage; // leave
        const text = stableJson(body);
        await writeFile(p, text);
        s.byte_length = new TextEncoder().encode(text).length;
        s.sha256 = sha256Hex(new TextEncoder().encode(text));
        s.event_ids = body.events.map((e: { event_id: string }) => e.event_id);
      }
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.some((d) => d.includes("unused") || d.includes("writer reference"))).toBe(true);
  });

  test("nonregular event file rejected", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const ev = m.events[0]!;
      const abs = path.join(dir, "protocol/testdata/sequences", ev.path);
      await rm(abs);
      await mkdir(abs);
    });
    expect(
      diags.some(
        (d) =>
          d.includes("regular") ||
          d.includes("not a") ||
          d.includes("directory") ||
          d.includes("event"),
      ),
    ).toBe(true);
  });

  test("parent directory symlink rejected on check", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      // Replace protocol/testdata with a symlink
      const real = path.join(dir, "protocol/testdata-real");
      await cp(path.join(dir, "protocol/testdata"), real, { recursive: true });
      await rm(path.join(dir, "protocol/testdata"), { recursive: true });
      await symlink(real, path.join(dir, "protocol/testdata"));
      const { diags } = await checkSequenceFixtures(dir);
      expect(diags.some((d) => d.includes("symlink") || d.includes("path chain"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("write rejects symlinked parent of sequences", async () => {
    const dir = await scaffoldTemp();
    try {
      // scaffoldTemp already created protocol/testdata; replace with a symlink.
      await rm(path.join(dir, "protocol/testdata"), { recursive: true, force: true });
      const ext = path.join(dir, "ext-testdata");
      await mkdir(ext);
      await symlink(ext, path.join(dir, "protocol/testdata"));
      await expect(writeSequenceFixtures(dir)).rejects.toThrow(/symlink/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["events/ignored.txt", "file"],
    ["events/extensionless", "file"],
    ["scenarios/ignored-dir", "dir"],
    ["events/extra-link", "symlink"],
  ] as const)("disk closure rejects %s (%s)", async (rel, kind) => {
    const diags = await withCorpus(async (dir) => {
      const abs = path.join(dir, "protocol/testdata/sequences", rel);
      if (kind === "dir") await mkdir(abs);
      else if (kind === "symlink") {
        const ext = path.join(dir, "ext-extra");
        await writeFile(ext, "x");
        await symlink(ext, abs);
      } else {
        await writeFile(abs, "x");
      }
    });
    expect(diags.some((d) => d.includes("extra") || d.includes("ignored") || d.includes("extensionless") || d.includes("extra-link"))).toBe(
      true,
    );
  });

  test("write prunes .txt and extensionless stale files", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      await writeFile(path.join(dir, "protocol/testdata/sequences/events/ignored.txt"), "x");
      await writeFile(path.join(dir, "protocol/testdata/sequences/events/orphan"), "y");
      await writeSequenceFixtures(dir);
      const names = await readdir(path.join(dir, "protocol/testdata/sequences/events"));
      expect(names.includes("ignored.txt")).toBe(false);
      expect(names.includes("orphan")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("write rejects stale directory entry", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      await mkdir(path.join(dir, "protocol/testdata/sequences/events/bad-dir"));
      await expect(writeSequenceFixtures(dir)).rejects.toThrow(/unsafe directory|directory entry/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Round-2: recursive schema (A), oracle (C/E/H), outcomes (F), carrier (G)
// ---------------------------------------------------------------------------

function baseInitial(): CompositionState {
  return {
    processes: {
      "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "gateway-H-FT" },
    },
    sessions: {
      "sess-H-FT": {
        phase: "awaiting_client_hello",
        process_id: "proc-H-FT",
        selected_version: null,
        extension_capabilities: [],
        gateway_instance_id: null,
        session_id_hex: null,
        support_row: null,
        entry_path: null,
        pending_resume_claim: null,
        ready: false,
        terminal: false,
        channels: {},
        sequences: {},
        server_wire_versions: [0],
        server_gateway_instance_id: "gateway-H-FT",
        server_support_row: "H-FT",
      },
    },
  };
}

function byId(id: string) {
  return buildEventLibrary().find((e) => e.id === id)!;
}

describe("protocol-sequence-fixtures recursive schema A", () => {
  test("invalid process/channel fields produce diags", () => {
    const d = diagnoseScenarioValue(
      {
        id: "fresh-open-success",
        coverage: ["a"],
        initial: {
          processes: { "proc-H-FT": { support_row: "INVALID", gateway_instance_id: 7 } },
          sessions: {
            "sess-H-FT": {
              phase: "ready",
              process_id: "proc-H-FT",
              selected_version: 0,
              extension_capabilities: [],
              gateway_instance_id: null,
              session_id_hex: null,
              support_row: null,
              entry_path: null,
              pending_resume_claim: null,
              ready: true,
              terminal: false,
              channels: {
                "1": {
                  phase: "bogus",
                  domain_id: -1,
                  operation_kind: "x",
                  data_direction: "y",
                  reliability: "z",
                  extra: 1,
                },
              },
              sequences: {},
              server_wire_versions: [0],
              server_gateway_instance_id: "g",
              server_support_row: "H-FT",
            },
          },
        },
        events: [],
      },
      "fresh-open-success",
    );
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.includes("support_row"))).toBe(true);
    expect(d.some((x) => x.includes("gateway_instance_id"))).toBe(true);
    expect(d.some((x) => x.includes("unknown key") || x.includes("extra"))).toBe(true);
    expect(d.some((x) => x.includes("phase") || x.includes("domain"))).toBe(true);
  });

  test("success outcome with error fields rejected", () => {
    const d = diagnoseEventOutcome(
      {
        status: "success",
        registry_code: 25,
        registry_name: "protocol_violation",
        disposition_code: null,
        disposition_name: null,
        plane: "selected_frame",
        step: null,
        reason: null,
      },
      "o",
    );
    expect(d.some((x) => x.includes("success requires"))).toBe(true);
  });

  test("error outcome partial plane/step rejected", () => {
    const d = diagnoseEventOutcome(
      {
        status: "error",
        registry_code: 25,
        registry_name: "protocol_violation",
        disposition_code: null,
        disposition_name: null,
        plane: "selected_frame",
        step: null,
        reason: "x",
      },
      "o",
    );
    expect(d.some((x) => x.includes("both"))).toBe(true);
  });

  test("disk success outcome tamper caught", async () => {
    const diags = await withCorpus(async (dir) => {
      const scenPath = path.join(
        dir,
        "protocol/testdata/sequences/scenarios/fresh-open-success.json",
      );
      const scen = JSON.parse(await readFile(scenPath, "utf8"));
      scen.events[0].expected.registry_code = 25;
      scen.events[0].expected.registry_name = "protocol_violation";
      scen.events[0].expected.plane = "selected_frame";
      await writeFile(scenPath, stableJson(scen));
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const body = stableJson(scen);
      const entry = man.scenarios.find((s) => s.id === "fresh-open-success")!;
      entry.byte_length = new TextEncoder().encode(body).length;
      entry.sha256 = sha256Hex(new TextEncoder().encode(body));
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.length).toBeGreaterThan(0);
  });
});

describe("protocol-sequence-fixtures oracle C wrong-order", () => {
  test.each([
    ["Authenticate on fresh initial", "evt-authenticate", "awaiting_client_hello", 25, null],
    ["SessionReady wrong phase", "evt-session-ready-h-ft", "awaiting_client_hello", 25, null],
    ["SessionResume wrong phase", "evt-session-resume", "awaiting_client_hello", 25, null],
    ["SessionResumeResult wrong phase", "evt-resume-result-accept", "awaiting_client_hello", 25, null],
  ] as const)("%s → code %s plane null", (_label, eventId, phase, code, plane) => {
    const state = baseInitial();
    state.sessions["sess-H-FT"]!.phase = phase;
    const ev = byId(eventId);
    const decoded = decodeEventBytes(ev.kind, ev.bytes);
    const { outcome } = applyEvent(state, "sess-H-FT", decoded, registry());
    expect(outcome.status).toBe("error");
    expect(outcome.registry_code).toBe(code);
    expect(outcome.registry_name).toBe("protocol_violation");
    expect(outcome.plane).toBe(plane);
    expect(outcome.step).toBeNull();
  });

  test("repeated Authenticate entry is semantic violation", () => {
    const state = baseInitial();
    state.sessions["sess-H-FT"]!.phase = "awaiting_entry";
    state.sessions["sess-H-FT"]!.entry_path = "fresh";
    const decoded = decodeEventBytes("control", byId("evt-authenticate").bytes);
    const { outcome } = applyEvent(state, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(25);
    expect(outcome.plane).toBeNull();
    expect(outcome.reason).toBe("repeated_entry");
  });

  test("terminal session rejects further events without throw", () => {
    const state = baseInitial();
    state.sessions["sess-H-FT"]!.phase = "closed";
    state.sessions["sess-H-FT"]!.terminal = true;
    const decoded = decodeEventBytes("control", byId("evt-authenticate").bytes);
    const { outcome } = applyEvent(state, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(25);
    expect(outcome.reason).toBe("terminal_session");
    expect(outcome.plane).toBeNull();
  });

  test("pre-ready OpenChannel uses step 17 / code 27", () => {
    const state = baseInitial();
    state.sessions["sess-H-FT"]!.phase = "awaiting_entry";
    const decoded = decodeEventBytes("control", byId("evt-open-channel-pre-ready").bytes);
    const { outcome } = applyEvent(state, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(27);
    expect(outcome.registry_name).toBe("session_not_ready");
    expect(outcome.plane).toBe("selected_frame");
    expect(outcome.step).toBe(17);
  });
});

describe("protocol-sequence-fixtures phase-one wire E", () => {
  test("SessionReady wrong distro rejected", () => {
    const state = baseInitial();
    // advance to awaiting_entry_response / fresh
    let s = state;
    for (const id of ["evt-client-hello-v0", "evt-server-hello-v0", "evt-authenticate"]) {
      const r = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry());
      s = r.state;
    }
    // mutate SessionReady: wrong distro
    const ready = byId("evt-session-ready-h-ft");
    const decoded = decodeEventBytes(ready.kind, ready.bytes) as Extract<DecodedEvent, { kind: "control" }>;
    decoded.control.set(18, "jazzy"); // H-FT should be humble
    const { outcome, state: after } = applyEvent(s, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(19);
    expect(after.sessions["sess-H-FT"]!.ready).toBe(false);
  });

  test("SessionReady wrong RMW rejected", () => {
    const state = baseInitial();
    let s = state;
    for (const id of ["evt-client-hello-v0", "evt-server-hello-v0", "evt-authenticate"]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    const decoded = decodeEventBytes("control", byId("evt-session-ready-h-ft").bytes) as Extract<
      DecodedEvent,
      { kind: "control" }
    >;
    decoded.control.set(19, "rmw_cyclonedds_cpp");
    const { outcome } = applyEvent(s, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(19);
    expect(outcome.reason).toBe("session_ready_profile_mismatch");
  });

  test("ChannelReady wrong domain rejected", () => {
    let s = baseInitial();
    for (const id of [
      "evt-client-hello-v0",
      "evt-server-hello-v0",
      "evt-authenticate",
      "evt-session-ready-h-ft",
      "evt-open-channel-d0",
    ]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    const decoded = decodeEventBytes("control", byId("evt-channel-ready-ch1-best-effort").bytes) as Extract<
      DecodedEvent,
      { kind: "control" }
    >;
    decoded.control.set(9, 99); // pending channel domain is 0
    const { outcome } = applyEvent(s, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(25);
    expect(outcome.reason).toBe("channel_ready_domain_mismatch");
  });

  test("ChannelReady wrong row rejected", () => {
    let s = baseInitial();
    for (const id of [
      "evt-client-hello-v0",
      "evt-server-hello-v0",
      "evt-authenticate",
      "evt-session-ready-h-ft",
      "evt-open-channel-d0",
    ]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    const decoded = decodeEventBytes("control", byId("evt-channel-ready-ch1-best-effort").bytes) as Extract<
      DecodedEvent,
      { kind: "control" }
    >;
    decoded.control.set(8, "H-CY");
    const { outcome } = applyEvent(s, "sess-H-FT", decoded, registry());
    expect(outcome.registry_code).toBe(19);
  });
});

describe("protocol-sequence-fixtures sequence H + flag step 23", () => {
  function readyBestEffort(): CompositionState {
    let s = baseInitial();
    for (const id of [
      "evt-client-hello-v0",
      "evt-server-hello-v0",
      "evt-authenticate",
      "evt-session-ready-h-ft",
      "evt-open-channel-d0",
      "evt-channel-ready-ch1-best-effort",
    ]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    return s;
  }

  function readyReliable(): CompositionState {
    let s = baseInitial();
    for (const id of [
      "evt-client-hello-v0",
      "evt-server-hello-v0",
      "evt-authenticate",
      "evt-session-ready-h-ft",
      "evt-open-channel-d0",
      "evt-channel-ready-ch1-reliable",
    ]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    return s;
  }

  test("first best-effort sample > 0 is sequence_gap", () => {
    const s = readyBestEffort();
    // be-seq-2 as first sample
    const { outcome, state } = applyEvent(
      s,
      "sess-H-FT",
      decodeEventBytes("application", byId("evt-ros-sample-be-seq-2").bytes),
      registry(),
    );
    expect(outcome.status).toBe("disposition");
    expect(outcome.disposition_name).toBe("sequence_gap");
    expect(outcome.step).toBe(26);
    const dom = state.sessions["sess-H-FT"]!.sequences["1:gateway_to_browser"]!;
    expect(dom.highest_accepted).toBe(2);
    expect(dom.next_expected).toBe(3);
  });

  test("best-effort flag set on BE channel is step 23 unsupported_flags", () => {
    const s = readyBestEffort();
    // reliable sample on best-effort channel
    const { outcome } = applyEvent(
      s,
      "sess-H-FT",
      decodeEventBytes("application", byId("evt-ros-sample-rel-seq-0").bytes),
      registry(),
    );
    expect(outcome.registry_code).toBe(6);
    expect(outcome.registry_name).toBe("unsupported_flags");
    expect(outcome.step).toBe(23);
  });

  test("reliable flag clear on reliable channel is step 23", () => {
    const s = readyReliable();
    const { outcome } = applyEvent(
      s,
      "sess-H-FT",
      decodeEventBytes("application", byId("evt-ros-sample-be-seq-0").bytes),
      registry(),
    );
    expect(outcome.registry_code).toBe(6);
    expect(outcome.step).toBe(23);
  });

  test("contiguous BE accept advances next_expected", () => {
    const s = readyBestEffort();
    const { state } = applyEvent(
      s,
      "sess-H-FT",
      decodeEventBytes("application", byId("evt-ros-sample-be-seq-0").bytes),
      registry(),
    );
    const dom = state.sessions["sess-H-FT"]!.sequences["1:gateway_to_browser"]!;
    expect(dom.highest_accepted).toBe(0);
    expect(dom.next_expected).toBe(1);
  });
});

describe("protocol-sequence-fixtures carrier G + bounds", () => {
  test("oversized event byte_length in manifest rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.events[0]!.byte_length = 0;
    expect(diagnoseManifestValue(m).some((d) => d.includes("byte_length"))).toBe(true);
  });

  test("empty scenarios array rejected", () => {
    const m = structuredClone(buildCorpus(registry()).manifest);
    m.scenarios = [];
    expect(diagnoseManifestValue(m).some((d) => d.includes("positive") || d.includes("scenarios"))).toBe(
      true,
    );
  });

  test("carrier ros_sample with control frame fails check", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const ev = m.events.find((e) => e.carrier === "ros_sample")!;
      // overwrite event bytes with a control frame
      const abs = path.join(dir, "protocol/testdata/sequences", ev.path);
      await writeFile(abs, byId("evt-authenticate").bytes);
      // fix hash/length so we pass hash gate and hit carrier check
      const manPath = path.join(dir, "protocol/testdata/sequences/manifest.json");
      const man = JSON.parse(await readFile(manPath, "utf8")) as Manifest;
      const entry = man.events.find((e) => e.id === ev.id)!;
      const bytes = byId("evt-authenticate").bytes;
      entry.byte_length = bytes.length;
      entry.sha256 = sha256Hex(bytes);
      // keep carrier ros_sample, kind application → decode as application will fail or kind mismatch
      await writeFile(manPath, stableJson(man));
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  test("oversized event file rejected by bounded read", async () => {
    const diags = await withCorpus(async (dir, m) => {
      const ev = m.events[0]!;
      const abs = path.join(dir, "protocol/testdata/sequences", ev.path);
      await writeFile(abs, new Uint8Array(70 * 1024));
    });
    expect(diags.some((d) => d.includes("size") || d.includes("max") || d.includes("exceed"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Round-3: channel range, sequence linkage, ID lifetime, root closure, acks
// ---------------------------------------------------------------------------

describe("protocol-sequence-fixtures channel id range", () => {
  test.each([
    [1, true],
    [65536, true],
    [4294967295, true],
    [0, false],
    [4294967296, false],
  ] as const)("isChannelId(%s) → %s", (n, want) => {
    expect(isChannelId(n)).toBe(want);
  });

  test.each([
    ["1", true],
    ["65536", true],
    ["4294967295", true],
    ["0", false],
    ["01", false],
    ["4294967296", false],
    ["-1", false],
  ] as const)("isCanonicalChannelIdKey(%j) → %s", (k, want) => {
    expect(isCanonicalChannelIdKey(k)).toBe(want);
  });

  test("CHANNEL_ID_MAX is 0xffffffff", () => {
    expect(CHANNEL_ID_MIN).toBe(1);
    expect(CHANNEL_ID_MAX).toBe(0xffffffff);
  });
});

describe("protocol-sequence-fixtures sequence projection linkage", () => {
  function sessWith(
    channels: Record<string, unknown>,
    sequences: Record<string, unknown>,
  ): CompositionState {
    return {
      processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "gateway-H-FT" } },
      sessions: {
        "sess-H-FT": {
          phase: "ready",
          process_id: "proc-H-FT",
          selected_version: 0,
          extension_capabilities: [],
          gateway_instance_id: "gateway-H-FT",
          session_id_hex: "a".repeat(64),
          support_row: "H-FT",
          entry_path: "fresh",
          pending_resume_claim: null,
          ready: true,
          terminal: false,
          channels: channels as never,
          sequences: sequences as never,
          server_wire_versions: [0],
          server_gateway_instance_id: "gateway-H-FT",
          server_support_row: "H-FT",
        },
      },
    };
  }

  test("next_expected=99 with highest_accepted=0 diagnoses", () => {
    const d = diagnoseCompositionState(
      sessWith(
        {
          "1": {
            phase: "active",
            domain_id: 0,
            operation_kind: "subscribe",
            data_direction: "gateway_to_browser",
            reliability: "best_effort",
          },
        },
        { "1:gateway_to_browser": { next_expected: 99, highest_accepted: 0 } },
      ),
      "s",
    );
    expect(d.some((x) => x.includes("next_expected must equal highest_accepted+1"))).toBe(true);
  });

  test("sequence key for missing channel diagnoses", () => {
    const d = diagnoseCompositionState(
      sessWith(
        {
          "1": {
            phase: "active",
            domain_id: 0,
            operation_kind: "subscribe",
            data_direction: "gateway_to_browser",
            reliability: "best_effort",
          },
        },
        { "2:gateway_to_browser": { next_expected: 0, highest_accepted: -1 } },
      ),
      "s",
    );
    expect(d.some((x) => x.includes("missing channel") || x.includes("channel 2"))).toBe(true);
  });

  test("direction mismatch diagnoses", () => {
    const d = diagnoseCompositionState(
      sessWith(
        {
          "1": {
            phase: "active",
            domain_id: 0,
            operation_kind: "subscribe",
            data_direction: "gateway_to_browser",
            reliability: "best_effort",
          },
        },
        { "1:browser_to_gateway": { next_expected: 0, highest_accepted: -1 } },
      ),
      "s",
    );
    expect(d.some((x) => x.includes("direction"))).toBe(true);
  });

  test("alias channel key 01 diagnoses", () => {
    const d = diagnoseCompositionState(
      sessWith(
        {
          "01": {
            phase: "active",
            domain_id: 0,
            operation_kind: "subscribe",
            data_direction: "gateway_to_browser",
            reliability: "best_effort",
          },
        },
        {},
      ),
      "s",
    );
    expect(d.some((x) => x.includes("channel id key") || x.includes("canonical"))).toBe(true);
  });

  test("highest_accepted=-1 requires next_expected=0", () => {
    const d = diagnoseCompositionState(
      sessWith(
        {
          "1": {
            phase: "active",
            domain_id: 0,
            operation_kind: "subscribe",
            data_direction: "gateway_to_browser",
            reliability: "best_effort",
          },
        },
        { "1:gateway_to_browser": { next_expected: 1, highest_accepted: -1 } },
      ),
      "s",
    );
    expect(d.some((x) => x.includes("next_expected must equal"))).toBe(true);
  });
});

describe("protocol-sequence-fixtures channel id lifetime", () => {
  test("repeated OpenChannel on active id is protocol_violation without rewrite", () => {
    const { scenarios } = buildCorpus(registry());
    const final = scenarios.find((s) => s.id === "fresh-open-success")!.events.at(-1)!.state_after;
    const before = structuredClone(final.sessions["sess-H-FT"]!.channels["1"]);
    const decoded = decodeEventBytes("control", byId("evt-open-channel-d0").bytes);
    const { outcome, state } = applyEvent(final, "sess-H-FT", decoded, registry());
    expect(outcome.status).toBe("error");
    expect(outcome.registry_code).toBe(25);
    expect(outcome.registry_name).toBe("protocol_violation");
    expect(outcome.plane).toBeNull();
    expect(outcome.step).toBeNull();
    expect(outcome.reason).toBe("channel_id_reuse");
    // Prior state preserved
    expect(state.sessions["sess-H-FT"]!.channels["1"]).toEqual(before);
    expect(state.sessions["sess-H-FT"]!.channels["1"]!.phase).toBe("active");
  });

  test("repeated OpenChannel on pending id rejected", () => {
    let s = baseInitial();
    for (const id of [
      "evt-client-hello-v0",
      "evt-server-hello-v0",
      "evt-authenticate",
      "evt-session-ready-h-ft",
      "evt-open-channel-d0",
    ]) {
      s = applyEvent(s, "sess-H-FT", decodeEventBytes(byId(id).kind, byId(id).bytes), registry()).state;
    }
    expect(s.sessions["sess-H-FT"]!.channels["1"]!.phase).toBe("pending");
    const { outcome, state } = applyEvent(
      s,
      "sess-H-FT",
      decodeEventBytes("control", byId("evt-open-channel-d0").bytes),
      registry(),
    );
    expect(outcome.reason).toBe("channel_id_reuse");
    expect(state.sessions["sess-H-FT"]!.channels["1"]!.phase).toBe("pending");
  });
});

describe("protocol-sequence-fixtures sequences root closure", () => {
  test("extra ignored.txt at sequences root fails check", async () => {
    const diags = await withCorpus(async (dir) => {
      await writeFile(path.join(dir, "protocol/testdata/sequences/ignored.txt"), "x");
    });
    expect(diags.some((d) => d.includes("extra") && d.includes("ignored.txt"))).toBe(true);
  });

  test("missing README fails check", async () => {
    const diags = await withCorpus(async (dir) => {
      await rm(path.join(dir, "protocol/testdata/sequences/README.md"));
    });
    expect(diags.some((d) => d.includes("README") || d.includes("missing"))).toBe(true);
  });

  test("README symlink fails check", async () => {
    const diags = await withCorpus(async (dir) => {
      const abs = path.join(dir, "protocol/testdata/sequences/README.md");
      const ext = path.join(dir, "ext-readme.md");
      await writeFile(ext, await readFile(abs));
      await rm(abs);
      await symlink(ext, abs);
    });
    expect(diags.some((d) => d.includes("README") && d.includes("symlink"))).toBe(true);
  });

  test("README content is canonical SEQUENCES_README", async () => {
    const text = await readFile(path.join(ROOT, "protocol/testdata/sequences/README.md"), "utf8");
    expect(text).toBe(SEQUENCES_README);
  });

  test("write rewrites README to canonical content", async () => {
    const dir = await scaffoldTemp();
    try {
      await writeSequenceFixtures(dir);
      const p = path.join(dir, "protocol/testdata/sequences/README.md");
      await writeFile(p, "stale\n");
      await writeSequenceFixtures(dir);
      expect(await readFile(p, "utf8")).toBe(SEQUENCES_README);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("protocol-sequence-fixtures resume ack/result + sorted arrays", () => {
  test("resume-success projects next_expected=2 highest_accepted=1", () => {
    const { scenarios } = buildCorpus(registry());
    const final = scenarios.find((s) => s.id === "resume-success")!.events.at(-1)!.state_after
      .sessions["sess-H-FT"]!;
    expect(final.sequences["1:gateway_to_browser"]).toEqual({
      next_expected: 2,
      highest_accepted: 1,
    });
    expect(final.channels["1"]!.reliability).toBe("reliable");
  });

  test("unsorted extension_capabilities diagnoses", () => {
    const d = diagnoseCompositionState(
      {
        processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "g" } },
        sessions: {
          "sess-H-FT": {
            phase: "awaiting_entry",
            process_id: "proc-H-FT",
            selected_version: 0,
            extension_capabilities: [2, 1],
            gateway_instance_id: null,
            session_id_hex: null,
            support_row: null,
            entry_path: null,
            pending_resume_claim: null,
            ready: false,
            terminal: false,
            channels: {},
            sequences: {},
            server_wire_versions: [0],
            server_gateway_instance_id: "g",
            server_support_row: "H-FT",
          },
        },
      },
      "s",
    );
    expect(d.some((x) => x.includes("extension_capabilities") && x.includes("sorted"))).toBe(true);
  });

  test("duplicate server_wire_versions diagnoses", () => {
    const d = diagnoseCompositionState(
      {
        processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "g" } },
        sessions: {
          "sess-H-FT": {
            phase: "awaiting_client_hello",
            process_id: "proc-H-FT",
            selected_version: null,
            extension_capabilities: [],
            gateway_instance_id: null,
            session_id_hex: null,
            support_row: null,
            entry_path: null,
            pending_resume_claim: null,
            ready: false,
            terminal: false,
            channels: {},
            sequences: {},
            server_wire_versions: [0, 0],
            server_gateway_instance_id: "g",
            server_support_row: "H-FT",
          },
        },
      },
      "s",
    );
    expect(d.some((x) => x.includes("server_wire_versions") && x.includes("sorted"))).toBe(true);
  });

  test("duplicate pending channel_ack ids diagnose", () => {
    const d = diagnoseCompositionState(
      {
        processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "g" } },
        sessions: {
          "sess-H-FT": {
            phase: "awaiting_entry_response",
            process_id: "proc-H-FT",
            selected_version: 0,
            extension_capabilities: [1],
            gateway_instance_id: null,
            session_id_hex: null,
            support_row: null,
            entry_path: "resume",
            pending_resume_claim: {
              gateway_instance_id: "gateway-H-FT",
              support_row: "H-FT",
              previous_session_id_hex: "a".repeat(64),
              channel_acks: [
                { channel_id: 1, acknowledged_sequence: 0 },
                { channel_id: 1, acknowledged_sequence: 1 },
              ],
            },
            ready: false,
            terminal: false,
            channels: {},
            sequences: {},
            server_wire_versions: [0],
            server_gateway_instance_id: "g",
            server_support_row: "H-FT",
          },
        },
      },
      "s",
    );
    expect(d.some((x) => x.includes("duplicate channel_id"))).toBe(true);
  });

  test("channel_id 0 in pending ack diagnoses", () => {
    const d = diagnoseCompositionState(
      {
        processes: { "proc-H-FT": { support_row: "H-FT", gateway_instance_id: "g" } },
        sessions: {
          "sess-H-FT": {
            phase: "awaiting_entry_response",
            process_id: "proc-H-FT",
            selected_version: 0,
            extension_capabilities: [1],
            gateway_instance_id: null,
            session_id_hex: null,
            support_row: null,
            entry_path: "resume",
            pending_resume_claim: {
              gateway_instance_id: "gateway-H-FT",
              support_row: "H-FT",
              previous_session_id_hex: "a".repeat(64),
              channel_acks: [{ channel_id: 0, acknowledged_sequence: 0 }],
            },
            ready: false,
            terminal: false,
            channels: {},
            sequences: {},
            server_wire_versions: [0],
            server_gateway_instance_id: "g",
            server_support_row: "H-FT",
          },
        },
      },
      "s",
    );
    expect(d.some((x) => x.includes("channel_id"))).toBe(true);
  });
});
