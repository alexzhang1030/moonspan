import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  access,
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
  AGREEMENT_DIR_REL,
  BATCH_ID,
  EXPECTED_REL,
  MALFORMED_TOTAL,
  OUTCOMES_TOTAL,
  PARITY_SHARED_TOTAL,
  PHASE_ONE_TRIPLES,
  RECIPE_ID,
  RECIPE_PAYLOAD_FNV1A64_HEX,
  RECIPE_PAYLOAD_LENGTH,
  SEQUENCES_TOTAL,
  VALID_MANIFEST_REL,
  VALID_TOTAL,
  type AgreeDocument,
  asciiCompare,
  buildAgreeDocument,
  checkExpected,
  corpusQualifiedId,
  diagnoseAgreeDocument,
  extractSessionReadyTriple,
  fnv1a64Hex,
  headTailHex,
  intToDecimalString,
  parseCliMode,
  projectCborValue,
  repoRootFrom,
  resolveUnderRoot,
  stableJsonCompact,
  stableJsonPretty,
  textDigest,
  writeExpected,
} from "./protocol-agree.ts";

const root = repoRootFrom(import.meta.dir);
const temps: string[] = [];

let sharedDoc: AgreeDocument;
let sharedPretty: string;

beforeAll(async () => {
  sharedDoc = await buildAgreeDocument(root);
  // Snapshot pretty text once; re-parse for mutation tests so sharedDoc stays intact.
  sharedPretty = stableJsonPretty(sharedDoc);
}, 180_000);

function cloneShared(): AgreeDocument {
  return JSON.parse(sharedPretty) as AgreeDocument;
}

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "protocol-agree-"));
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
  // Copy materialized valid binaries; the 64 MiB case remains recipe-backed.
  await cp(
    path.join(root, "protocol/testdata/valid"),
    path.join(dest, "protocol/testdata/valid"),
    { recursive: true },
  );
}

