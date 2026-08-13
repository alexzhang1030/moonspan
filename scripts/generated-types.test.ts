import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  PHASE1_ROOTS,
  asciiCompare,
  endiannessToCdr,
  isAcyclic,
  isLowerHexSha256,
  isValidRihs,
  loadAndBuild,
  parseCliMode,
  parseFieldNames,
  rootKind,
  selectInterfaceSection,
  stableJsonPretty,
} from "./generated-types.ts";

const ROOT = path.resolve(import.meta.dir, "..");

describe("generated-types helpers", () => {
  test("CLI mode parsing requires exactly one of --write|--check", () => {
    expect(parseCliMode(["--write"])).toEqual({ mode: "write" });
    expect(parseCliMode(["--check"])).toEqual({ mode: "check" });
    expect(parseCliMode([])).toHaveProperty("error");
    expect(parseCliMode(["--write", "--check"])).toHaveProperty("error");
    expect(parseCliMode(["--other"])).toHaveProperty("error");
  });

  test("root kind classification", () => {
    expect(rootKind("pkg/msg/Foo")).toBe("msg");
    expect(rootKind("pkg/srv/Foo_Request")).toBe("srv_request");
    expect(rootKind("pkg/srv/Foo_Response")).toBe("srv_response");
    expect(rootKind("pkg/action/Foo_Goal")).toBe("action_goal");
    expect(rootKind("pkg/action/Foo_Result")).toBe("action_result");
    expect(rootKind("pkg/action/Foo_Feedback")).toBe("action_feedback");
    expect(rootKind("pkg/srv/Foo")).toBeNull();
  });

  test("section selection for srv and action", () => {
    const srv = "A req\n---\nB res\nbool ok\n";
    const req = selectInterfaceSection(srv, "srv_request");
    const res = selectInterfaceSection(srv, "srv_response");
    expect(req.ok && req.section).toBe("A req");
    expect(res.ok && parseFieldNames(res.section).ok).toBe(true);
    if (res.ok) {
      const fields = parseFieldNames(res.section);
      expect(fields.ok && fields.field_names).toEqual(["res", "ok"]);
    }

    const action =
      "Collections target\n---\nNestedSample result\n---\nfloat32 progress\nNestedSample sample\n";
    const goal = selectInterfaceSection(action, "action_goal");
    const result = selectInterfaceSection(action, "action_result");
    const feedback = selectInterfaceSection(action, "action_feedback");
    expect(goal.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(feedback.ok).toBe(true);
    if (feedback.ok) {
      const fields = parseFieldNames(feedback.section);
      expect(fields.ok && fields.field_names).toEqual(["progress", "sample"]);
    }

    const surplus = selectInterfaceSection("a\n---\nb\n---\nc\n", "srv_request");
    expect(surplus.ok).toBe(false);
  });

  test("identity and endian helpers", () => {
    expect(isLowerHexSha256("a".repeat(64))).toBe(true);
    expect(isLowerHexSha256("A".repeat(64))).toBe(false);
    expect(isValidRihs(`RIHS01_${"a".repeat(64)}`)).toBe(true);
    expect(isValidRihs(`RIHS01_${"A".repeat(64)}`)).toBe(false);
    expect(endiannessToCdr("little")).toBe("CDR_LE");
    expect(endiannessToCdr("big")).toBe("CDR_BE");
    expect(isAcyclic([{ from: "a", to: "b" }, { from: "b", to: "c" }])).toBe(true);
    expect(isAcyclic([{ from: "a", to: "b" }, { from: "b", to: "a" }])).toBe(false);
  });

  test("stable JSON is deterministic and key-sorted", () => {
    const a = stableJsonPretty({ b: 1, a: { z: 2, m: 3 } });
    const b = stableJsonPretty({ a: { m: 3, z: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(a).toContain('"a"');
  });
});

describe("generated-types corpus build", () => {
  test("Phase 1 surface: 9 roots, 18 identities, PrimitiveScalars H-FT tails", async () => {
    const built = await loadAndBuild(ROOT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(PHASE1_ROOTS.length).toBe(9);
    expect(built.artifacts.descriptors.roots.length).toBe(9);
    expect(built.artifacts.identities.identities.length).toBe(18);
    expect(built.artifacts.provenance.mappings.length).toBe(9);
    expect(built.artifacts.normalized_sources.sources.length).toBe(9);

    const roots = built.artifacts.descriptors.roots.map((r) => r.type_name);
    expect(roots).toEqual([...PHASE1_ROOTS].sort(asciiCompare));

    const schemes = new Set(built.artifacts.identities.identities.map((i) => i.scheme));
    expect(schemes).toEqual(new Set(["rclweb-schema-v1", "rep2011-rihs"]));

    const primitive = "rclweb_cdr_interfaces/msg/PrimitiveScalars";
    const hftLe = built.artifacts.wire_profiles.profiles.find(
      (p) =>
        p.type_name === primitive &&
        p.support_row_id === "H-FT" &&
        p.cdr_representation === "CDR_LE",
    );
    const hftBe = built.artifacts.wire_profiles.profiles.find(
      (p) =>
        p.type_name === primitive &&
        p.support_row_id === "H-FT" &&
        p.cdr_representation === "CDR_BE",
    );
    expect(hftLe?.zero_tail_bytes).toBe(4);
    expect(hftBe?.zero_tail_bytes).toBe(0);
  });
});
