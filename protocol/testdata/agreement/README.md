# R2WP v0 cross-language agreement

M0-03h delivers the **cross-language agreement contract** for R2WP wire version 0.
TypeScript, Rust (`rclwebd`), and MoonBit (`rclmbt`) project the same committed
fixture corpora into one canonical outcome document and prove exact canonical
outcome agreement through a triple-language gate.

| Artifact | Role |
|---|---|
| [`expected.json`](./expected.json) | Committed TypeScript expected corpus: 101 outcomes + 46 dual-transport parity bindings |
| [`report.json`](./report.json) | Committed three-language agreement report from the orchestrator |

## Coverage

| Surface | Count |
|---|---:|
| Valid/boundary outcomes | 20 |
| Sequence event outcomes | 26 |
| Malformed outcomes | 55 |
| **Total outcomes** | **101** |
| Success outcomes | 46 |
| Error outcomes | 55 |
| Parity shared identities (WT equals binary WSS) | 46 |
| Parity transport rules (summary provenance) | 20 |
| Phase 1 SessionReady triples | H-FT, H-CY, J-FT, J-CY |
| Implementation order | typescript → rust → moonbit |

## Authoritative commands

```bash
bun run protocol-agree          # check (default): reconstruct expected, spawn Rust + MoonBit emitters, verify report
bun run protocol-agree:write    # regenerate protocol/testdata/agreement/report.json
bun run test:protocol-agree     # focused orchestrator suite
just protocol-agree             # toolchain-check, then bun run protocol-agree
just protocol-agree-write       # toolchain-check, then bun run protocol-agree:write
```

Root `bun run check` runs `docs:check`, `protocol-check`, aggregate
`protocol-fixtures:check`, `protocol-moonbit-fixtures:check`, then
`protocol-agree:check` exactly once. `just check` invokes that same `bun run check`
chain after toolchain identity.

Underlying scripts and emitters:

- [`scripts/protocol-agree.ts`](../../../scripts/protocol-agree.ts) — TypeScript expected-corpus projection and diagnostics
- [`scripts/protocol-agree-run.ts`](../../../scripts/protocol-agree-run.ts) — three-language orchestrator (`--check` / `--write`)
- Rust emitter: integration test [`rclwebd/tests/protocol_agreement.rs`](../../../rclwebd/tests/protocol_agreement.rs), invoked by the locked cargo test command `cargo test --locked -p rclwebd --test protocol_agreement` with emit mode (`MOONSPAN_PROTOCOL_AGREE_EMIT=1`)
- MoonBit emitter: executable package [`rclmbt/cmd/agree/`](../../../rclmbt/cmd/agree/), invoked by `moon run --frozen --release --target wasm rclmbt/cmd/agree`

## Outcome projection

- Stable corpus-qualified `id` (`valid_boundary:…`, `sequences:…`, `malformed:…`)
- `parser_kind` `bootstrap` | `frame`, representation, `byte_length`, verified `input_sha256`
- Success records use compact snake_case semantics
- Application payload stores `payload_len`, `payload_fnv1a64_hex`, and fixed short head/tail hex
- CONTROL payload stores wire `payload_len` / `payload_fnv1a64_hex`, `control_kind`,
  sorted `control_field_keys`, and a full recursive `control_fields` CBOR projection
  (decimal integer strings; text and bytes carry length + `fnv1a64_hex` with a small
  fixed inline bound or null)
- Large bootstrap optional text stores UTF-8 length plus `fnv1a64_hex`
- Malformed outcomes store registry `code`, `name`, `reason`, absolute `offset`,
  `plane`, and `step`
- Digest field names use **fnv1a64**. The 64 MiB application payload FNV-1a
  digests to `3a07afcfc8222325`
- Source manifests are closed-validated before projection; sequence `carrier`
  selects bootstrap versus frame; valid frames reconstruct through
  `encodeFixtureSource`
- Parity bindings cross-reference each shared artifact to exactly one success
  outcome with matching length and SHA-256
- Deterministic multi-line JSON uses path and content digests for provenance; large values use length plus fnv1a64 digests

## Provenance

`sources` records path + SHA-256 for valid, malformed, sequences, parity, and
registry inputs. `phase_one_triples` records the decoded SessionReady
`(support_row_id, ros_distro, rmw_identifier)` set for H-FT, H-CY, J-FT, and J-CY.

## Accepted report digests (M0-03h4)

| Field | Value |
|---|---|
| `report.json` size | 234265 bytes |
| `report.json` SHA-256 | `e1295ab1ee56c83a3c3e8e5ada6699fdc7b693b86bd9dc399f07a00ccc8753d4` |
| Outcomes total / success / error | 101 / 46 / 55 |
| Implementation order | typescript, rust, moonbit |
| Outcomes SHA-256 | `d22a58fbed0c2612f6c00901053a492f5c03ec76fcd4689fa1542aa002e2e220` |
| Canonical SHA-256 | `cece56e1c70fc741f30e54dee9b35d6ed024992be83b6dbe8a4b31c183724341` |
| Expected raw SHA-256 | `6193eda2bc6916796515ee6dfb1543a811be46f07a76d5a00cf8acf095fcb717` |
| Transport bindings SHA-256 | `d4489d75e6146ed20d9bfe4d80fbcc6fe671b29c0fdfd86009995aa328ba119d` |
| WT/WSS shared identities | 46 |
| Transport rules | 20 |
| Phase 1 rows | H-FT, H-CY, J-FT, J-CY |

## Delivery commits (h1–h4)

| Slice | Commit | Subject |
|---|---|---|
| h1 expected corpus | `72ccd28b53820af9c3dd015b9be77a35aa6371b6` | `test(protocol): add r2wp agreement corpus` |
| h2 Rust emitter | `33c947414110fee47fa96429a70e795a645cc5cb` | `test(rclwebd): emit r2wp agreement outcomes` |
| h3 MoonBit emitter | `9fa91a4f9f956670368b0d36783991312f0e6900` | `test(rclmbt): emit r2wp agreement outcomes` |
| h4 triple-language gate | `da5f28c3e6b9db8b939c2bceee5ba415442358d5` | `test(protocol): gate r2wp cross-language agreement` |

## M0-03h4 verification snapshot

- Focused agreement suite `bun run test:protocol-agree`: 22/22 tests, 94 assertions, exactly two real emitter subprocesses (Rust + MoonBit)
- Full `bun test`: 675/675 with 5228 assertions
- `cargo test --locked -p rclwebd`: 56 passed across 3 suites
- `moon test --frozen --target wasm rclmbt/protocol`: 69/69
- Pinned `just check` status=ok under Bun 1.3.14 / Rust 1.97.1 / moonc 0.10.6+80dc50f24 / just 1.50.0
- Digest-tamper and spawn-exception diagnostics closed
- Worktree and `git diff --check` clean
