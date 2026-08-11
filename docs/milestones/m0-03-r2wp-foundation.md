# M0-03 — R2WP v0 foundation

**Status:** Complete  
**Completion revision:** `5e1edc2`  
**Recorded:** 2026-08-11  
**Phase status:** M0 remains active.

## Outcome

R2WP wire version 0 now has one frozen contract and three agreeing implementations. TypeScript owns the browser codecs and expected outcomes; Rust and MoonBit provide independent reference parsers. All three consume the same committed fixture corpora and produce one canonical agreement report.

## Delivered scope

| Batch | Outcome | Canonical record | Delivery revisions |
|---|---|---|---|
| M0-03a | Normative wire contract, registry, CONTROL CDDL, ADR 0009 | [R2WP v0 contract](../../protocol/r2wp-v0.md), [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md) | `3b97d2e` |
| M0-03b | Contract validator and root command integration | [`scripts/protocol-check.ts`](../../scripts/protocol-check.ts) | `6469faa`, `afdb7e1` |
| M0-03c | Deterministic TypeScript CBOR subset | [`cbor.ts`](../../sdk/typescript/src/protocol/cbor.ts) | `6979be7`, `6c46cf6` |
| M0-03d | TypeScript bootstrap, extension, CONTROL, and selected-frame codecs; valid/boundary fixtures | [TypeScript protocol modules](../../sdk/typescript/src/protocol/), [fixture manifest](../../protocol/testdata/manifest.json) | `5c21f74`, `48dfbdd`, `51a5d73`, `193b279`, `f992feb`, `fc18b3d` |
| M0-03e | Malformed wire, receiver sequences, and WT/WSS parity corpora | [Fixture reference](../../protocol/testdata/README.md) | `3600ff4`, `63f21df`, `154afb1` |
| M0-03f | Rust bootstrap and selected-frame reference parser | [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) | `9c07b4a`, `cca270c` |
| M0-03g | MoonBit bootstrap and selected-frame reference parser with borrowed payload views | [`rclmbt/protocol/`](../../rclmbt/protocol/) | `2f7352f`, `1157138`, `0c5e4d2`, `133fd9f` |
| M0-03h | TypeScript/Rust/MoonBit outcome agreement and committed report | [Agreement reference](../../protocol/testdata/agreement/README.md) | `72ccd28`, `33c9474`, `9fa91a4`, `da5f28c` |

## Coverage snapshot

| Surface | Accepted coverage |
|---|---:|
| Valid/boundary entries | 20 |
| Malformed fixtures | 55: 14 bootstrap, 41 selected-frame |
| Receiver sequences | 13 scenarios, 26 events |
| WT/WSS parity | 46 shared identities, 20 registry-bound rules |
| Agreement outcomes | 101: 46 success, 55 error |
| Bootstrap validation | Steps 1–9 |
| Selected-frame validation | Steps 1–16 |
| CONTROL kinds | 15 |
| Phase 1 support rows | H-FT, H-CY, J-FT, J-CY |

The accepted agreement artifact is [`protocol/testdata/agreement/report.json`](../../protocol/testdata/agreement/report.json): 234265 bytes with SHA-256 `e1295ab1ee56c83a3c3e8e5ada6699fdc7b693b86bd9dc399f07a00ccc8753d4`. The [agreement reference](../../protocol/testdata/agreement/README.md#accepted-report-digests-m0-03h4) owns the complete digest set for outcomes, canonical projection, expected input, and transport bindings.

## Completion verification

| Check | Accepted local result |
|---|---|
| `bun run protocol-check` | Frozen contract validated |
| `bun run protocol-fixtures:check` | Four corpora reconstructed and verified in canonical order |
| `bun run test:protocol-agree` | 22/22 tests, 94 assertions, two external emitter processes |
| `bun test` | 675/675 tests, 5228 assertions |
| `cargo test --locked -p rclwebd` | 56 tests across 3 suites |
| `moon test --frozen --target wasm rclmbt/protocol` | 69/69 tests |
| `just check` | Passed with the pinned Bun, Rust, MoonBit, and just toolchains |

The completion snapshot records local reproducibility. The foundation CI workflow will add hosted run URLs and uploaded artifacts through M0-02.

## Ownership after completion

- [R2WP protocol](../protocol/r2wp.md) owns design, wire semantics, and implementation routes.
- [Fixture reference](../../protocol/testdata/README.md) owns corpus layout, counts, generators, and check commands.
- [Agreement reference](../../protocol/testdata/agreement/README.md) owns report structure, accepted digests, emitter commands, and delivery revisions.
- [Validation](../validation.md) owns evidence requirements and phase gates.
- [Implementation plan](../../tasks/plan.md) owns remaining work and dependencies.

## Phase boundary

M0-03 completes the R2WP v0 foundation work item. The M0 phase continues through M0-01 decisions, M0-02 hosted workflow evidence, M0-04 ROS CDR corpus work, M0-05 evidence schema work, and the human M0 gate decision.

Phase 1 qualifies Humble and Jazzy rows H-FT, H-CY, J-FT, and J-CY. Later matrix revisions own Jazzy+ expansion. The common Studio prototype starts at U0 after the M3 mainline release gate.
