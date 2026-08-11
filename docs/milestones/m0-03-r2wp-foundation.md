# M0-03: R2WP v0 foundation

Status: Complete. M0 remains active.

## Outcome

R2WP wire version 0 has a frozen contract and agreeing TypeScript, Rust, and MoonBit implementations. They consume the same fixtures and produce one canonical agreement report.

## Delivered scope

| Batch | Outcome | Record |
|---|---|---|
| M0-03a | Normative wire contract and registry | [R2WP v0 contract](../../protocol/r2wp-v0.md), [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md) |
| M0-03b | Contract validator and root command | [`scripts/protocol-check.ts`](../../scripts/protocol-check.ts) |
| M0-03c | Deterministic TypeScript CBOR subset | [`cbor.ts`](../../sdk/typescript/src/protocol/cbor.ts) |
| M0-03d | TypeScript protocol codecs and valid fixtures | [TypeScript protocol modules](../../sdk/typescript/src/protocol/) |
| M0-03e | Malformed, sequence, and transport parity fixtures | [Fixture reference](../../protocol/testdata/README.md) |
| M0-03f | Rust reference parser | [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) |
| M0-03g | MoonBit reference parser | [`rclmbt/protocol/`](../../rclmbt/protocol/) |
| M0-03h | Cross-language agreement gate | [Agreement reference](../../protocol/testdata/agreement/README.md) |

## Verification

The fixture corpus covers valid messages, boundary values, malformed input, receiver sequences, and both Phase 1 transports. Run these checks from the repository root:

```bash
bun run protocol-check
bun run protocol-fixtures:check
bun run protocol-agree
cargo test --locked -p rclwebd
moon test --frozen --target wasm rclmbt/protocol
```

[`report.json`](../../protocol/testdata/agreement/report.json) contains the detailed machine-readable result.

## Ownership after completion

- [R2WP protocol](../protocol/r2wp.md) owns the design and wire semantics.
- [Fixture reference](../../protocol/testdata/README.md) owns corpus layout and commands.
- [Agreement reference](../../protocol/testdata/agreement/README.md) owns report structure and emitter commands.
- [Validation](../validation.md) owns evidence requirements and phase gates.
- [Implementation plan](../../tasks/plan.md) owns remaining work.

## Phase boundary

M0 continues with support decisions, hosted workflow evidence, the ROS CDR corpus, the evidence schema, and the phase gate. Phase 1 covers Humble and Jazzy rows H-FT, H-CY, J-FT, and J-CY. Studio starts at U0 after the M3 mainline release gate.
