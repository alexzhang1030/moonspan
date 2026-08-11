# CDR core contract

Authoritative runtime contract for Moonspan CDR in `cdr_mbt` (M1-01). Generated types (M1-02) and the Wasm host poll boundary (M1-03) consume this surface.

## Purpose

`cdr_mbt` encodes and decodes ROS sample payloads on the R2WP data path. It owns stream encapsulation, endianness, alignment, primitive and container layouts, nested values, typed codec faults, and bounds-checked borrowed views into caller-retained storage. Schema-keyed generated codecs and dynamic projection build on this core. Browser scheduling, network I/O, and host buffer lifecycle stay in the TypeScript host (M1-03).

## Supported representations

| Surface | M1 target | Role |
|---|---|---|
| CDR1 little endian | Required | Default ROS sample encoding for the authoritative corpus |
| CDR1 big endian | Required | Explicit big-endian primitive coverage in the corpus |
| XCDR2 stream foundations | Follow-on | Stream headers and representation identifiers for later schema work |

M1 qualifies **CDR1** (OMG DDS-XTypes 1.3 encoding version 1 / PLAIN_CDR rules for final types) against the committed ROS corpus. XCDR2 stream foundations are a follow-on surface for later schema identity work. M1-01 acceptance covers CDR1 little and big endian only.

Corpus encoding identity is `CDR1` in [`conformance/cdr/manifest.json`](../../conformance/cdr/manifest.json) (`corpus` = `moonspan-ros-cdr-v1`; manifest `schema_version` = 1; runtime `schema_generation` = 1).

## CDR1 framing and alignment

Frozen framing for top-level sample streams (DDS-XTypes 1.3 Clause **7.4.1** PLAIN_CDR / encoding version 1, Clause **7.4.3** XCDR stream model, **Table 60** RTPS encapsulation identifier, and the TOP_LEVEL serialization rule):

1. **Encapsulation header (4 bytes)**
   - 2-byte representation identifier (`ENC_HEADER` / RTPS encapsulation identifier).
   - 2 option bytes following the identifier (RTPS OMG CDR encapsulation options, as referenced from XTypes Table 60 discussion and Sub Clause 10.2.1.2 of RTPS).
   - CDR1 little endian uses encapsulation identifier `{0x00, 0x01}` (`CDR_LE`).
   - CDR1 big endian uses encapsulation identifier `{0x00, 0x00}` (`CDR_BE`).

2. **Body alignment origin**
   After the 4-byte encapsulation header, the stream body begins with alignment origin reset so subsequent padding is computed from that body origin (TOP_LEVEL rule: `ENC_HEADER`, origin push, options, then nested body under the active origin).

3. **Primitive alignment (CDR1 / encoding version 1)**
   From **Table 31 – Serialization of primitive types in version 1 encoding**:

   | Width (bytes) | Alignment | Primitive examples |
   |---:|---:|---|
   | 1 | 1 | Byte, Boolean, Char8, Int8, UInt8 |
   | 2 | 2 | Char16, Int16, UInt16 |
   | 4 | 4 | Int32, UInt32, Float32 |
   | 8 | 8 | Int64, UInt64, Float64 |

   The stream inserts the minimum padding required so `((offset - origin) % alignment) == 0` before each multi-byte value (Clause **7.4.3.2**). Encoder padding bytes are **zero**. The decoder advances over the legal padding span and accepts any padding byte values in that span.

4. **Containers and nesting**
   Sequences and strings carry a length prefix, then elements under the same alignment rules. Nested structures continue on the same stream origin for the active nested encode/decode.

## Strings and wide strings

### Char8 / ROS `string` (CDR1)

Grounded in DDS-XTypes 1.3 Clause **7.4.1.1.2 Character Data** for `String<Char8>`:

| Rule | Contract |
|---|---|
| Encoding | UTF-8 |
| Serialized length | Number of **bytes** occupied by the characters **including the terminating NUL character** |
| Terminator | Required single `0x00` byte at the end of the character data; the length field accounts for that byte |

A Char8 string whose length claims character data without a final `0x00` inside the declared span surfaces `missing_string_terminator`. Invalid UTF-8 surfaces `invalid_utf8`. Boolean values other than `0` (false) and `1` (true) surface `invalid_boolean` (Table 31).

### ROS 2 legacy `wstring` wire profile (authoritative for M1)

DDS-XTypes 1.3 Clause **7.4.1.1.2** defines generic `String<Char16>` as UTF-16 code units with a **byte** length and without a trailing NUL. **The committed ROS fixtures use a different layout:** the ROS 2 / Fast-CDR legacy wide-string form produced by generated typesupport.