describe("protocol-agree helpers", () => {
  test("parseCliMode accepts exactly one mode", () => {
    expect(parseCliMode(["--write-expected"])).toEqual({ mode: "write-expected" });
    expect(parseCliMode(["--check-expected"])).toEqual({ mode: "check-expected" });
    expect(parseCliMode([])).toHaveProperty("error");
    expect(parseCliMode(["--write", "--check"])).toHaveProperty("error");
  });

  test("fnv1a64Hex empty and short vectors", () => {
    expect(fnv1a64Hex(new Uint8Array(0))).toBe("cbf29ce484222325");
    expect(fnv1a64Hex(new Uint8Array([0xa5, 0x5a, 0xa5, 0x5a]))).toBe(
      "3811a377fd83b291",
    );
  });

  test("intToDecimalString headTailHex textDigest", () => {
    expect(intToDecimalString(0xffffffffffffffffn)).toBe("18446744073709551615");
    const ht = headTailHex(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 4);
    expect(ht.head).toBe("01020304");
    expect(ht.tail).toBe("06070809");
    const d = textDigest("ab");
    expect(d.utf8_byte_length).toBe(2);
    expect(d.fnv1a64_hex).toMatch(/^[0-9a-f]{16}$/);
  });

  test("stableJsonPretty is multi-line key-sorted with trailing newline", () => {
    const a = stableJsonPretty({ b: 1, a: { z: 2, y: 3 } });
    const b = stableJsonPretty({ a: { y: 3, z: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(a.includes("\n")).toBe(true);
    expect(a).toContain('  "a"');
    expect(stableJsonCompact({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("projectCborValue recursive map and bounded text", () => {
    const m = new Map<number, unknown>([
      [2, "hi"],
      [1, 42],
      [3, new Uint8Array([0xaa])],
    ]);
    const p = projectCborValue(m as never);
    expect(p.t).toBe("map");
    if (p.t === "map") {
      expect(p.entries.map((e) => e.key)).toEqual(["1", "2", "3"]);
      expect(p.entries[0]!.value).toEqual({ t: "uint", v: "42" });
    }
    const long = "x".repeat(100);
    const t = projectCborValue(long);
    expect(t.t).toBe("text");
    if (t.t === "text") {
      expect(t.inline).toBeNull();
      expect(t.utf8_byte_length).toBe(100);
    }
  });

  test("resolveUnderRoot rejects absolute and escape", () => {
    expect(resolveUnderRoot(root, EXPECTED_REL).ok).toBe(true);
    expect(resolveUnderRoot(root, "/etc/passwd").ok).toBe(false);
    expect(resolveUnderRoot(root, "../x").ok).toBe(false);
  });
});

describe("protocol-agree corpus (shared build)", () => {
  test("exact counts sorted unique ids", () => {
    expect(sharedDoc.counts.outcomes_total).toBe(OUTCOMES_TOTAL);
    expect(sharedDoc.counts.valid_boundary).toBe(VALID_TOTAL);
    expect(sharedDoc.counts.sequences).toBe(SEQUENCES_TOTAL);
    expect(sharedDoc.counts.malformed).toBe(MALFORMED_TOTAL);
    expect(sharedDoc.counts.parity_shared_artifacts).toBe(PARITY_SHARED_TOTAL);
    expect(sharedDoc.outcomes.length).toBe(OUTCOMES_TOTAL);
    expect(sharedDoc.batch).toBe(BATCH_ID);
    for (let i = 1; i < sharedDoc.outcomes.length; i++) {
      expect(
        asciiCompare(sharedDoc.outcomes[i - 1]!.id, sharedDoc.outcomes[i]!.id),
      ).toBeLessThan(0);
    }
  });

  test("64 MiB application payload_fnv1a64_hex pin", () => {
    const recipe = sharedDoc.outcomes.find((o) => o.source_id === RECIPE_ID);
    expect(recipe).toBeDefined();
    expect(recipe!.representation).toBe("segment_recipe");
    const rec = recipe!.record as {
      payload: { form: string; payload_len: number; payload_fnv1a64_hex: string };
    };
    expect(rec.payload.form).toBe("application");
    expect(rec.payload.payload_len).toBe(RECIPE_PAYLOAD_LENGTH);
    expect(rec.payload.payload_fnv1a64_hex).toBe(RECIPE_PAYLOAD_FNV1A64_HEX);
  });

  test("SessionReady triples from decoded control fields", () => {
    const found = new Map<string, { ros_distro: string; rmw_identifier: string }>();
    for (const o of sharedDoc.outcomes) {
      if (o.status !== "success" || !o.record || !("payload" in o.record)) continue;
      const t = extractSessionReadyTriple(o.record.payload);
      if (t) {
        found.set(t.support_row_id, {
          ros_distro: t.ros_distro,
          rmw_identifier: t.rmw_identifier,
        });
      }
    }
    for (const exp of PHASE_ONE_TRIPLES) {
      const got = found.get(exp.support_row_id);
      expect(got).toEqual({
        ros_distro: exp.ros_distro,
        rmw_identifier: exp.rmw_identifier,
      });
    }
    expect(sharedDoc.phase_one_triples).toEqual(
      PHASE_ONE_TRIPLES.map((t) => ({ ...t })),
    );
  });

  test("CONTROL success carries control_fields projection", () => {
    const ctrl = sharedDoc.outcomes.find(
      (o) =>
        o.status === "success" &&
        o.record &&
        "payload" in o.record &&
        o.record.payload.form === "control",
    );
    expect(ctrl).toBeDefined();
    const pay = (ctrl!.record as { payload: { form: string; control_fields: unknown } })
      .payload;
    expect(pay.form).toBe("control");
    expect(pay.control_fields).toMatchObject({ t: "map" });
  });

  test("malformed six oracle fields", () => {
    const mals = sharedDoc.outcomes.filter((o) => o.corpus === "malformed");
    expect(mals.length).toBe(MALFORMED_TOTAL);
    for (const o of mals) {
      const e = o.error!;
      expect(typeof e.code).toBe("number");
      expect(typeof e.name).toBe("string");
      expect(typeof e.reason).toBe("string");
      expect(typeof e.offset).toBe("number");
      expect(typeof e.plane).toBe("string");
      expect(typeof e.step).toBe("number");
      expect(e.plane === "bootstrap" || e.plane === "selected_frame").toBe(true);
      expect(e.step).toBeGreaterThanOrEqual(1);
    }
  });

  test("parity bindings cross-ref success outcomes", () => {
    expect(sharedDoc.transport_bindings.length).toBe(PARITY_SHARED_TOTAL);
    const success = new Set(
      sharedDoc.outcomes.filter((o) => o.status === "success").map((o) => o.id),
    );
    for (const b of sharedDoc.transport_bindings) {
      expect(b.equal_wt_wss).toBe(true);
      expect(b.webtransport.sha256).toBe(b.binary_wss.sha256);
      expect(success.has(b.outcome_id)).toBe(true);
      const o = sharedDoc.outcomes.find((x) => x.id === b.outcome_id)!;
      expect(o.byte_length).toBe(b.byte_length);
      expect(o.input_sha256).toBe(b.sha256);
    }
  });

  test("canonical two-write identity of pretty JSON", () => {
    const again = stableJsonPretty(cloneShared());
    expect(again).toBe(sharedPretty);
    expect(sharedPretty.endsWith("\n")).toBe(true);
    expect(sharedPretty.startsWith("{\n")).toBe(true);
  });
});

describe("protocol-agree repository check", () => {
  test("check-expected read-only success against committed file", async () => {
    const before = await readFile(path.join(root, EXPECTED_REL), "utf8");
    const result = await checkExpected(root);
    expect(result.ok).toBe(true);
    const after = await readFile(path.join(root, EXPECTED_REL), "utf8");
    expect(after).toBe(before);
    expect(before).toBe(sharedPretty);
  }, 180_000);
});

describe("protocol-agree I/O safety in temp corpus root", () => {
  test("writeExpected and checkExpected end-to-end on copied corpus", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const { text, doc } = await writeExpected(dest);
    expect(doc.counts.outcomes_total).toBe(OUTCOMES_TOTAL);
    expect(text).toContain(RECIPE_PAYLOAD_FNV1A64_HEX);
    expect(text.endsWith("\n")).toBe(true);
    const check = await checkExpected(dest);
    expect(check.ok).toBe(true);
  }, 180_000);

  test("expected target symlink is rejected on write", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const agreeDir = path.join(dest, AGREEMENT_DIR_REL);
    const target = path.join(dest, "elsewhere.json");
    await writeFile(target, "{}\n");
    await symlink(target, path.join(agreeDir, "expected.json"));
    await expect(writeExpected(dest)).rejects.toThrow(/symlink/i);
  }, 180_000);

  test("agreement directory symlink is rejected", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    // replace agreement dir with symlink
    await rm(path.join(dest, AGREEMENT_DIR_REL), { recursive: true, force: true });
    const real = path.join(dest, "agree-real");
    await mkdir(real, { recursive: true });
    await symlink(real, path.join(dest, AGREEMENT_DIR_REL));
    await expect(writeExpected(dest)).rejects.toThrow(/symlink/i);
  }, 180_000);

  test("source ancestor directory symlink is rejected on read", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const regDir = path.join(dest, "protocol/registry");
    const realDir = path.join(dest, "registry-real");
    await rename(regDir, realDir);
    await symlink(realDir, regDir);
    await expect(buildAgreeDocument(dest)).rejects.toThrow(/symlink/i);
  }, 60_000);

  test("manifest path traversal fails through source validation", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const manPath = path.join(dest, VALID_MANIFEST_REL);
    const man = JSON.parse(await readFile(manPath, "utf8")) as {
      fixtures: Array<Record<string, unknown>>;
    };
    const bin = man.fixtures.find((f) => f.representation === "binary");
    expect(bin).toBeDefined();
    bin!.path = "../secret.bin";
    await writeFile(manPath, `${JSON.stringify(man)}\n`);
    await expect(buildAgreeDocument(dest)).rejects.toThrow(/validation failed|path/i);
  }, 60_000);

  test("path traversal and noncanonical resolveUnderRoot", () => {
    expect(resolveUnderRoot(root, "protocol/testdata/../../../etc/passwd").ok).toBe(
      false,
    );
    expect(resolveUnderRoot(root, "protocol\\testdata\\x").ok).toBe(false);
    expect(resolveUnderRoot(root, "protocol/./testdata/x").ok).toBe(false);
    expect(resolveUnderRoot(root, "protocol//testdata/x").ok).toBe(false);
  });

  test("oversized expected file is rejected on check", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const big = "x".repeat(9 * 1024 * 1024);
    await writeFile(path.join(dest, EXPECTED_REL), big);
    const r = await checkExpected(dest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics.some((d) => /size|max|exceeds/i.test(d))).toBe(true);
    }
  }, 30_000);

  test("malformed expected JSON yields diagnostics", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    await writeFile(path.join(dest, EXPECTED_REL), "{not json\n");
    const r = await checkExpected(dest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics.some((d) => /malformed JSON/i.test(d))).toBe(true);
    }
  }, 30_000);

  test("missing expected remains absent on filesystem", async () => {
    const dest = await tempDir();
    await copyCorpusRoot(dest);
    const expectedAbs = path.join(dest, EXPECTED_REL);
    await rm(expectedAbs, { force: true });
    const r = await checkExpected(dest);
    expect(r.ok).toBe(false);
    let absent = false;
    try {
      await access(expectedAbs);
    } catch {
      absent = true;
    }
    expect(absent).toBe(true);
  }, 30_000);
});

