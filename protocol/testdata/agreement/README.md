# R2WP v0 agreement expected corpus

M0-03h1 establishes the **TypeScript expected-corpus slice** for cross-language
agreement. The committed multi-line file [`expected.json`](./expected.json)
holds 101 canonical parse outcomes plus 46 dual-transport parity bindings.

Rust and MoonBit adapters and the full three-language gate remain active in
later M0-03h batches.

## Coverage

| Surface | Count |
|---|---:|
| Valid/boundary outcomes | 20 |
| Sequence event outcomes | 26 |
| Malformed outcomes | 55 |
| **Total outcomes** | **101** |
| Parity shared identities (WT equals binary WSS) | 46 |
| Parity transport rules (summary provenance) | 20 |
| Phase 1 SessionReady triples (decoded fields) | H-FT, H-CY, J-FT, J-CY |

## Commands (h1)

```bash
bun run scripts/protocol-agree.ts --write-expected
bun run scripts/protocol-agree.ts --check-expected
bun test scripts/protocol-agree.test.ts
```

Root `package.json` / `justfile` wiring for agreement lands with later h batches.
Root `bun run check` is unchanged in h1.

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
`(support_row_id, ros_distro, rmw_identifier)` set.
