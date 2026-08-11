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
| `agreement/` | Cross-language agreement expected corpus and three-language report (M0-03h); see [agreement/README.md](./agreement/README.md) |

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

Root `bun run check` runs `docs:check`, then `protocol-check`, then aggregate
`protocol-fixtures:check`, then `protocol-moonbit-fixtures:check`, then
`protocol-agree:check` exactly once. `just check` invokes that same
`bun run check` chain after toolchain identity. Aggregate ownership lives in
`scripts/protocol-fixtures.ts` and covers valid_boundary, malformed, sequences,
and parity in that fixed order.

MoonBit fixture bridge (M0-03g1 owner: `scripts/protocol-moonbit-fixtures.ts`),
after the aggregate fixture check in root `bun run check`:

```bash
bun run protocol-moonbit-fixtures:write   # regenerate rclmbt/protocol/fixture_data_wbtest.mbt
bun run protocol-moonbit-fixtures:check   # reconstruct/verify the bridge source
bun run test:protocol-moonbit-fixtures    # focused bridge suite
bun test scripts/protocol-moonbit-fixtures.test.ts
```

Cross-language agreement (M0-03h owner: `scripts/protocol-agree-run.ts`), after
the MoonBit fixture bridge check in root `bun run check`:

```bash
bun run protocol-agree          # check: TypeScript expected + Rust/MoonBit emitters + report
bun run protocol-agree:write    # regenerate protocol/testdata/agreement/report.json
bun run test:protocol-agree     # focused orchestrator suite
just protocol-agree
just protocol-agree-write
```

Agreement layout and commands: [agreement/README.md](./agreement/README.md).

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

## Consumers and agreement

**Current corpus counts:** 20 valid/boundary entries; 55 malformed fixtures
(14 bootstrap / 41 selected-frame); 13 receiver scenarios / 26 events; 46
shared WT/WSS identities; 20 registry-bound transport rules. Phase 1 fixtures
cover H-FT, H-CY, J-FT, and J-CY.

**Rust consumer:** [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) loads
the valid/boundary and malformed corpora through locked crate tests. It covers
bootstrap steps 1-9, selected-frame steps 1-16, the 64 MiB segment recipe, and
exact error code/name/reason/offset/plane/step outcomes. The integration test
[`rclwebd/tests/protocol_agreement.rs`](../../rclwebd/tests/protocol_agreement.rs)
emits the Rust agreement projection.

**MoonBit consumer:** [`rclmbt/protocol/`](../../rclmbt/protocol/) loads the same
corpora through `fixture_data_wbtest.mbt`. It covers the same validation steps,
deterministic CBOR, extension TLVs, all 15 CONTROL kinds, integer header bounds,
and borrowed extension/application `BytesView` payloads. The executable package
[`rclmbt/cmd/agree/`](../../rclmbt/cmd/agree/) emits the MoonBit agreement
projection.

**Cross-language agreement:** [`agreement/`](./agreement/) holds the TypeScript
expected corpus and the TypeScript/Rust/MoonBit report. The [agreement
reference](./agreement/README.md) owns report fields, digests, emitter commands,
and delivery revisions. The [M0-03 completion
record](../../docs/milestones/m0-03-r2wp-foundation.md) owns the accepted delivery
snapshot and phase boundary.

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
