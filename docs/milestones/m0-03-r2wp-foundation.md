# M0-03: R2WP v0 foundation

Status: Complete (historical). This note records the pre-restructure milestone. The multi-implementation artifacts it references were retired by [ADR 0010](../adr/0010-restructure-single-rust-core.md) and live at tag `pre-restructure`.

## Outcome

R2WP wire version 0 received a frozen contract and agreeing TypeScript, Rust, and MoonBit implementations. They consumed the same fixtures and produced one canonical agreement report. The Rust parser survived the restructure as the seed of the `rclweb` core; the TypeScript and MoonBit parsers and the agreement apparatus were retired.

## Delivered scope

| Batch | Outcome | Record |
|---|---|---|
| M0-03a | Normative wire contract and registry | [R2WP v0 contract](../../protocol/r2wp-v0.md), [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md) |
| M0-03b | Contract validator and root command | [`scripts/protocol-check.ts`](../../scripts/protocol-check.ts) |
| M0-03c | Deterministic TypeScript CBOR subset | `sdk/typescript/src/protocol/cbor.ts` at tag `pre-restructure` |
| M0-03d | TypeScript protocol codecs and valid fixtures | `sdk/typescript/src/protocol/` at tag `pre-restructure` |
| M0-03e | Malformed, sequence, and transport parity fixtures | [Fixture reference](../../protocol/testdata/README.md) (valid and malformed retained; sequences and parity at tag `pre-restructure`) |
| M0-03f | Rust reference parser | now [`rclweb/src/protocol/`](../../rclweb/src/protocol/) |
| M0-03g | MoonBit reference parser | `rclmbt/protocol/` at tag `pre-restructure` |
| M0-03h | Cross-language agreement gate | `protocol/testdata/agreement/` at tag `pre-restructure` |

## Verification (current form)

```bash
bun run protocol-check
cargo test --locked -p rclweb
```

The original agreement report (105 outcomes, canonical SHA-256 recorded in its README) lives at tag `pre-restructure`.

## Ownership after completion

- [R2WP protocol](../protocol/r2wp.md) owns the design and wire semantics.
- [Fixture reference](../../protocol/testdata/README.md) owns corpus layout and commands.
- [Validation](../validation.md) owns evidence requirements and phase gates.
- [Implementation plan](../../tasks/plan.md) owns remaining work.
