# Generated types and schema registry

Authoritative runtime contract for rclweb generated types and the schema-identity registry. The [`rclweb` core](./core.md) implements it in Rust (`rclweb/src/types/`) from Bun-generated metadata under `rclweb/generated/metadata/`. Consumes the [CDR core contract](./cdr.md). Schema identity strategy remains [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md). Payload encoding values follow the R2WP v0 `payload-encoding-cdr` domain ([registry](../../protocol/registry/r2wp-v0.json), [CDDL](../../protocol/schema/control-v0.cddl)).

## Purpose

The generator turns the committed authoritative ROS corpus into production Rust models, CDR1 codecs, and a dual-scheme schema registry. The browser runtime resolves schema material by identity before channel activation, encodes and decodes sample payloads with `rclweb::cdr`, and applies the committed top-level zero-tail declaration from wire-profile resolution metadata. Dynamic type description and lazy field projection remain later work.

## Authoritative inputs

Generation and registry construction read committed corpus material under [`conformance/cdr/`](../../conformance/cdr/):

| Input | Role |
|---|---|
| Canonical recursive bundles (`fixtures/bundles/`) | Interface text and dependency graph for each root |
| Corpus manifest (`manifest.json`) | Fixture index, type names, scheme/value pairs, encoding, schema generation, support rows |
| Tail-slack evidence (`tail-slack.json`) | Committed expected top-level zero-tail length per fixture, support row, and CDR representation |
| Jazzy RIHS mapping (`fixtures/provenance/jazzy-rihs-to-bundle.json`) | Provenance from `rep2011-rihs` values to bundle digests |

The generator derives schema text, identities, and tail lengths exclusively from these inputs. Bundle layout, ordering, and hashing stay as frozen by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md) and the [corpus README](../../conformance/cdr/README.md). **Committed tail-slack evidence is the sole authority** for expected top-level zero-tail lengths.

### Authoritative-input joins and validation

The generator validates every generated root against closed joins. Failure yields `schema_input_invalid` (or `schema_bounds_exceeded` when a ceiling is crossed).

| Rule | Contract |
|---|---|
| Bundle digest identity | SHA-256 of the committed canonical bundle bytes equals the `rclweb-schema-v1` `SchemaKey.value`. Bundle files are named from the root type (`fixtures/bundles/rclweb_cdr_interfaces.msg.PrimitiveScalars.json`), not from the digest. |
| Source type names | Source `type_name` values inside one bundle are unique |
| Root present | Bundle `root_type_name` equals the generated root, and a source entry for that root (or its parent `.srv` / `.action` type for sectioned roots) is present |
| Dependency endpoints | Every `from` and `to` in `dependency_graph` names a source `type_name` present in the same bundle |
| Acyclic graph | The dependency graph for the generated subset is a directed acyclic graph |
| Manifest join | Every corpus fixture row joins to its type, scheme/value, encoding, schema generation, support row, and serialized artifact consistently with the bundle and scheme rules |
| Tail-slack join | Every fixture used for zero-tail resolution joins to a unique tail-slack row for its fixture identity, support row, and CDR representation |
| Provenance join | Every Jazzy `rep2011-rihs` identity for the nine roots joins to exactly one RIHS-to-bundle provenance record whose `bundle_sha256` matches the corresponding `rclweb-schema-v1` digest and `type_name` |
| Deterministic ordering | Sources, dependency edges, identity rows, wire-profile rows, and emitted artifact members use a single stable sort (type name ascending, then scheme, then value, then support row, then representation) so regeneration is byte-identical |

## Generated surface

The generated surface is the **nine authoritative corpus roots** represented by the 56-fixture corpus:

