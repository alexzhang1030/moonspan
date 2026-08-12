# M1-01: MoonBit CDR core

Status: Complete (historical). This note records the pre-restructure milestone. The MoonBit implementation it references was retired by [ADR 0010](../adr/0010-restructure-single-rust-core.md) and lives at tag `pre-restructure`; the [CDR contract](../runtime/cdr.md), the corpus, and the tail-slack evidence survive as the oracle for the Rust port (R1-01).

## Outcome

`cdr_mbt` (`rclmbt/cdr` at tag `pre-restructure`) implemented a bounded CDR1 reader and writer with semantic primitives, Char8 strings, ROS legacy wstring, containers, nesting tokens, and top-level declared zero-tail completion. The authoritative ROS corpus was bridged into package-internal white-box tests, decoded and re-encoded field-by-field, and gated adversarially for completion, resource bounds, and framing faults. This proof established that the contract and corpus are implementable and complete; the Rust port must reproduce it.

## Delivered scope

| Batch | Outcome | Record |
|---|---|---|
| M1-01a | CDR core contract freeze | [CDR core contract](../runtime/cdr.md) |
| M1-01b | Bounded stream reader/writer, encapsulation, limits, typed errors | `rclmbt/cdr/` at tag `pre-restructure` |
| M1-01c | Primitives, strings/wstrings, containers, nesting, borrowed views | `rclmbt/cdr/` at tag `pre-restructure` |
| M1-01d0 | Declared zero-tail API and frozen tail-slack evidence | [`tail-slack.json`](../../conformance/cdr/tail-slack.json) |
| M1-01d1 | Corpus fixture bridge into white-box tests | `rclmbt/cdr/fixture_data_wbtest.mbt` at tag `pre-restructure` |
| M1-01d2 | Semantic decode and exact canonical re-encode (56 fixtures, 18 groups) | `rclmbt/cdr/corpus_semantics_wbtest.mbt` at tag `pre-restructure` |
| M1-01d3 | Corpus adversarial gate (completion, tails, exact-end declarations, stream bounds, framing) | `rclmbt/cdr/corpus_adversarial_wbtest.mbt` at tag `pre-restructure` |

## Verification (current form)

```bash
bun run cdr-corpus:check
bun run cdr-tail-slack:check
```

The MoonBit test suites ran green at tag `pre-restructure` (`moon test --frozen --target wasm`).

## Ownership after completion

- [CDR core contract](../runtime/cdr.md) owns layout rules, error taxonomy, and completion policy.
- [Corpus README](../../conformance/cdr/README.md) owns fixture layout and commands.
- [`rclweb` core](../runtime/core.md) owns the Rust port and its Wasm test surface.
- [Validation](../validation.md) owns phase evidence and release gates.
- [Implementation plan](../../tasks/plan.md) owns remaining work.