Pinned **Fast-CDR v1.0.29** (`Cdr::serialize(const wchar_t*)` / `Cdr::deserialize(wchar_t*&)` in [Cdr.cpp](https://raw.githubusercontent.com/eProsima/Fast-CDR/v1.0.29/src/cpp/Cdr.cpp)) writes a `uint32` element count (`wstrlen`), then `wstrlen * 4` payload bytes, and documents that wide strings omit a terminating zero. `readWString` / deserialize consume `length * 4` after the count. That is the core wstring value.

| Rule | ROS 2 legacy wstring profile |
|---|---|
| Length field | `UInt32` **element count** `N` (number of 32-bit character / code-unit slots) |
| Character payload | Exactly **`N * 4` bytes**: `N` endian-aware 32-bit slots (little: `08 67 00 00` for U+6708; big: `00 00 67 08`) |
| Core decode | Consumes **exactly** the count field plus `N * 4` payload bytes; the declared value ends there |
| Terminator inside the value | None (Fast-CDR: wide strings omit a terminating zero) |
| Endianness | Follows the CDR1 encapsulation identifier |
| Canonical Moonspan encode | Exact form only: count + `N * 4` payload; **zero top-level tail slack** |

#### Top-level tail slack (outside the wstring value)

Some Phase 1 fixtures carry **four extra zero bytes after a terminal wstring**. Those bytes are **top-level sample tail slack** from the RMW serialization path (pre-zeroed buffers / padding), **not** part of the declared wstring value.

| Observation | Rows / cases | After core wstring |
|---|---|---|
| Exact sample end | Cyclone (H-CY, J-CY); Fast DDS big-endian `primitive_scalars` | No extra bytes |
| One trailing `UInt32` zero | Fast DDS and Zenoh little-endian (H-FT, H-ZN, J-FT, J-ZN) | Exactly four `0x00` bytes after a **terminal** wstring |

Binding corpus evidence (Phase 1 contract):

- H-FT `primitive_scalars`: `N = 5`, five LE slots for `月面CDR`, then four zero bytes of top-level tail slack → total sample **104** bytes.
- H-FT `primitive_scalars_big_endian`: `N = 5`, five BE slots, exact end → **100** bytes.
- H-CY `collections`: `N = 16`, sixteen slots for `0123456789abcdef`, exact end → **156** bytes.
- H-FT / H-ZN `collections`: same `N = 16` and slots, then four zero bytes of tail slack → **160** bytes. Jazzy rows follow the same CY versus FT/ZN split.

#### Completion modes

| Mode | Behavior after a fully decoded sample whose last member is a wstring |
|---|---|
| **Core field decode** | Always stops after count + `N * 4`; tail slack is not part of the value |
| **Corpus completion** | Accepts the narrow Phase 1 row-compatible tail: **exactly one trailing `UInt32` zero** and only when the wstring is terminal in the sample |
| **Strict completion** | Requires a fully consumed stream; the same four zero bytes surface as `trailing_data` |

Cross-row semantic agreement compares the decoded logical string. M1-01d proves exact CY fixtures and FT/ZN zero-tail fixtures normalize to the same value (for example `月面CDR` or `0123456789abcdef`).

When a later member follows a wstring, generated schema plans (M1-02) supply the next alignment so core decode ends at count + `N * 4` and the next member begins cleanly. Non-terminal tail-slack cases stay outside the narrow corpus completion policy until the corpus expands.

`invalid_utf16` covers a 32-bit character slot outside the accepted Unicode scalar rules for this ROS profile. A missing required Char8 NUL remains `missing_string_terminator`.

## Reader and writer API direction

```text
CdrWriter  ->  append primitives, strings, sequences, arrays, nested values
CdrReader  ->  pull the same surface with bounds checks
BytesView  ->  bounds-checked slice into parent storage the caller retains
```

- Writers append into a bounded buffer and return a typed fault when growth would exceed the stream or allocation ceiling.
- Readers advance an internal cursor. Padding is computed from origin and alignment. When padding would pass the stream end the fault is `alignment_overflow`. When a field ends past available bytes the fault is `truncated`.
- Public codecs are deterministic: the same logical value, the same CDR1 endianness, and the same writer limits produce the same bytes.
- Large binary fields return a bounds-checked `BytesView` into parent storage. The parent buffer remains retained by the caller for the view’s lifetime. Host lease tracking and buffer release live in M1-03.

Exact MoonBit signatures land in M1-01b and M1-01c. This document freezes the behavioral contract those signatures implement.

## Typed error taxonomy (`cdr_mbt`)

Implementable codec faults with stable codes:

| Code | When it surfaces |
|---|---|
| `invalid_encapsulation` | Header is shorter than 4 bytes or options/identifier framing is malformed |
| `unsupported_representation` | Representation identifier is outside the accepted CDR1 little/big set for this call |
| `truncated` | Input ends before a required field completes |
| `invalid_boolean` | Boolean byte is outside `{0, 1}` |
| `invalid_utf8` | Char8 string payload fails UTF-8 well-formedness |
| `invalid_utf16` | ROS `wstring` 32-bit character slot fails accepted Unicode scalar rules for this profile |
| `missing_string_terminator` | Char8 string length span lacks the required terminating NUL |
| `bounds_exceeded` | Sequence or string length exceeds a configured codec or type bound available to the call |
| `length_overflow` | Length or size arithmetic exceeds the stream ceiling or host size domain |
| `alignment_overflow` | Required padding would advance past the end of the stream |
| `trailing_data` | Strict completion mode requires a fully consumed stream and unread bytes remain (including top-level wstring tail slack) |

`schema_mismatch` and related identity faults belong to M1-02 generated types and M2-01 dynamic projection. Host buffer lease and transfer faults belong to M1-03.

## Overflow and allocation limits

| Limit | Frozen default | Notes |
|---|---|---|
| Maximum stream bytes (one encode or decode) | **67 108 864** (64 MiB) | Matches the R2WP absolute frame payload ceiling (`frame_payload_max_bytes`) |
| Field and type bounds (string max, sequence max, …) | Generated-schema inputs | Supplied by M1-02 type metadata for each interface |
| Maximum nesting depth | **M1-01b decision** | Finite positive integer recorded as an M1-01b acceptance input with rationale in that batch |
| Maximum temporary allocation per codec operation | **M1-01b decision** | Finite budget recorded as an M1-01b acceptance input; must stay at or below the stream ceiling |

Crossing a limit returns a typed fault from the taxonomy above. On failed encode, caller-owned output buffers remain unchanged. Where the API documents atomic field reads, a failed field leaves the reader cursor at the start of that field.

## Borrowed views and host buffer lifecycle

**Codec (`cdr_mbt`, this contract):**

- Decode may return a bounds-checked `BytesView` (or equivalent) into the input buffer.
- The view is valid only while the parent storage remains retained by the caller.
- Ownership and retention of parent storage are caller responsibilities at the codec boundary.

**Host (`M1-03`, Wasm poll ABI):**

- Explicit host buffer leases, release, and transferred-buffer lifecycle live in the host poll contract ([`rclmbt`](./rclmbt.md), [ADR 0004](../adr/0004-browser-wasm-host-boundary.md)).
- Applications that keep payload data past host release copy or extend the host lease through the host API.
- Lease and transfer faults are host ABI concerns; `cdr_mbt` emits only the codec taxonomy above.

## Deterministic encoder behavior

- Field order follows the ROS IDL member order for the type.
- Padding bytes written by the encoder are zero.
- Container and Char8 string lengths use the CDR1 length widths for the active representation.
- ROS `wstring` encode is the exact legacy form: `UInt32` element count `N`, then `N * 4` payload bytes, with zero top-level tail slack.
- Encode is a pure function of logical value, CDR1 endianness, and configured limits.

## Corpus-driven conformance

The authoritative corpus is [`conformance/cdr/`](../../conformance/cdr/README.md). Counts and rows come from the committed [`manifest.json`](../../conformance/cdr/manifest.json):

| Fact | Value |
|---|---|
| Corpus id | `moonspan-ros-cdr-v1` |
| Encoding | `CDR1` |
| Manifest schema version | `1` (`schema_version`) |
| Runtime schema generation | `1` (`schema_generation`) |
| Support rows | H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN (six environments) |
| Fixtures | 56 |
| Cross-row comparisons | 18 |
| Coverage tokens | action, arrays, bounds, endianness_big, endianness_little, nesting, point_cloud2, primitives, service, strings, wide_strings |
| Platform recorded in manifest | `linux/arm64` |

### Semantic agreement

Legal ROS encoders may emit distinct bytes for one logical value, including exact samples and samples with top-level wstring tail slack. Cross-row validation compares **decoded semantics** (and committed semantic digests) as the agreement criterion. When byte digests match across rows, the corpus records that equality as an additional observation.

### Round trip and malformed input

M1-01d proves:

- decode of every committed fixture yields the expected semantic value;
- exact CY fixtures and FT/ZN zero-tail fixtures for the same logical wstring normalize to one semantic value;
- encode under Moonspan CDR1 uses exact wstring form (zero tail slack) and round-trips with semantic equality;
- malformed truncation, illegal lengths, and alignment overflow return the typed error taxonomy above;
- resource bounds reject oversized streams with stable codes;
- strict completion reports `trailing_data` on FT/ZN zero-tail samples; corpus completion accepts that narrow tail.

## Security and resource cases

Codec work runs inside declared budgets. Untrusted sample bytes are handled with typed faults and finite work:

- truncated and oversize length fields;
- nesting depth at and beyond the M1-01b ceiling;
- maximum-size strings, wide strings, sequences, and PointCloud2-scale payloads within the 64 MiB stream ceiling;
- padding and trailing-byte handling at stream end under strict completion.

These cases produce typed codec faults and appear in conformance and evidence reports.

## Batch acceptance

| Batch | Outcome |
|---|---|
| M1-01a | This contract, plan split, PCR and doc routes (documentation freeze) |
| M1-01b | Bounded stream reader/writer, encapsulation, endian, alignment, limits (including nesting and temporary-allocation defaults), typed errors |
| M1-01c | Primitives, strings/wstrings (legacy ROS profile), arrays, sequences, nested values, borrowed `BytesView` fields |
| M1-01d | Authoritative corpus proof: semantic agreement (CY exact vs FT/ZN zero-tail), round trips, malformed input, resource bounds |

M1-01 closes when batches b–d pass their focused tests and the corpus-driven checks. M1-02 and M1-03 consume this surface: M1-02 adds schema keys and per-type bounds; M1-03 adds host buffer leases and keeps CDR layout rules as defined here.

## Dependency boundaries

| Consumer | Expectation |
|---|---|
| M1-02 generated types | Call `cdr_mbt` for field layout; own schema identity, type registry keys, per-type bounds, and non-terminal member boundary metadata |
| M2-01 dynamic projection | Reuse reader views and codec error taxonomy; map schema identity faults in the dynamic type layer |
| M1-03 host ABI | Own buffer ownership transfer, leases, release, and poll batches; pass retained bytes into decode |
| R2WP / gateway | Carry opaque CDR payloads and schema identity; leave codec work to `rclmbt` |
| Evidence / N1 gate | Record corpus revision, support rows, and agreement results per [validation](../validation.md) |

## Sources

Official references that ground this contract:

| Source | Stable URL | Relevant material |
|---|---|---|
| OMG DDS-XTypes 1.3 About | https://www.omg.org/spec/DDS-XTypes/1.3/About-DDS-XTypes/ | Specification overview and document set |
| OMG DDS-XTypes 1.3 PDF | https://www.omg.org/spec/DDS-XTypes/1.3/PDF | Clause **7.4.1** PLAIN_CDR (encoding version 1); Clause **7.4.1.1.2** character data (generic Char8 / Char16 rules; Phase 1 ROS `wstring` uses the legacy Fast-CDR profile above); **Table 31** primitive size and alignment; Clause **7.4.3** XCDR stream model and TOP_LEVEL encapsulation; **Table 60** RTPS encapsulation identifiers; XCDR2 as encoding version 2 follow-on |
| ROS 2 Creating an RMW Implementation | https://docs.ros.org/en/ros2_documentation/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html | RMW serialization boundary, typesupport expectations, and distribution-facing encode/decode responsibilities |
| eProsima Fast-CDR v1.0.29 `Cdr.cpp` | https://raw.githubusercontent.com/eProsima/Fast-CDR/v1.0.29/src/cpp/Cdr.cpp | Upstream `serialize(const wchar_t*)` / wide-string deserialize: `uint32` count then `count * 4` payload; comment that wide strings omit a terminating zero |
| MoonBit core `@bytes` package | https://mooncakes.io/docs/moonbitlang/core/bytes | Core bytes and view APIs used for buffer slices |
| MoonBit language fundamentals | https://docs.moonbitlang.com/en/latest/language/fundamentals.html | Owned `Bytes` versus borrowed `BytesView` table and language-level slicing model |

Committed fixtures under [`conformance/cdr/`](../../conformance/cdr/README.md) are the binding Phase 1 wire contract for this profile; Fast-CDR v1.0.29 is the upstream implementation reference for the core value layout. Generator provenance and row pins live in the corpus README. Schema identity across Humble and Jazzy is fixed by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).
