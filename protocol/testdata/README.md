# R2WP v0 test fixtures

These corpora provide the shared executable examples for R2WP v0. TypeScript generates and checks them. Rust and MoonBit consume the same data for parser agreement.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Valid and boundary fixture index with source, expected result, length, digest, and round-trip mode |
| `valid/*.bin` | Materialized valid wire records |
| [`malformed/`](./malformed/README.md) | Invalid wire records and expected registry errors |
| [`sequences/`](./sequences/README.md) | Ordered receiver events and state outcomes |
| `parity.json` | WebTransport and binary WebSocket semantic bindings |
| [`agreement/`](./agreement/README.md) | Expected outcomes and the cross-language report |

## Fixture representation

Valid entries use one of two storage modes:

| Mode | Use |
|---|---|
| `binary` | Commit the exact wire record under `valid/` |
| `segment_recipe` | Reconstruct a large deterministic record from its manifest source |

Manifest sources use closed tagged JSON values for bytes, integers, maps, repeated byte recipes, bootstrap records, and selected-version frames. Recipes keep large repeated payloads compact while preserving deterministic length and digest checks.

Round-trip modes are:

| Mode | Check |
|---|---|
| `decode-reencode` | Decode and encode to the same bytes |
| `source-reencode` | Reconstruct from source, decode successfully, and encode to the same bytes |

## Commands

| Command | Purpose |
|---|---|
| `bun run protocol-fixtures:write` | Regenerate valid, malformed, sequence, and parity corpora |
| `bun run protocol-fixtures:check` | Reconstruct and verify every corpus |
| `bun run test:protocol-fixtures` | Run focused fixture tooling tests |
| `bun run protocol-moonbit-fixtures:write` | Regenerate the MoonBit fixture bridge |
| `bun run protocol-moonbit-fixtures:check` | Verify the MoonBit fixture bridge |
| `bun run protocol-agree` | Verify TypeScript, Rust, and MoonBit outcomes |
| `bun run protocol-agree:write` | Regenerate the agreement report |

Standalone write and check scripts remain available for malformed, sequence, and parity corpora through the root `package.json` and `justfile`.

## Invariants

- Fixture IDs and paths are canonical and closed to the declared manifest.
- Lengths and content digests are verified before semantic comparison.
- Construction recipes are deterministic and allocation-bounded.
- Expected errors bind to the registry code, name, location, plane, and validation step.
- Receiver scenarios apply decoded wire events to a deterministic state machine.
- Transport parity maps both transports to the same semantic identity.
- Phase 1 session fixtures cover H-FT, H-CY, J-FT, and J-CY.

## Consumers

| Consumer | Source |
|---|---|
| TypeScript codecs and oracle | [`sdk/typescript/src/protocol/`](../../sdk/typescript/src/protocol/), [`scripts/`](../../scripts/) |
| Rust parser and emitter | [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/), [`rclwebd/tests/protocol_agreement.rs`](../../rclwebd/tests/protocol_agreement.rs) |
| MoonBit parser and emitter | [`rclmbt/protocol/`](../../rclmbt/protocol/), [`rclmbt/cmd/agree/`](../../rclmbt/cmd/agree/) |

The corpora cover valid and boundary records, malformed input, receiver state, transport parity, schema identities, Phase 1 support rows, control messages, application data, media, operations, and size boundaries. [`report.json`](./agreement/report.json) contains the complete current result.
