# Generated types and schema registry

Authoritative runtime contract for Moonspan generated types and the schema-identity registry (M1-02). Consumes the [CDR core contract](./cdr.md). Schema identity strategy remains [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).

## Purpose

M1-02 turns the committed authoritative ROS corpus into production MoonBit models, CDR1 codecs, and a dual-scheme schema registry. The browser runtime resolves schema material by identity before channel activation, encodes and decodes sample payloads with `cdr_mbt`, and applies the committed top-level zero-tail declaration per support row. Dynamic type description and lazy field projection belong to M2.

## Delivery batches

| ID | Scope |
|---|---|
| **M1-02a** | Contract freeze (this document) and task routing |
| **M1-02b** | Deterministic Bun generator (`--write` / `--check`) and committed generated MoonBit artifacts |
| **M1-02c** | Production MoonBit models and CDR1 codecs for the nine authoritative corpus roots plus shared dependencies |
| **M1-02d** | Dual-scheme registry, Jazzy RIHS provenance, lookup with support-row zero-tail |
| **M1-02e** | Corpus, adversarial, and public completion gate |

Do not start M1-02b until M1-02a is accepted.

## Authoritative inputs

Generation and registry construction read only committed corpus material under [`conformance/cdr/`](../../conformance/cdr/):

| Input | Role |
|---|---|
| Canonical recursive bundles (`fixtures/bundles/`) | Interface text and dependency graph for each root |
| Corpus manifest (`manifest.json`) | Fixture index, type names, scheme/value pairs, encoding, schema generation, support rows |
| Tail-slack evidence (`tail-slack.json`) | Committed expected top-level zero-tail length per fixture / row |
| Jazzy RIHS mapping (`fixtures/provenance/jazzy-rihs-to-bundle.json`) | Provenance from `rep2011-rihs` values to bundle digests |

The generator never invents schema text, identities, or tail lengths. Bundle layout, ordering, and hashing stay as frozen by M0-04 and ADR 0007.

## Phase 1 generated surface

The Phase 1 generated surface is the **nine authoritative corpus roots** represented by the 56-fixture corpus:

| Root type name |
|---|
| `moonspan_cdr_interfaces/msg/PrimitiveScalars` |
| `moonspan_cdr_interfaces/msg/NestedSample` |
| `moonspan_cdr_interfaces/msg/Collections` |
| `moonspan_cdr_interfaces/srv/EchoNested_Request` |
| `moonspan_cdr_interfaces/srv/EchoNested_Response` |
| `moonspan_cdr_interfaces/action/MeasureSequence_Goal` |
| `moonspan_cdr_interfaces/action/MeasureSequence_Result` |
| `moonspan_cdr_interfaces/action/MeasureSequence_Feedback` |
| `sensor_msgs/msg/PointCloud2` |

Shared dependencies (for example `builtin_interfaces/msg/Time`, `std_msgs/msg/Header`, `sensor_msgs/msg/PointField`, nested corpus members) generate as supporting models and codecs referenced by those roots. They are not independent Phase 1 registry roots.

**Payload encoding for M1 is CDR1 only.** Encoding identity is the string `CDR1`. XCDR2 remains a follow-on surface with the CDR core.

## Generator contract (M1-02b)

| Rule | Contract |
|---|---|
| Tooling | Bun script with `--write` and `--check` |
| `--write` | Regenerates committed MoonBit artifacts from the authoritative inputs |
| `--check` | Rebuilds in memory (or to a temp path) and requires **byte identity** with the committed output |
| Determinism | Same committed inputs produce identical output bytes |
| Output | Checked-in MoonBit sources (models, codecs, static registry tables). No runtime network or Docker during check |
| Failure | Non-zero exit and a stable diagnostic when inputs are missing, malformed, out of bounds, or output drifts |

Root `bun run check` will include the generator check once M1-02b lands. Exact script and package paths land with that batch.

## Codec contract (M1-02c)

Generated codecs:

- call only the public `cdr_mbt` surface ([CDR core](./cdr.md));
- enforce schema-declared field bounds (string/wstring payload maxima, sequence element maxima, fixed-array counts);
- pass `CdrNesting` tokens through nested aggregates and respect `max_nesting_depth`;
- return borrowed `BytesView` for large binary payloads, including **PointCloud2 `data`**, without copying into temporary owned buffers;
- complete top-level samples with the registry-supplied expected zero-tail via `ensure_complete_with_zero_tail`;
- produce exact canonical encode (zero top-level tail) for Moonspan writers.

Canonical encode remains exact. Cross-row semantic agreement continues to compare decoded logical values, not raw RMW capacity tails.

## SchemaKey

Unified cache and lookup identity:

| Field | Meaning |
|---|---|
| `scheme` | Identity scheme name |
| `value` | Scheme-specific identity string |
| `type_name` | Fully qualified ROS type name |
| `encoding` | Payload encoding (`CDR1` in M1) |
| `schema_generation` | Non-negative generation counter (Phase 1 corpus uses `1`) |

This matches ADR 0007: identity is the pair `(scheme, value)`; full cache identity also carries type name, encoding, and generation.

### Accepted schemes

| Scheme | Value form | Validation |
|---|---|---|
| `moonspan-schema-v1` | SHA-256 of the deterministic canonical bundle bytes | Exactly 64 **lowercase** hex characters |
| `rep2011-rihs` | REP-2011 RIHS string | Exact `RIHS01_` prefix plus 64 **lowercase** hex characters |

Any other scheme, wrong prefix, wrong length, or non-lowercase hex is rejected as an invalid key before registry mutation or lookup success. Uppercase hex is not normalized; it fails validation.

### Eighteen identities, nine descriptors