| Root type name |
|---|
| `rclweb_cdr_interfaces/msg/PrimitiveScalars` |
| `rclweb_cdr_interfaces/msg/NestedSample` |
| `rclweb_cdr_interfaces/msg/Collections` |
| `rclweb_cdr_interfaces/srv/EchoNested_Request` |
| `rclweb_cdr_interfaces/srv/EchoNested_Response` |
| `rclweb_cdr_interfaces/action/MeasureSequence_Goal` |
| `rclweb_cdr_interfaces/action/MeasureSequence_Result` |
| `rclweb_cdr_interfaces/action/MeasureSequence_Feedback` |
| `sensor_msgs/msg/PointCloud2` |

Shared dependencies (for example `builtin_interfaces/msg/Time`, `std_msgs/msg/Header`, `sensor_msgs/msg/PointField`, nested corpus members) generate as supporting models and codecs referenced by those roots. Registry roots remain exactly the nine rows above.

**Payload encoding is CDR1.** `SchemaKey.encoding` is the R2WP payload-encoding enum value **`1`** (wire name `CDR1`). CDR1 little-endian and big-endian are wire representations of that encoding (see [Lookup](#lookup)). XCDR2 (`2`) remains a follow-on surface with the CDR core.

## Source generation

### Accepted source encoding

Generation accepts **`ROS2_INTERFACE_TEXT`** source entries. Bundle source encodings outside that domain fail generation with `schema_input_invalid`.

### Interface section selection

Canonical bundles may store the full parent `.srv` or `.action` text under the parent type name while the registry root is a sectioned type (`*_Request`, `*_Response`, `*_Goal`, `*_Result`, `*_Feedback`). The generator selects the active field list as follows.

| Root kind | Source text | Selected section |
|---|---|---|
| `.msg` root (`…/msg/Name`) | Whole `.msg` body | Entire content (comments and blanks follow ROS interface rules frozen with the corpus) |
| `.srv` request (`…/srv/Name_Request`) | Parent `…/srv/Name` `.srv` text | Fields **before** the first `---` separator line |
| `.srv` response (`…/srv/Name_Response`) | Parent `…/srv/Name` `.srv` text | Fields **after** the first `---` separator line |
| `.action` goal (`…/action/Name_Goal`) | Parent `…/action/Name` `.action` text | Fields **before** the first `---` |
| `.action` result (`…/action/Name_Result`) | Parent `…/action/Name` `.action` text | Fields **between** the first and second `---` |
| `.action` feedback (`…/action/Name_Feedback`) | Parent `…/action/Name` `.action` text | Fields **after** the second `---` |

Separator lines are a single line whose trimmed content is exactly `---`, matching ROS `.srv` / `.action` layout. Missing separators, surplus separators for the root kind, or an empty required section after selection fail with `schema_input_invalid`. Shared dependency `.msg` sources use the whole-body rule.

Examples: `EchoNested_Request` / `EchoNested_Response` from `EchoNested.srv`; `MeasureSequence_Goal` / `_Result` / `_Feedback` from `MeasureSequence.action`.

Root `bun run check` includes the generator check after `cdr-tail-slack:check`.

## Generator contract

| Rule | Contract |
|---|---|
| Tooling | Bun script with `--write` and `--check` (`scripts/generated-types.ts`; `bun run generated-types:write` / `generated-types:check`) |
| `--write` | Regenerates committed normalized-descriptor and static metadata artifacts from the authoritative inputs into `rclweb/generated/metadata/` |
| `--check` | Rebuilds in memory (or to a temp path) and requires **byte identity** with the committed output; drift exits non-zero with `schema_generation_drift` |
| Determinism | Same committed inputs produce identical output bytes |
| Sources | `ROS2_INTERFACE_TEXT` only; section selection as above |
| Validation | Full authoritative-input joins and bounds before emit |
| Output | Checked-in validated normalized descriptors and static metadata (identity rows, descriptor handles, wire-profile tail tables, provenance rows). Check runs from committed tree inputs only |
| Failure | Non-zero exit and a stable diagnostic when inputs are missing, malformed, out of bounds, or output drifts |

## Codec contract

Production models and codecs:

- call only the public `rclweb::cdr` surface ([CDR core](./cdr.md));
- enforce schema-declared field bounds (string/wstring payload maxima, sequence element maxima, fixed-array counts);
- pass `CdrNesting` tokens through nested aggregates and respect `max_nesting_depth`;
- return borrowed `BytesView` for large binary payloads, including **PointCloud2 `data`**, as zero-copy views into caller-retained storage;
- complete top-level samples with the registry-supplied expected zero-tail via `ensure_complete_with_zero_tail`;
- produce exact canonical encode (zero top-level tail) for rclweb writers.

Canonical encode remains exact. Cross-row semantic agreement compares decoded logical values; RMW capacity tails stay outside that comparison.

## SchemaKey

Unified **registry identity key** (exactly these five fields):

| Field | Type / domain | Meaning |
|---|---|---|
| `scheme` | string | Identity scheme name |
| `value` | string | Scheme-specific identity string |
| `type_name` | string | Fully qualified ROS type name |
| `encoding` | R2WP `payload-encoding-cdr` **u8** enum | Payload encoding. Assigned domain: `1` = CDR1, `2` = XCDR2 ([R2WP registry](../../protocol/registry/r2wp-v0.json)). **The generated surface requires `1` (CDR1)** |
| `schema_generation` | **u32** | Generation counter. Absolute range `0..=4_294_967_295`. **Corpus value is `1`** |

This matches ADR 0007: identity is the pair `(scheme, value)`; full cache identity also carries type name, encoding, and generation. Encoding is the R2WP payload-encoding enum (wire integer), matching control and channel records. Corpus fixtures may display the name `CDR1`; generators and runtimes map that display name to wire value `1` and validate the assigned domain (accept `1` for the generated surface; reject every other u8, including `2` until a later surface opens XCDR2).

**CDR representation** (endian / encapsulation identifier) lives in wire-profile resolution metadata with `support_row_id` when resolving the expected top-level zero-tail (see [Lookup](#lookup)). The five-field `SchemaKey` stays scheme, value, type name, encoding, and schema generation.

### Accepted schemes

| Scheme | Value form | Validation |
|---|---|---|
| `rclweb-schema-v1` | SHA-256 of the deterministic canonical bundle bytes | Exactly 64 **lowercase** hex characters |
| `rep2011-rihs` | REP-2011 RIHS string | Exact `RIHS01_` prefix plus 64 **lowercase** hex characters |

Accepted schemes and value forms pass exact validation. Rejected schemes, wrong prefixes, wrong lengths, and non-lowercase hex fail as `invalid_schema_key` before registry mutation or lookup success. Validation requires the exact committed case; uppercase hex fails as invalid.

### Eighteen identities, nine descriptors

The committed corpus exposes **18** schema identities (nine roots × two schemes). Both scheme-side keys for a root resolve to the **same** codec descriptor (same models and CDR1 codecs). Scheme values remain independent: each scheme keeps its own value space and validation rules under ADR 0007.

## Provenance

Jazzy RIHS-to-bundle records are **provenance**. They preserve independent identity meaning for cross-version and cross-distro lookup aids. Each scheme keeps its own key space and validation rules; provenance links RIHS values to bundle digests for those aids.

## Registry behavior

### Builder and freeze

Registration runs in a **bounded builder** during load or generation:

1. The builder accepts descriptor rows, identity rows, wire-profile tail rows, and provenance rows under the absolute limits below.
2. Identical re-registration of the same material is **idempotent success**.
3. Conflicting material for the same key or wire-profile triple is **`schema_conflict`**.
4. On successful completion the builder **freezes** into an **immutable registry**.
5. **Runtime lookup reads that frozen registry.** Channel activation uses only the frozen registry.

### Wire-profile resolution metadata

Zero-tail resolution uses metadata outside the registry identity key:

| Field | Meaning | Domain |
|---|---|---|
| `support_row_id` | Support row | `H-FT`, `H-CY`, `H-ZN`, `J-FT`, `J-CY`, `J-ZN` |
| `cdr_representation` | CDR1 encapsulation / endian on the wire | `CDR_LE` (`0x0001`, little) or `CDR_BE` (`0x0000`, big), matching [CDR core](./cdr.md) |

`SchemaKey.encoding` remains R2WP payload-encoding value `1` (CDR1) for both representations.

### Lookup

Lookup takes a full `SchemaKey`, **`support_row_id`**, and **`cdr_representation`** against the frozen registry.

On success the registry returns:

- the codec descriptor for the root type (from `SchemaKey`; both representations of a root map to the same descriptor);
- the **committed expected top-level zero-tail** length for that type on that support row **and** CDR representation, taken from committed [`tail-slack.json`](../../conformance/cdr/tail-slack.json) evidence (values `0`, `4`, or `12`).

**Why representation is required:** support row plus type is ambiguous. On `H-FT` and `J-FT`, `PrimitiveScalars` has a little-endian sample with zero-tail **4** and a big-endian singleton with zero-tail **0**. The frozen resolution key for tail length is:

```text
SchemaKey + support_row_id + cdr_representation
```

with **tail-slack evidence as authority**. Every fixture binds its expected tail to the explicit representation used on the wire.

### Missing material

When required schema material is missing—including a missing tail-slack row for the requested `(type, support_row_id, cdr_representation)` triple—the runtime returns **`schema_unavailable` before channel activation**. Channel activation requires a resolved descriptor and expected tail.

### Registration cases

| Case | Result |
|---|---|
| Same `SchemaKey` with identical descriptor material in the builder | **Idempotent success** |
| Same wire-profile triple (`SchemaKey` type identity + `support_row_id` + `cdr_representation`) with identical expected tail | **Idempotent success** |
| Same `SchemaKey` with conflicting descriptor or provenance | **`schema_conflict`** |
| Same wire-profile triple with a conflicting expected tail | **`schema_conflict`** |
| Invalid key, encoding outside the assigned domain, or unknown representation | **`invalid_schema_key`** |

### Static registry and later dynamic projection

The generated registry is **static and finite**: built from the committed corpus surface, loaded through the bounded builder, and frozen before activation. Dynamic projection (runtime type descriptions, lazy field plans, and open-ended registration of custom types) remains later work.

## Bounded limits

Generator and registry builder enforce explicit absolute ceilings. Construction or load outside a ceiling yields a typed bounds fault; the builder commits only fully validated state.

| Limit | Absolute range | Role |
|---|---|---|
| `max_registry_entries` | `1..=256` | Distinct `SchemaKey` rows |
| `max_sources_per_bundle` | `1..=64` | Source entries in one recursive bundle |
| `max_dependency_edges` | `0..=256` | Edges in one bundle dependency graph |
| `max_source_bytes` | `1..=1_048_576` | UTF-8 bytes of one source entry's content |
| `max_bundle_bytes` | `1..=1_048_576` | Total canonical bundle UTF-8 bytes (file/content). Aligns with R2WP `type_description_bytes_max` and `control_payload_max_bytes` (1 048 576) |
| `max_scheme_chars` | `1..=64` | `SchemaKey.scheme` length |
| `max_value_chars` | `1..=128` | `SchemaKey.value` length |
| `max_type_name_chars` | `1..=256` | `SchemaKey.type_name` length |
| `max_support_row_id_chars` | `1..=16` | Lookup `support_row_id` length |
| `encoding` domain | R2WP `payload-encoding-cdr` u8: `1` \| `2`; **the generated surface accepts `1` only** | Assigned enum validation (replaces a free-form encoding string length limit) |
| `schema_generation` | u32 `0..=4_294_967_295`; **corpus value `1`** | Generation counter domain |

The generated surface sits inside these ceilings. Raising a ceiling is a contract revision.

## Typed errors

Public schema and generation faults (stable codes). Codec field faults remain [`CdrError`](./cdr.md#typed-error-taxonomy).

| Code | When it surfaces |
|---|---|
| `invalid_schema_key` | Scheme outside the accepted set; value fails exact form/lowercase hex rules; encoding outside the assigned R2WP domain or outside the generated-surface subset; `schema_generation` outside u32; a string key field exceeds its length ceiling; unknown `cdr_representation` |
| `schema_unavailable` | Required descriptor, bundle, provenance, or tail material for the requested support row and CDR representation is missing at lookup or channel setup |
| `schema_conflict` | Builder registration of an existing key or wire-profile triple with non-identical material |
| `schema_bounds_exceeded` | Generator or builder would exceed an absolute limit (entries, sources, edges, source bytes, bundle bytes, or input lengths) |
| `schema_input_invalid` | Authoritative input is malformed, fails a join/validation rule, or fails deterministic parse (bundle, manifest, tail-slack, or RIHS map) |
| `schema_generation_drift` | `--check` output differs in bytes from the committed artifact |

Error payloads carry the fault code and stable diagnostic context (offending field name, limit name, and sizes when applicable). Diagnostics keep schema source text out of the error payload.

## Acceptance evidence

| Gate | Evidence |
|---|---|
| Generator identity | `bun run generated-types:check` is byte-stable on a clean tree |
| Normalized descriptors | Artifacts include validated descriptors and static metadata with exact input joins |
| Nine-root codecs | Rust tests decode and exact-encode every corpus fixture for the nine roots |
| Dual-scheme resolve | All 18 identities resolve to the nine descriptors; invalid keys and missing material fault correctly |
| Provenance | Jazzy RIHS map loads as provenance; schemes keep independent meaning |
| Zero-tail | Lookup with each support row **and** CDR representation returns the committed expected tail (including H-FT/J-FT `PrimitiveScalars` LE tail 4 vs BE tail 0); declared completion matches corpus evidence |
| Builder freeze | Builder accepts the finite corpus set, freezes an immutable registry, and runtime lookup reads that registry |
| Registration | Identical re-registration succeeds; conflicting registration returns `schema_conflict` |
| Bounds | Over-limit entries, sources, edges, source bytes, bundle bytes, and lookup strings return `schema_bounds_exceeded` or `invalid_schema_key`; encoding domain rejects free-form and out-of-domain values |
| Adversarial | Malformed keys, missing material before activation, and codec bound violations stay typed |
| Public surface | Focused package tests plus root `just check`, `just test`, and `just build` |

## Ownership

| Concern | Owner |
|---|---|
| This contract | `docs/runtime/generated-types.md` |
| CDR layout and codec faults | [CDR core](./cdr.md) |
| Schema identity strategy | [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md) |
| Payload encoding enum | [R2WP v0](../../protocol/r2wp-v0.md), [registry](../../protocol/registry/r2wp-v0.json) |
| Corpus layout and bridge commands | [Corpus README](../../conformance/cdr/README.md) |
| Runtime package placement | [`rclweb` core](./core.md) |
| Evidence | [Validation](../validation.md) |
| Open work | [Open work](../../tasks/plan.md), [checklist](../../tasks/todo.md) |

## Out of scope

- Dynamic type descriptions and lazy field projection
- Wasm host buffer leases and poll ABI (see [`rclweb` core](./core.md))
- Gateway schema cache implementation details beyond shared `SchemaKey` identity
- XCDR2 payload codecs (R2WP encoding value `2`)
- Studio or application-level type browsers
- TypeScript classes from ROS 2 `.msg` / `.srv` / `.action` — `npx rcl-web gen` ([how to](../typescript.md#your-own-message-types)); the repo check is `scripts/rosidl-dts.ts`
