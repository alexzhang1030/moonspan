# CDR core contract

Authoritative runtime contract for Moonspan CDR in `cdr_mbt` (M1-01). Generated types (M1-02) and the Wasm host poll boundary (M1-03) consume this surface.

## Purpose

`cdr_mbt` encodes and decodes ROS sample payloads that travel on the R2WP data path. It owns stream encapsulation, endianness, alignment, primitive and container layouts, nested values, typed errors, and bounded borrowed views. Schema-keyed generated codecs and dynamic projection build on this core; browser scheduling and network I/O stay in the TypeScript host.

## Supported representations

| Surface | M1 target | Role |
|---|---|---|
| PLAIN_CDR / CDR1 little endian | Required | Default ROS sample encoding for the authoritative corpus |
| PLAIN_CDR / CDR1 big endian | Required | Explicit big-endian primitive coverage in the corpus |
| XCDR2 stream foundations | Follow-on | Stream headers and representation identifiers reserved for later schema work |

M1 qualifies PLAIN_CDR/CDR1 against the committed ROS corpus. XCDR2 stream foundations remain an explicit follow-on surface used by later schema identity work; they stay out of M1-01 acceptance.

Corpus encoding identity is `CDR1` in [`conformance/cdr/manifest.json`](../../conformance/cdr/manifest.json) (`corpus` = `moonspan-ros-cdr-v1`, `schema_generation` = 1).

## Byte and alignment model

- Encapsulation selects endianness for the stream.
- Multi-byte primitives align to their natural size within the stream cursor.
- Structures nest with member alignment; containers record element count then packed elements under the same rules.
- Encoder padding is deterministic zero fill (`zero-filled-v1` in the corpus).
- Decoder consumes legal padding bytes and advances the cursor; acceptance depends on length and alignment, and treats padding content as unconstrained beyond the legal span.
- Cursor arithmetic stays within declared stream bounds; overflow surfaces as a typed resource error.

## Reader and writer API direction

```text
CdrWriter  ->  append primitives, strings, containers, nested values
CdrReader  ->  pull the same surface with bounds checks
BytesView  ->  borrowed slice into a parent buffer under a lease
```

- Writers grow into a bounded buffer or fail with an allocation or overflow error before writing past the limit.
- Readers advance a cursor, reject truncation and misalignment with stable error codes, and expose remaining length.
- Public codecs are deterministic: identical logical values and identical writer limits produce identical bytes under PLAIN_CDR/CDR1.
- Large binary fields surface as `BytesView` (or equivalent borrowed view) rather than forced full copies at the codec boundary.

Exact MoonBit signatures land in M1-01b and M1-01c. This document freezes the behavioral contract those signatures must satisfy.

## Typed error taxonomy

| Family | When it surfaces |
|---|---|
| `truncated` | Input ends before a required field completes |
| `alignment` | Cursor is illegal for the next type |
| `endianness` | Encapsulation or declared endian is unsupported |
| `bounds` | Sequence, string, array, or map length exceeds the type or policy limit |
| `overflow` | Cursor arithmetic or length computation exceeds the stream or host limit |
| `allocation` | Requested buffer growth exceeds the configured budget |
| `utf8` / `utf16` | String or wide-string payload fails encoding rules |
| `schema_mismatch` | Later generated/dynamic layers detect type or identity disagreement |
| `lease` | Borrowed view is used after parent release or lease expiry |

Errors are structured values with stable codes suitable for agreement fixtures and telemetry. Callers map them into R2WP and SDK error surfaces without string parsing.

## Overflow and allocation limits

Every reader and writer carries explicit ceilings:

- maximum stream bytes for one encode or decode;
- maximum sequence and string lengths for the active type and policy;
- maximum nesting depth for nested structures and containers;
- maximum temporary allocation for a single codec operation.

Limits are configuration inputs to the codec, recorded in evidence when they affect a gate result. Crossing a limit returns a typed error and leaves caller-owned buffers in a defined state (unchanged on failed encode; reader cursor unadvanced past the failing field where the API promises atomic field reads).

## Borrowed-view ownership and lease rules

- Every buffer has one owner at each boundary.
- `BytesView` (and equivalent views) borrow from a parent buffer under a lease.
- Decode may return views into the input buffer; the parent lease outlives every derived view.
- Applications that retain payload data past the parent release perform an explicit copy or extend the lease through the host buffer API.
- Release of the parent invalidates outstanding views and surfaces `lease` errors on subsequent use.
- Shared rings and transferable host buffers follow the same event lifecycle documented for [`rclmbt`](./rclmbt.md) and [ADR 0004](../adr/0004-browser-wasm-host-boundary.md).

