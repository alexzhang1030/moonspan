import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ABSOLUTE_LIMIT_SPEC,
  CDDL_BOUND_SURFACES,
  ERROR_STRING_ALIASES,
  EXPECTED_DIRECT_BOUND_SURFACES,
  buildCddlReferenceGraph,
  findUnboundedCddlCollections,
  loadAndValidateProtocolContract,
  parseCddlRules,
  stripCddlStringLiterals,
  validateProtocolContract,
} from "./protocol-check.ts";

const root = path.resolve(import.meta.dir, "..");

async function loadCanonical(): Promise<{ registryText: string; cddlText: string }> {
  const registryText = await readFile(path.join(root, "protocol/registry/r2wp-v0.json"), "utf8");
  const cddlText = await readFile(path.join(root, "protocol/schema/control-v0.cddl"), "utf8");
  return { registryText, cddlText };
}

function mutateRegistry(registryText: string, mut: (obj: Record<string, unknown>) => void): string {
  const obj = JSON.parse(registryText) as Record<string, unknown>;
  mut(obj);
  return JSON.stringify(obj);
}

describe("protocol-check valid repository contract", () => {
  test("canonical registry + CDDL pass", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const result = validateProtocolContract(registryText, cddlText);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("status=ok");
    expect(result.summary).toContain("cddl_root=r2wp-v0-control");
  });

  test("repo loader loads canonical files", async () => {
    const result = await loadAndValidateProtocolContract(root);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("diagnostics sort lexicographically on multi-fail", async () => {
    const { cddlText } = await loadCanonical();
    const result = validateProtocolContract("{", cddlText);
    expect(result.ok).toBe(false);
    const sorted = [...result.diagnostics].sort((a, b) => a.localeCompare(b));
    expect(result.diagnostics).toEqual(sorted);
  });
});

describe("protocol-check intentional corruptions", () => {
  test("malformed JSON", async () => {
    const { cddlText } = await loadCanonical();
    const result = validateProtocolContract("{not-json", cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.startsWith("registry: malformed JSON:"))).toBe(true);
  });

  test("null required top-level collection (opcodes)", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      o.opcodes = null;
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('field "opcodes"') && d.includes("null"))).toBe(
      true,
    );
  });

  test("empty object collection opcodes fails", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      o.opcodes = {};
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('field "opcodes"') && d.includes("non-empty"))).toBe(
      true,
    );
  });

  test("absolute_limits wrong type and wrong value fail", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const limits = o.absolute_limits as Record<string, unknown>;
      limits.cbor_nesting_depth_max = "oops";
      limits.bootstrap_payload_max_bytes = 1;
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.includes("absolute_limits.cbor_nesting_depth_max") && d.includes("number"),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (d) =>
          d.includes("absolute_limits.bootstrap_payload_max_bytes") && d.includes("65535"),
      ),
    ).toBe(true);
  });

  test("support_row_profiles H-FT cannot drift to jazzy/cyclone", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const profiles = o.support_row_profiles as Record<string, Record<string, string>>;
      profiles["H-FT"] = { ros_distro: "jazzy", rmw_identifier: "rmw_cyclonedds_cpp" };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("support_row_profiles.H-FT.ros_distro"))).toBe(
      true,
    );
    expect(
      result.diagnostics.some((d) => d.includes("support_row_profiles.H-FT.rmw_identifier")),
    ).toBe(true);
  });

  test("missing required registry collection", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      delete o.validation_order;
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('missing required field "validation_order"'))).toBe(
      true,
    );
  });

  test("phase-one row drift", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      o.phase_one_support_rows = ["H-FT", "H-CY", "J-FT", "K-XX"];
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("phase_one_support_rows must be exactly"))).toBe(true);
  });

  test("invalid validation-order reference", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const vo = o.validation_order as { selected_frame: Array<Record<string, unknown>> };
      vo.selected_frame[0] = {
        ...vo.selected_frame[0],
        error: "not_a_real_error_code_name",
        code: 3,
      };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.includes('unknown error name "not_a_real_error_code_name"')),
    ).toBe(true);
  });

  test("validation-order non-consecutive step and missing code", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const vo = o.validation_order as { selected_frame: Array<Record<string, unknown>> };
      vo.selected_frame[0] = {
        step: 2,
        check: vo.selected_frame[0].check,
        error: "malformed_frame",
        // code deleted
      };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("step must be 1") && d.includes("got 2"))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.includes("error row requires integer code"))).toBe(true);
  });

  test("disposition-only row must declare known disposition", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const vo = o.validation_order as { selected_frame: Array<Record<string, unknown>> };
      // find a disposition row or force one
      const idx = vo.selected_frame.findIndex((r) => r.error === null);
      expect(idx).toBeGreaterThanOrEqual(0);
      vo.selected_frame[idx] = {
        step: idx + 1,
        check: "sequence_best_effort_gap",
        error: null,
        disposition: "not_a_real_disposition",
      };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.includes('disposition "not_a_real_disposition"')),
    ).toBe(true);
  });

  test("unbounded CDDL array", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText + "\n\nbogus-list = [* uint32]\n";
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unbounded collection"))).toBe(true);
  });

  test("unbounded CDDL map occurrence is rejected", async () => {
    const { registryText, cddlText } = await loadCanonical();
    // Insert open map entry inside reachable effective-limits
    const badCddl = cddlText.replace(
      /effective-limits\s*=\s*\{/,
      "effective-limits = {\n  * uint => any,",
    );
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unbounded collection"))).toBe(true);
  });

  test("nested map with outer unbounded occurrence is rejected", async () => {
    const { registryText, cddlText } = await loadCanonical();
    // Direct helper regression: outer map * with nested map sibling
    const hits = findUnboundedCddlCollections(
      "root = { * uint => any, 1 => { 2 => uint } }\n",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.includes("* uint"))).toBe(true);

    // Full validator path: inject nested unbounded form into reachable effective-limits
    const nestedInject = cddlText.replace(
      /effective-limits\s*=\s*\{[\s\S]*?\n\}/,
      `effective-limits = { * uint => any, 1 => { 2 => uint }, 1 => 0..65535, 2 => 0..4294967296, 3 => 0..67108864, 4 => 0..1048576 }`,
    );
    const result = validateProtocolContract(registryText, nestedInject);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unbounded collection"))).toBe(true);
  });

  test("h' and b64' literals do not leave prefix identifiers", () => {
    expect(stripCddlStringLiterals("h'aa'").includes("h")).toBe(false);
    expect(stripCddlStringLiterals("b64'YQ=='").includes("b64")).toBe(false);
    const { rules } = parseCddlRules("root = h'aa' / b64'YQ=='\n");
    const graph = buildCddlReferenceGraph(rules);
    expect(graph.undefinedRefs).toEqual([]);
  });

  test("empty title and unknown top-level key fail", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      o.title = "";
      o.typo_registry = { x: 1 };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('field "title"') && d.includes("non-empty"))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.includes('unknown top-level key "typo_registry"'))).toBe(
      true,
    );
  });

  test("errors string aliases must match exact accepted set", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const errors = o.errors as Record<string, unknown>;
      errors.bootstrap_unknown_kind = "protocol_violation"; // drift
      delete errors.bootstrap_state_order_violation;
      errors.extra_alias = "malformed_bootstrap";
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.includes('alias "bootstrap_unknown_kind"') && d.includes("malformed_bootstrap")),
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.includes('missing required alias "bootstrap_state_order_violation"'))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.includes('unknown alias "extra_alias"'))).toBe(true);
    expect(ERROR_STRING_ALIASES.bootstrap_unknown_kind).toBe("malformed_bootstrap");
  });

  test("undefined CDDL rule reference uint33 is rejected", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText.replace("? 1 => uint32,", "? 1 => uint33,");
    expect(badCddl.includes("uint33")).toBe(true);
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('undefined rule reference "uint33"'))).toBe(
      true,
    );
  });

  test("bytes-content must stay under control_payload_max_bytes surface", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText.replace(
      /bytes-content\s*=\s*bstr \.size \(0\.\.1048576\)/,
      "bytes-content = bstr .size (0..2097152)",
    );
    expect(badCddl.includes("0..2097152")).toBe(true);
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.includes('rule "bytes-content"') && d.includes("control_payload_max_bytes"),
      ),
    ).toBe(true);
  });

  test("deleting errors[8] fails while wire-error-code still includes 8", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const errors = o.errors as Record<string, unknown>;
      delete errors["8"];
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('errors missing numeric key "8"'))).toBe(true);
  });

  test("dead CDDL rule", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText + "\n\norphan-rule = uint32\n";
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('unreachable (dead) rule "orphan-rule"'))).toBe(
      true,
    );
  });

  test("string literal must not keep humble rule reachable", async () => {
    const { registryText, cddlText } = await loadCanonical();
    // ros-distro contains "humble"; a rule named humble must remain dead
    const badCddl = cddlText + "\n\nhumble = uint32\n";
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('unreachable (dead) rule "humble"'))).toBe(true);
  });

  test("duplicate CDDL rule definition", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText + "\n\nuint32 = 0..10\n";
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes('duplicate rule definition "uint32"'))).toBe(true);
  });

  test("root-first drift", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = "decoy-root = uint32\n\n" + cddlText;
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) =>
        d.includes('root rule must be first definition "r2wp-v0-control"'),
      ),
    ).toBe(true);
  });

  test("mapped limit mismatch on absolute_limits value", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const expected = (ABSOLUTE_LIMIT_SPEC.control_payload_max_bytes as { value: number }).value;
    const bad = mutateRegistry(registryText, (o) => {
      const limits = o.absolute_limits as Record<string, unknown>;
      limits.control_payload_max_bytes = expected + 1;
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) =>
        d.includes(`absolute_limits.control_payload_max_bytes must be ${expected}`),
      ),
    ).toBe(true);
  });

  test("rule-local effective-limits field drift is detected", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText.replace(
      /effective-limits\s*=\s*\{[\s\S]*?\n\}/,
      `effective-limits = {
  1 => 0..65535,
  2 => 0..4294967296,
  3 => 0..67108864,
  4 => 0..1048575
}`,
    );
    expect(badCddl.includes("4 => 0..1048575")).toBe(true);
    expect(badCddl.includes("bstr .size (1..1048576)") || badCddl.includes("0..1048576")).toBe(true);
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) =>
          d.includes('rule "effective-limits"') &&
          d.includes("control_payload_max_bytes"),
      ),
    ).toBe(true);
  });

  test("source_bundle_entries_max must hold on schema-response surface", async () => {
    const { registryText, cddlText } = await loadCanonical();
    // Only change schema-response array bound; leave schema-advertise at 4096
    const badCddl = cddlText.replace(
      /(schema-response\s*=\s*\{[\s\S]*?)\[0\*4096 source-bundle-entry\]/,
      "$1[0*4000 source-bundle-entry]",
    );
    expect(badCddl.includes("[0*4000 source-bundle-entry]")).toBe(true);
    expect(badCddl.includes("schema-advertise") && badCddl.includes("[0*4096 source-bundle-entry]")).toBe(
      true,
    );
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) =>
          d.includes('rule "schema-response"') &&
          d.includes("source_bundle_entries_max"),
      ),
    ).toBe(true);
  });

  test("exact_codes code 20 banned even with Sender-local note", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const bad = mutateRegistry(registryText, (o) => {
      const vo = o.validation_order as { exact_codes: Record<string, unknown> };
      vo.exact_codes.adapter_profile_mismatch_row = {
        code: 20,
        name: "adapter_profile_mismatch",
        note: "Sender-local only",
      };
    });
    const result = validateProtocolContract(bad, cddlText);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) =>
          d.includes("exact_codes.adapter_profile_mismatch_row") &&
          d.includes("code 20"),
      ),
    ).toBe(true);
  });

  test("bootstrap-error-code must exclude 20", async () => {
    const { registryText, cddlText } = await loadCanonical();
    const badCddl = cddlText.replace(
      /bootstrap-error-code\s*=\s*[^\n]+/,
      "bootstrap-error-code = 1 / 2 / 4 / 16 / 20 / 24 / 25",
    );
    const result = validateProtocolContract(registryText, badCddl);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.includes("bootstrap-error-code") && (d.includes("20") || d.includes("exclude")),
      ),
    ).toBe(true);
  });
});