describe("protocol-agree diagnose nested mutations", () => {
  test("table-driven validator categories", () => {
    type Case = { name: string; mut: (c: AgreeDocument) => void; needle: RegExp };

    const cases: Case[] = [
      {
        name: "null bootstrap nested",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "variant" in x.record &&
              x.record.variant === "server_hello",
          )!;
          (o.record as { transport_capabilities: unknown }).transport_capabilities =
            null;
        },
        needle: /transport_capabilities/,
      },
      {
        name: "string frame version",
        mut: (c) => {
          const o = c.outcomes.find((x) => x.record && "version" in x.record)!;
          (o.record as { version: unknown }).version = "0";
        },
        needle: /\.version/,
      },
      {
        name: "string extension type_id",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "extensions" in x.record &&
              x.record.extensions.length > 0,
          )!;
          (o.record as { extensions: Array<{ type_id: unknown }> }).extensions[0]!.type_id =
            "1";
        },
        needle: /type_id/,
      },
      {
        name: "negative payload_len",
        mut: (c) => {
          const o = c.outcomes.find((x) => x.record && "payload_len" in x.record)!;
          (o.record as { payload_len: number }).payload_len = -1;
        },
        needle: /payload_len/,
      },
      {
        name: "invalid head hex",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "application",
          )!;
          (
            o.record as { payload: { payload_head_hex: string } }
          ).payload.payload_head_hex = "ZZ";
        },
        needle: /payload_head_hex/,
      },
      {
        name: "control_kind 99",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          (o.record as { payload: { control_kind: number } }).payload.control_kind = 99;
        },
        needle: /control_kind/,
      },
      {
        name: "unsorted control_field_keys",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          (
            o.record as { payload: { control_field_keys: number[] } }
          ).payload.control_field_keys = [3, 1, 2];
        },
        needle: /control_field_keys/,
      },
      {
        name: "cbor inline mismatch",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          const fields = (
            o.record as {
              payload: {
                control_fields: {
                  t: string;
                  entries: Array<{ value: { t: string; inline?: string | null } }>;
                };
              };
            }
          ).payload.control_fields;
          const ent = fields.entries.find(
            (e) => e.value.t === "text" && e.value.inline,
          )!;
          ent.value.inline = "nope";
        },
        needle: /inline fnv mismatch|inline length/,
      },
      {
        name: "source path constant",
        mut: (c) => {
          c.sources.valid_manifest.path = "evil";
        },
        needle: /path constant/,
      },
      {
        name: "id corpus-qualified",
        mut: (c) => {
          c.outcomes[0]!.id = "valid_boundary:not-the-source";
          c.outcomes[0]!.source_id = "other";
          c.outcomes[0]!.corpus = "valid_boundary";
        },
        needle: /corpus-qualified|source_id/,
      },
    ];
    for (const tc of cases) {
      const c = cloneShared();
      tc.mut(c);
      const d = diagnoseAgreeDocument(c);
      expect(d.length).toBeGreaterThan(0);
      expect(d.some((x) => tc.needle.test(x))).toBe(true);
    }
  });

  test("direct Codex counterexample mutations", () => {
    type Case = { name: string; mut: (c: AgreeDocument) => void; needle: RegExp };
    const cases: Case[] = [
      {
        name: "control_kind differs from map key 1",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          const pay = (
            o.record as {
              payload: {
                control_kind: number;
                control_fields: {
                  t: string;
                  entries: Array<{ key: string; value: { t: string; v?: string } }>;
                };
              };
            }
          ).payload;
          const kindEnt = pay.control_fields.entries.find((e) => e.key === "1")!;
          const original = Number(kindEnt.value.v);
          // Keep map key 1 at the original kind; flip the projected control_kind.
          pay.control_kind = original === 1 ? 2 : 1;
        },
        needle: /control_kind equals map key 1/,
      },
      {
        name: "control_fields t:null with empty keys",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          const pay = o.record as {
            payload: {
              control_field_keys: number[];
              control_fields: unknown;
            };
          };
          pay.payload.control_field_keys = [];
          pay.payload.control_fields = { t: "null" };
        },
        needle: /control_fields must be map/,
      },
      {
        name: "application head and tail emptied",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "application" &&
              x.record.payload.payload_len > 0,
          )!;
          const pay = (
            o.record as {
              payload: { payload_head_hex: string; payload_tail_hex: string };
            }
          ).payload;
          pay.payload_head_hex = "";
          pay.payload_tail_hex = "";
        },
        needle: /exact min\(8,payload_len\) bytes/,
      },
      {
        name: "CONTROL opcode changed to 2",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "opcode" in x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          (o.record as { opcode: number }).opcode = 2;
        },
        needle: /application opcode requires application|channel_id application requires positive/,
      },
      {
        name: "application priority 5",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "priority" in x.record &&
              "payload" in x.record &&
              x.record.payload.form === "application",
          )!;
          (o.record as { priority: number }).priority = 5;
        },
        needle: /priority assigned 0\.\.4/,
      },
      {
        name: "extension_len 4097",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) => x.record && "extension_len" in x.record,
          )!;
          (o.record as { extension_len: number }).extension_len = 4097;
        },
        needle: /extension_len exceeds 4096/,
      },
      {
        name: "ServerHello max_channels 65536",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "variant" in x.record &&
              x.record.variant === "server_hello",
          )!;
          (
            o.record as {
              effective_limits: { max_channels: number };
            }
          ).effective_limits.max_channels = 65536;
        },
        needle: /max_channels exceeds ceiling 65535/,
      },
      {
        name: "ClientHello wire_versions [1,0]",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "variant" in x.record &&
              x.record.variant === "client_hello",
          )!;
          (o.record as { wire_versions: number[] }).wire_versions = [1, 0];
        },
        needle: /wire_versions\[1\] must be strictly ascending unique/,
      },
      {
        name: "ServerHello selected_wire_version 1",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "variant" in x.record &&
              x.record.variant === "server_hello",
          )!;
          (o.record as { selected_wire_version: number }).selected_wire_version = 1;
        },
        needle: /selected_wire_version equals v0/,
      },
      {
        name: "nested CBOR map with 4097 entries",
        mut: (c) => {
          const o = c.outcomes.find(
            (x) =>
              x.record &&
              "payload" in x.record &&
              x.record.payload.form === "control",
          )!;
          const fields = (
            o.record as {
              payload: {
                control_fields: {
                  t: string;
                  entries: Array<{
                    key: string;
                    value: unknown;
                  }>;
                };
              };
            }
          ).payload.control_fields;
          const nestedEntries = Array.from({ length: 4097 }, (_, i) => ({
            key: String(i + 1),
            value: { t: "null" as const },
          }));
          // Nest under an existing entry to isolate the recursive map ceiling.
          const nonKind = fields.entries.find((e) => e.key !== "1")!;
          nonKind.value = { t: "map", entries: nestedEntries };
        },
        needle: /entries exceeds ceiling 4096/,
      },
    ];
    for (const tc of cases) {
      const c = cloneShared();
      tc.mut(c);
      const d = diagnoseAgreeDocument(c);
      expect(d.length).toBeGreaterThan(0);
      expect(d.some((x) => tc.needle.test(x))).toBe(true);
    }
  });

  test("six error fields mutated separately", () => {
    const fields: Array<{
      key: keyof NonNullable<AgreeDocument["outcomes"][0]["error"]>;
      value: unknown;
      needle: RegExp;
    }> = [
      { key: "code", value: 999, needle: /error\.code/ },
      { key: "name", value: "BadName", needle: /error\.name/ },
      { key: "reason", value: "BadReason", needle: /error\.reason/ },
      { key: "offset", value: -1, needle: /error\.offset/ },
      { key: "plane", value: "nope", needle: /error\.plane/ },
      { key: "step", value: 0, needle: /error\.step/ },
    ];
    for (const f of fields) {
      const c = cloneShared();
      const mal = c.outcomes.find((o) => o.status === "error")!;
      (mal.error as Record<string, unknown>)[f.key] = f.value;
      const d = diagnoseAgreeDocument(c);
      expect(d.some((x) => f.needle.test(x))).toBe(true);
    }
  });

  test("transport identity mutations", () => {
    const cases: Array<{ mut: (c: AgreeDocument) => void; needle: RegExp }> = [
      {
        mut: (c) => {
          c.transport_bindings[0]!.outcome_id = "valid_boundary:missing";
        },
        needle: /outcome_id/,
      },
      {
        mut: (c) => {
          c.transport_bindings[0]!.id = "not-equal-to-outcome";
        },
        needle: /id equals outcome_id|outcome_id identity/,
      },
      {
        mut: (c) => {
          c.transport_bindings[0]!.webtransport.semantic_identity = "wrong/id";
        },
        needle: /semantic_identity/,
      },
      {
        mut: (c) => {
          c.transport_bindings[0]!.byte_length = 1;
        },
        needle: /byte_length|outcome length/,
      },
      {
        mut: (c) => {
          c.transport_bindings[0]!.webtransport.sha256 =
            "0".repeat(64);
        },
        needle: /sha256|WT\/WSS/,
      },
      {
        mut: (c) => {
          c.transport_bindings[0]!.source_corpus = "malformed";
        },
        needle: /source_corpus/,
      },
    ];
    for (const tc of cases) {
      const c = cloneShared();
      tc.mut(c);
      const d = diagnoseAgreeDocument(c);
      expect(d.some((x) => tc.needle.test(x))).toBe(true);
    }
  });
});

describe("protocol-agree diagnose totals", () => {
  test("diagnoseAgreeDocument accepts shared pretty document", () => {
    const d = diagnoseAgreeDocument(cloneShared());
    expect(d).toEqual([]);
  });

  test("diagnose is deterministic for arbitrary input", () => {
    const a = diagnoseAgreeDocument({ schema_version: 9 });
    const b = diagnoseAgreeDocument({ schema_version: 9 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
