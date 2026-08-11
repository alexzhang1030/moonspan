# R2WP v0 test fixtures

Versioned R2WP v0 fixture corpora for wire version 0. Aggregate write/check ownership
lives in [`scripts/protocol-fixtures.ts`](../../scripts/protocol-fixtures.ts) and runs
exactly once per corpus in order `valid_boundary → malformed → sequences → parity`.
Standalone scripts remain available for each corpus.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Valid/boundary index: id, kind, path, lengths, SHA-256, coverage, executable tagged semantic `source`, expected success and roundtrip mode |
| `valid/*.bin` | Materialized exact wire bytes for small and medium valid/boundary fixtures |
| `malformed/` | Static malformed wire corpus (M0-03e1); own manifest + `*.bin` |
| `sequences/` | Receiver state-sequence corpus (M0-03e2); scenarios + events |
| `parity.json` | Dual-transport parity corpus (M0-03e3); shared artifact identities + transport rule matrix |

## Representations (valid/boundary)

**Entry `representation` controls committed full-wire storage for valid/boundary fixtures:**

| `representation` | Committed wire | Typical use |
|---|---|---|
| `binary` | `valid/<id>.bin` exact bytes | Small/medium frames and bootstrap records |
| `segment_recipe` | Manifest-only wire storage (`path` is `null`) | Full-wire 64 MiB application payload |

**Nested semantic recipes** (inside `source`) compact repeated byte values for
`binary` entries that still commit exact wire under `valid/`. Examples: the 1 MiB
SchemaAdvertise description and the 4092-byte unknown noncritical extension value use

```json
{ "$type": "recipe", "kind": "pattern_fill", "pattern_hex": "42", "length": 1048452 }
```

The generator expands those recipes when encoding wire bytes; the committed `.bin`
is still exact. The 64 MiB fixture is manifest-only: nested recipe plus entry
`representation: "segment_recipe"`.

```json
{
  "$type": "recipe",
  "kind": "pattern_fill",
  "pattern_hex": "a55a",
  "length": 67108864
}
```

The checker materializes recipes in memory, encodes the full selected-version
frame, and verifies `payload_length`, full-frame `byte_length`, and `sha256`.

## Tagged semantic JSON (valid/boundary)

Executable closed tags for valid/boundary encode inputs:

| Tag | Meaning |
|---|---|
| `{ "$type": "bytes", "hex": "..." }` | Byte string (lowercase hex) |
| `{ "$type": "bigint", "value": "..." }` | Arbitrary-precision integer (decimal string) |
| `{ "$type": "map", "entries": [[k,v], ...] }` | CBOR/control map with numeric keys |
| `{ "$type": "recipe", ... }` | Deterministic byte materialization |
| `{ "$type": "bootstrap", ... }` | Bootstrap encode input (camelCase fields) |
| `{ "$type": "frame", ... }` | Frame encode input |

## Roundtrip modes (valid/boundary)

| Mode | Rule |
|---|---|
| `decode-reencode` | Decode committed/reconstructed bytes, encode again, require exact byte equality |
| `source-reencode` | Reconstruct from `source`, require decode success, and source encode equality (used when the decoder intentionally skips valid wire detail such as unknown noncritical TLVs, or for the 64 MiB recipe) |

## Commands

Aggregate (M0-03e3 owner: `scripts/protocol-fixtures.ts`):

```bash
bun run protocol-fixtures:write   # valid_boundary → malformed → sequences → parity
bun run protocol-fixtures:check   # same order, exactly once each
bun run test:protocol-fixtures    # four test files exactly once, fixed order
```

Root `bun run check` and `just check` run aggregate `protocol-fixtures:check`
after `protocol-check`. Aggregate ownership lives in `scripts/protocol-fixtures.ts`
and covers valid_boundary, malformed, sequences, and parity in that fixed order.

Standalone corpus commands (complete write/check surface):

```bash
bun run protocol-malformed-fixtures:write
bun run protocol-malformed-fixtures:check
bun test scripts/protocol-malformed-fixtures.test.ts
just protocol-malformed-fixtures-write
just protocol-malformed-fixtures-check

bun run protocol-sequence-fixtures:write
bun run protocol-sequence-fixtures:check
bun test scripts/protocol-sequence-fixtures.test.ts
just protocol-sequence-fixtures-write
just protocol-sequence-fixtures-check

bun run protocol-parity-fixtures:write
bun run protocol-parity-fixtures:check
bun test scripts/protocol-parity-fixtures.test.ts
just protocol-parity-fixtures-write
just protocol-parity-fixtures-check
```

`parity.json` indexes the exact union of 20 valid/boundary fixture identities and
26 sequence event identities with WebTransport and binary_wss transport refs that
must share semantic identity, length, and SHA-256. A separate `transport_rules`
matrix (20 rows) covers dual-transport semantics (topic/service/action reliability
paths, WSS one-frame/latest-wins/HOL evidence) and is cross-bound to
`protocol/registry/r2wp-v0.json`.

**Counts (M0-03e review Accept):** malformed 55 fixtures; sequences 13 scenarios /
26 events; parity 46 shared identities + 20 rules. Commits `3600ff4`, `63f21df`,
`154afb1`. Aggregate two-write parity SHA-256
`d75d07e46f878be00bb05fd395ccec768ad52950f749cad8b9fcd28a208f80c9`. Phase-one rows
remain H-FT, H-CY, J-FT, and J-CY.

## Coverage highlights (valid/boundary)

- ClientHello at list/field maxima (16 wire versions, u32/u64 requested limits, 64 caps)
- ServerHello effective limit ceilings
- BootstrapError message/detail exactly 4096 UTF-8 bytes
- SessionReady for H-FT, H-CY, J-FT, J-CY exact support-row triples; TRACE on H-FT
- SchemaRequest for `rep2011-rihs` and `moonspan-schema-v1`
- ROS_SAMPLE channel/sequence/time/flags/priority/clock boundaries
- MEDIA_CHUNK KEYFRAME with deterministic CBOR application payload
- SERVICE_REQUEST with TRACE_CONTEXT + OPERATION_ID
- Extension area exactly 4096 bytes (unknown noncritical TLV; source-reencode)
- CONTROL_CBOR payload exactly 1 MiB
- Application payload exactly 64 MiB (segment recipe)