describe("protocol-check helpers", () => {
  test("parseCddlRules root is first", async () => {
    const { cddlText } = await loadCanonical();
    const { rules } = parseCddlRules(cddlText);
    expect(rules[0]?.name).toBe("r2wp-v0-control");
    expect(rules.length).toBeGreaterThan(10);
  });

  test("canonical CDDL has no unbounded collections, dead rules, or undefined refs", async () => {
    const { cddlText } = await loadCanonical();
    expect(findUnboundedCddlCollections(cddlText)).toEqual([]);
    const { rules } = parseCddlRules(cddlText);
    const graph = buildCddlReferenceGraph(rules);
    expect(graph.dead).toEqual([]);
    expect(graph.undefinedRefs).toEqual([]);
  });

  test("stripCddlStringLiterals removes humble text", () => {
    const body = ' "humble" / "jazzy" ';
    const stripped = stripCddlStringLiterals(body);
    expect(stripped.includes("humble")).toBe(false);
    expect(stripped.includes("jazzy")).toBe(false);
  });

  test("ABSOLUTE_LIMIT_SPEC covers every canonical absolute_limits key", async () => {
    const { registryText } = await loadCanonical();
    const limits = (JSON.parse(registryText) as { absolute_limits: Record<string, unknown> })
      .absolute_limits;
    expect(Object.keys(limits).sort()).toEqual(Object.keys(ABSOLUTE_LIMIT_SPEC).sort());
  });

  test("CDDL_BOUND_SURFACES has only direct ownership bindings", () => {
    const pairs = CDDL_BOUND_SURFACES.map((s) => `${s.limitKey}|${s.ruleName}`).sort();
    const expected = EXPECTED_DIRECT_BOUND_SURFACES.map((s) => `${s.limitKey}|${s.ruleName}`).sort();
    expect(pairs).toEqual(expected);
    // No false capability-id ownership of max_channels_ceiling
    expect(CDDL_BOUND_SURFACES.some((s) => s.ruleName === "capability-id")).toBe(false);
    // control_payload owns both effective-limits and bytes-content
    expect(
      CDDL_BOUND_SURFACES.filter((s) => s.limitKey === "control_payload_max_bytes").map((s) => s.ruleName).sort(),
    ).toEqual(["bytes-content", "effective-limits"]);
  });
});
