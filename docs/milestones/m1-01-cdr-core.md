# M1-01: MoonBit CDR core

Status: Complete. M1 remains active.

## Outcome

`cdr_mbt` (`rclmbt/cdr`) implements a bounded CDR1 reader and writer with semantic primitives, Char8 strings, ROS legacy wstring, containers, nesting tokens, and top-level declared zero-tail completion. The authoritative ROS corpus is bridged into package-internal white-box tests, decoded and re-encoded field-by-field, and gated adversarially for completion, resource bounds, and framing faults.

## Delivered scope

| Batch | Outcome | Record |
|---|---|---|
| M1-01a | CDR core contract freeze | [CDR core contract](../runtime/cdr.md) |
| M1-01b | Bounded stream reader/writer, encapsulation, limits, typed errors | [`rclmbt/cdr/`](../../rclmbt/cdr/) |
| M1-01c | Primitives, strings/wstrings, containers, nesting, borrowed views | [`rclmbt/cdr/`](../../rclmbt/cdr/) |
| M1-01d0 | Declared zero-tail API and frozen tail-slack evidence | [`tail-slack.json`](../../conformance/cdr/tail-slack.json) |
| M1-01d1 | Corpus fixture bridge into MoonBit white-box tests | [Corpus README d1 table](../../conformance/cdr/README.md#moonbit-white-box-bridge-m1-01d1) |
| M1-01d2 | Semantic decode and exact canonical re-encode (56 fixtures, 18 groups) | [`corpus_semantics_wbtest.mbt`](../../rclmbt/cdr/corpus_semantics_wbtest.mbt) |
| M1-01d3 | Corpus adversarial gate (completion, tails, exact-end declarations, stream bounds, framing) | [`corpus_adversarial_wbtest.mbt`](../../rclmbt/cdr/corpus_adversarial_wbtest.mbt) |

Low-level typed adversarial coverage for illegal booleans, UTF-8, string and wstring faults, Unicode scalar slots, sequence bounds, alignment and allocation ceilings, nesting 64/65, writer atomicity, and unit-level strict/declared tails lives in the focused `*_wbtest.mbt` suites under [`rclmbt/cdr/`](../../rclmbt/cdr/). The corpus adversarial gate composes those APIs over the d1 bridge and d2 decode pipeline and leaves field-codec implementation to those focused suites.

## Verification

Run from the repository root:

```bash
bun run cdr-tail-slack:check
bun run cdr-moonbit-fixtures:check
moon test --frozen --target wasm rclmbt/cdr
moon test --frozen --target wasm
just check
just test
just build
```

## Ownership after completion

- [CDR core contract](../runtime/cdr.md) owns layout rules, error taxonomy, and completion policy.
- [Corpus README](../../conformance/cdr/README.md) owns fixture layout, bridge commands, and d1 size/SHA evidence.
- [rclmbt runtime](../runtime/rclmbt.md) owns package placement and Wasm test surface.
- [Validation](../validation.md) owns phase evidence and release gates.
- [Implementation plan](../../tasks/plan.md) owns remaining M1 work.

## Phase boundary

M1 continues. **M1-02** (generated types and schema-identity registry) and **M1-03** (Wasm host ABI and executor poll loop) are the next consumers of this core. The M1 phase gate stays open until graph, transport, SDK, and qualification work land.