## Deterministic encoder behavior

- Field order follows the ROS IDL member order for the type.
- Padding bytes written by the encoder are zero.
- Container lengths use the CDR-defined width for the representation.
- Optional defaults and omitted members follow the type contract used by the corpus generators.
- Encode is a pure function of logical value, representation (endianness), and configured limits.

## Corpus-driven conformance

The authoritative corpus is [`conformance/cdr/`](../../conformance/cdr/README.md). Counts and rows come from the committed [`manifest.json`](../../conformance/cdr/manifest.json):

| Fact | Value |
|---|---|
| Corpus id | `moonspan-ros-cdr-v1` |
| Encoding | `CDR1` |
| Schema generation | `1` |
| Support rows | H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN (six environments) |
| Fixtures | 56 |
| Cross-row comparisons | 18 |
| Coverage tokens | action, arrays, bounds, endianness_big, endianness_little, nesting, point_cloud2, primitives, service, strings, wide_strings |
| Platform recorded in manifest | `linux/arm64` |

### Semantic agreement

Legal ROS encoders may produce distinct bytes for the same logical value. Cross-row validation therefore compares **decoded semantics** (and committed semantic digests) as the agreement criterion. Byte identity is recorded when it occurs and is informative, not required across rows.

### Round trip and malformed input

M1-01d proves:

- decode of every committed fixture yields the expected semantic value;
- encode under Moonspan PLAIN_CDR/CDR1 round-trips with semantic equality;
- malformed truncation, illegal lengths, and alignment faults return the typed error taxonomy above;
- resource bounds reject oversized streams and allocations with stable codes.

## Security and resource cases

Codec work stays inside declared budgets so untrusted sample bytes cannot force unbounded allocation or CPU:

- truncated and oversize length fields;
- deeply nested structures up to and beyond the depth ceiling;
- maximum-size strings, wide strings, sequences, and PointCloud2-scale payloads;
- padding and trailing-byte handling at stream end;
- lease use-after-release for borrowed views.

These cases produce typed errors and appear in conformance and evidence reports.

## Batch acceptance

| Batch | Outcome |
|---|---|
| M1-01a | This contract, plan split, PCR and doc routes (documentation freeze) |
| M1-01b | Bounded stream reader/writer, encapsulation, endian, alignment, limits, typed errors |
| M1-01c | Primitives, strings/wstrings, arrays, sequences, nested values, borrowed `BytesView` fields |
| M1-01d | Authoritative corpus proof: semantic agreement, round trips, malformed input, resource bounds |

M1-01 closes when batches b–d pass their focused tests and the corpus-driven checks. M1-02 (generated types and schema-identity registry) and M1-03 (Wasm host ABI and poll loop) depend on the frozen behavioral surface here; they add schema keys and host buffer leases without redefining CDR layout rules.

## Dependency boundaries

| Consumer | Expectation |
|---|---|
| M1-02 generated types | Call `cdr_mbt` for field layout; own schema identity and type registry keys |
| M1-02 dynamic projection | Reuse reader views and error taxonomy; add schema mismatch mapping |
| M1-03 host ABI | Own buffer ownership transfer and poll batches; pass leased bytes into decode |
| R2WP / gateway | Carry opaque CDR payloads and schema identity; leave codec work to `rclmbt` |
| Evidence / N1 gate | Record corpus revision, support rows, and agreement results per [validation](../validation.md) |

## Sources

Official references that ground this contract:

| Source | Stable URL | Relevant material |
|---|---|---|
| OMG DDS-XTypes 1.3 About | https://www.omg.org/spec/DDS-XTypes/1.3/About-DDS-XTypes/ | Specification overview and document set for Extended and Dynamic Types |
| OMG DDS-XTypes 1.3 PDF | https://www.omg.org/spec/DDS-XTypes/1.3/PDF | PLAIN_CDR / CDR representation, encapsulation headers, alignment, primitive and constructed types; XCDR2 as the extended representation family |
| ROS 2 Creating an RMW Implementation | https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html | RMW serialization boundary, typesupport expectations, and distribution-facing encode/decode responsibilities |
| MoonBit language fundamentals (Bytes / BytesView) | https://docs.moonbitlang.com/en/latest/language/fundamentals.html | Built-in `Bytes` and `BytesView` ownership and slicing model |
| MoonBit core `@bytes` package | https://mooncakes.io/docs/moonbitlang/core/bytes | Core bytes package API used by buffer and view helpers |

Project corpus layout, generator provenance, and row pins live under [`conformance/cdr/README.md`](../../conformance/cdr/README.md). Schema identity across Humble and Jazzy is fixed by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).
