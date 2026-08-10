# R2WP v0 test fixtures

Valid and boundary golden fixtures for wire version 0. Generated and checked by
[`scripts/protocol-fixtures.ts`](../../scripts/protocol-fixtures.ts).

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Versioned index of every fixture: id, kind, path, lengths, SHA-256, coverage, executable tagged semantic `source`, expected success and roundtrip mode |
| `valid/*.bin` | Materialized exact wire bytes for small and medium fixtures |
| `malformed/` | Static malformed wire corpus (M0-03e1); own manifest + `*.bin` |

## Representations

**Entry `representation` controls committed full-wire storage:**

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

## Tagged semantic JSON

Executable closed tags for encode inputs:

| Tag | Meaning |
|---|---|
| `{ "$type": "bytes", "hex": "..." }` | Byte string (lowercase hex) |
| `{ "$type": "bigint", "value": "..." }` | Arbitrary-precision integer (decimal string) |
| `{ "$type": "map", "entries": [[k,v], ...] }` | CBOR/control map with numeric keys |
| `{ "$type": "recipe", ... }` | Deterministic byte materialization |
| `{ "$type": "bootstrap", ... }` | Bootstrap encode input (camelCase fields) |
| `{ "$type": "frame", ... }` | Frame encode input |

## Roundtrip modes

| Mode | Rule |
|---|---|
| `decode-reencode` | Decode committed/reconstructed bytes, encode again, require exact byte equality |
| `source-reencode` | Reconstruct from `source`, require decode success, and source encode equality (used when the decoder intentionally skips valid wire detail such as unknown noncritical TLVs, or for the 64 MiB recipe) |

## Commands

```bash
bun run protocol-fixtures:write   # regenerate manifest + valid/*.bin
bun run protocol-fixtures:check   # reconstruct and verify everything
bun test scripts/protocol-fixtures.test.ts
```

Root `bun run check` and `just check` include `protocol-fixtures:check` after
`protocol-check`, then `protocol-malformed-fixtures:check`.

Malformed corpus commands:

```bash
bun run protocol-malformed-fixtures:write
bun run protocol-malformed-fixtures:check
bun test scripts/protocol-malformed-fixtures.test.ts
```

## Coverage highlights

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