The committed corpus exposes **18** schema identities (nine roots × two schemes). Both scheme-side keys for a root resolve to the **same** codec descriptor (same models and CDR1 codecs). Scheme values remain independent: a Humble bundle digest is never treated as a RIHS value, and a RIHS value is never treated as a bundle digest.

## Provenance (M1-02d)

Jazzy RIHS-to-bundle records are **provenance only**. They preserve independent identity meaning for cross-version and cross-distro lookup aids. They do not collapse the two schemes into one key space and do not replace either scheme's validation rules.

## Registry behavior

### Lookup

Lookup takes a full `SchemaKey` **and** `support_row_id` (Phase 1 rows: `H-FT`, `H-CY`, `H-ZN`, `J-FT`, `J-CY`, `J-ZN`).

On success the registry returns:

- the codec descriptor for the root type;
- the **committed expected top-level zero-tail** length for that type on that support row, taken from row/type evidence in the corpus tail-slack overlay (Phase 1 values `0`, `4`, or `12`).

### Missing material

When required schema material is absent, the runtime returns **`schema_unavailable` before channel activation**. No channel enters an active data path without a resolved descriptor and expected tail.

### Registration

| Case | Result |
|---|---|
| Register the same key with identical descriptor and tail material | **Idempotent success** |
| Register the same key with conflicting descriptor, provenance, or tail material | **Typed conflict** (`schema_conflict`) |
| Register an invalid key | **Typed invalid key** (`invalid_schema_key`) |

### Static M1 vs dynamic M2

The M1 generated registry is **static and finite**: built from the committed Phase 1 surface and loaded as generated tables. Runtime mutation beyond idempotent replay of the same frozen set is out of scope for M1. **M2 owns dynamic projection** (runtime type descriptions, lazy field plans, and open-ended registration of custom types).

## Bounded limits

Generator and registry enforce explicit absolute Phase 1 ceilings. Construction or load outside a ceiling yields a typed bounds fault; partial conflicting state is not committed.

| Limit | Absolute Phase 1 range | Role |
|---|---|---|
| `max_registry_entries` | `1..=256` | Distinct `SchemaKey` rows |
| `max_sources_per_bundle` | `1..=64` | Source entries in one recursive bundle |
| `max_dependency_edges` | `0..=256` | Edges in one bundle dependency graph |
| `max_source_bytes` | `1..=1_048_576` | UTF-8 bytes of one source entry's content |
| `max_scheme_chars` | `1..=64` | `SchemaKey.scheme` length |
| `max_value_chars` | `1..=128` | `SchemaKey.value` length |
| `max_type_name_chars` | `1..=256` | `SchemaKey.type_name` length |
| `max_encoding_chars` | `1..=32` | `SchemaKey.encoding` length |
| `max_support_row_id_chars` | `1..=16` | Lookup `support_row_id` length |

The Phase 1 generated surface sits well inside these ceilings. Raising a ceiling is a contract revision.

## Typed errors

Public schema and generation faults (stable codes). Codec field faults remain [`CdrError`](./cdr.md#typed-error-taxonomy-cdrmbt).

| Code | When it surfaces |
|---|---|
| `invalid_schema_key` | Scheme not accepted; value fails exact form/lowercase hex rules; encoding or generation invalid; a key field exceeds its length ceiling |
| `schema_unavailable` | Required descriptor, bundle, provenance, or support-row tail material is missing at lookup or channel setup |
| `schema_conflict` | Registration of an existing key with non-identical material |
| `schema_bounds_exceeded` | Generator or registry would exceed an absolute limit (entries, sources, edges, source bytes, or input lengths) |
| `schema_input_invalid` | Authoritative input is malformed or fails deterministic parse (bundle, manifest, tail-slack, or RIHS map) |
| `schema_generation_drift` | `--check` output is not byte-identical to the committed artifact |

Error payloads carry the fault code and enough stable context for diagnostics (offending field name, limit name, and sizes when applicable). They do not embed full schema source text.

## Acceptance evidence (M1-02e)

| Gate | Evidence |
|---|---|
| Generator identity | `bun run <generator>:check` (name lands in M1-02b) is byte-stable on a clean tree |
| Nine-root codecs | MoonBit/Wasm tests decode and exact-encode every corpus fixture for the nine roots |
| Dual-scheme resolve | All 18 identities resolve to the nine descriptors; invalid keys and missing material fault correctly |
| Provenance | Jazzy RIHS map loads as provenance; schemes stay independent |
| Zero-tail | Lookup with each support row returns the committed expected tail; declared completion matches corpus evidence |
| Registration | Identical re-registration succeeds; conflicting registration returns `schema_conflict` |
| Bounds | Over-limit entries, sources, edges, source bytes, and lookup strings return `schema_bounds_exceeded` or `invalid_schema_key` |
| Adversarial | Malformed keys, missing material before activation, and codec bound violations stay typed |
| Public surface | Focused package tests plus root `just check`, `just test`, and `just build` when implementation completes |

## Ownership

| Concern | Owner |
|---|---|
| This contract | `docs/runtime/generated-types.md` |
| CDR layout and codec faults | [CDR core](./cdr.md) |
| Schema identity strategy | [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md) |
| Corpus layout and bridge commands | [Corpus README](../../conformance/cdr/README.md) |
| Runtime package placement | [`rclmbt`](./rclmbt.md) |
| Phase evidence | [Validation](../validation.md) |
| Task state | [Implementation plan](../../tasks/plan.md), [execution checklist](../../tasks/todo.md) |

## Out of scope for M1-02

- Dynamic type descriptions and lazy projection (M2-01)
- Wasm host buffer leases and poll ABI (M1-03)
- Gateway schema cache implementation details beyond shared `SchemaKey` identity
- XCDR2 payload codecs
- Studio or application-level type browsers
