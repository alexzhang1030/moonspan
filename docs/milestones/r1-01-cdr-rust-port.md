# R1-01: Rust CDR core port

Status: Complete. Ports the frozen [CDR contract](../runtime/cdr.md) into `rclweb` and proves it against the committed ROS corpus.

## Outcome

`rclweb::cdr` implements a bounded CDR1 reader and writer with semantic primitives, Char8 strings, ROS legacy wstring, sequences, nesting tokens, and declared zero-tail completion. Hand-written typed codecs decode and re-encode all 56 corpus fixtures field-by-field; the adversarial gate covers strict vs declared completion, tail mutations, stream bounds, and PointCloud2 borrowed-budget independence.

## Delivered scope

| Surface | Location |
|---|---|
| Codec API (`CdrReader` / `CdrWriter` / `CdrLimits` / `CdrError`) | [`rclweb/src/cdr/`](../../rclweb/src/cdr/) |
| Focused unit tests | [`rclweb/src/cdr/tests.rs`](../../rclweb/src/cdr/tests.rs) |
| Corpus semantic gate (56 fixtures, 18 comparison groups) | [`rclweb/tests/cdr_corpus.rs`](../../rclweb/tests/cdr_corpus.rs) |
| Corpus adversarial gate | [`rclweb/tests/cdr_adversarial.rs`](../../rclweb/tests/cdr_adversarial.rs) |
| Shared typed codecs | [`rclweb/tests/common/mod.rs`](../../rclweb/tests/common/mod.rs) |

## Acceptance evidence

Frozen counts asserted in-gate: **56** fixtures, **18** comparison groups, tail distribution **24×0 / 12×4 / 20×12**, **288** nonzero tail-byte mutations.

```bash
just check
just test
just build
```

Corpus-focused:

```bash
cargo test -p rclweb --test cdr_corpus --test cdr_adversarial
cargo test -p rclweb --lib cdr::
```

## Ownership after completion

- [CDR core contract](../runtime/cdr.md) owns layout rules, error taxonomy, and completion policy (unchanged by this port).
- [Corpus README](../../conformance/cdr/README.md) owns fixture layout and commands.
- [`rclweb` core](../runtime/core.md) owns the Rust implementation and Wasm build.
- [Implementation plan](../../tasks/plan.md) owns remaining R1 work.
