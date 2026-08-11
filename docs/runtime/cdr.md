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

Frozen framing for top-level sample streams (DDS-XTypes 1.3 Clause **7.4.1** PLAIN_CDR / encoding version 1, Clause **7.4.3** XCDR stream model, **Table 60** RTPS encapsulation identifier):

1. **Encapsulation header (absolute offsets 0–3)**
   - Bytes 0–1: representation identifier (`ENC_HEADER` / RTPS encapsulation identifier), interpreted as network-order `UInt16`: `(byte0 << 8) | byte1`.
   - Bytes 2–3: options field, captured as network-order `UInt16` metadata: `(byte2 << 8) | byte3`.
   - Accepted representation identifiers for M1:
     - `0x0001` (`CDR_LE`) — CDR1 little endian
     - `0x0000` (`CDR_BE`) — CDR1 big endian
   - **Options handling (M1 freeze):** the decoder accepts every two-byte options value and stores that network-order `UInt16`. Field alignment and body layout ignore options contents. The canonical writer emits options `0x0000`.

2. **Body alignment origin**
   The codec body origin is **absolute byte offset 4**, immediately after the identifier and options. All subsequent alignment uses:

   ```text
   ((absolute_offset - 4) % alignment) == 0
   ```

   **Corpus proof:** in committed `primitive_scalars` fixtures, after `bool` / `byte` / `char` and one padding byte, **Float64 begins at absolute offset 12**, which is body-relative offset **8**. That placement matches an origin of 4 with 8-byte Float64 alignment (Table 31).

3. **Primitive alignment (CDR1 / encoding version 1)**
   From **Table 31 – Serialization of primitive types in version 1 encoding**:

   | Width (bytes) | Alignment | Primitive examples |
   |---:|---:|---|
   | 1 | 1 | Byte, Boolean, Char8, Int8, UInt8 |
   | 2 | 2 | Char16, Int16, UInt16 |
   | 4 | 4 | Int32, UInt32, Float32 |
   | 8 | 8 | Int64, UInt64, Float64 |

   The stream inserts the minimum padding required so the body-relative alignment condition holds before each multi-byte value (Clause **7.4.3.2**). Encoder padding bytes are **zero**. The decoder advances over the legal padding span and accepts any padding byte values in that span.

4. **Containers and nesting**
   Sequences and strings carry a length prefix, then elements under the same alignment rules. Nested structures continue with the same body origin (absolute offset 4) for the active nested encode/decode.

## Strings and wide strings

### Char8 / ROS `string` (CDR1)

Grounded in DDS-XTypes 1.3 Clause **7.4.1.1.2 Character Data** for `String<Char8>`:

| Rule | Contract |
|---|---|
| Encoding | UTF-8 |
| Serialized length | Endian-aware `UInt32`: number of **bytes** occupied by the characters **including the terminating NUL character** |
| Terminator | Required single `0x00` byte at the end of the character data; the length field accounts for that byte |
| Empty string | Length `1` plus a single `0x00` |
| Optional type bound (`max_bytes`) | Counts **UTF-8 payload bytes only** and leaves out the required terminating NUL. Exact bound succeeds; bound + 1 fails with `bounds_exceeded` before decode allocation and before writer mutation |
| Decode | Checks length arithmetic before host `Int` conversion; enforces the declared Char8 span against `max_stream_bytes` (`length_overflow`) before remaining-input truncation (`truncated`), matching `checked_span_length` order; requires the final NUL; strictly validates UTF-8; preserves a UTF-8 BOM as U+FEFF; returns an owned `String`. Worst-case owned UTF-16 storage (`payload_bytes * 2`) is charged to `max_temporary_allocation` before the strict decoder runs |
| Encode | Validates every input scalar and measures UTF-8 byte length under the writer field capacity ceiling and optional `max_bytes` before mutation; unpaired UTF-16 surrogates map to `invalid_utf8`. One complete field preflight covers alignment padding, `UInt32` length, payload, and NUL, then emits directly into the owned writer buffer |

When the declared Char8 span ends on a nonzero byte, or the length is zero, the fault is `missing_string_terminator`. Invalid UTF-8 surfaces `invalid_utf8`. Boolean values outside the set `{0, 1}` surface `invalid_boolean` (Table 31: `0` false, `1` true).

### ROS 2 legacy `wstring` wire profile (authoritative for M1)

DDS-XTypes 1.3 Clause **7.4.1.1.2** also defines generic `String<Char16>` as UTF-16 code units whose value boundary follows its **byte** length. That generic Char16 / UTF-16 surface is reserved for a follow-on representation. **Phase 1 ROS fixtures use the ROS 2 / Fast-CDR legacy wide-string form** produced by generated typesupport.

Pinned **Fast-CDR v1.0.29** (`Cdr::serialize(const wchar_t*)` / `Cdr::deserialize(wchar_t*&)` in [Cdr.cpp](https://raw.githubusercontent.com/eProsima/Fast-CDR/v1.0.29/src/cpp/Cdr.cpp)) writes a `uint32` element count (`wstrlen`), then `wstrlen * 4` payload bytes. The Fast-CDR value ends after those `N` slots. `readWString` / deserialize consume `length * 4` after the count. That is the core wstring value.

| Rule | ROS 2 legacy wstring profile |
|---|---|
| Length field | `UInt32` **element count** `N` (number of 32-bit character / code-unit slots) |
| Character payload | Exactly **`N * 4` bytes**: `N` endian-aware 32-bit slots (little: `08 67 00 00` for U+6708; big: `00 00 67 08`) |
| Core decode value boundary | Count field plus **`N * 4`** payload bytes |
| Accepted slot values | Unicode scalar values produced by the ROS `u16string_to_wstring` conversion; M1-01c tests the scalar boundary |
| Endianness | Follows the CDR1 encapsulation identifier |
| Canonical Moonspan encode | Exact form only: count + `N * 4` payload; **zero top-level tail slack** |

#### Top-level tail slack (outside the wstring value)

Some Phase 1 fixtures carry **four-byte zero tail slack** after a terminal wstring. Those tail bytes belong exclusively to **top-level sample tail slack** from the RMW serialization path (pre-zeroed buffers and size budgeting). The declared wstring value boundary remains count + `N * 4`.

Upstream chain that produces one preallocated zero slot of tail slack:

1. Humble `rosidl_typesupport_fastrtps_cpp` ([`msg__type_support.cpp.em`](https://raw.githubusercontent.com/ros2/rosidl_typesupport_fastrtps/humble/rosidl_typesupport_fastrtps_cpp/resource/msg__type_support.cpp.em)) converts `u16string` to `std::wstring` on the AbstractWString serialize branch (`u16string_to_wstring` then `cdr << wstr`).
2. The same template’s `get_serialized_size` budgets `wchar_size * (message.size() + 1)` with `wchar_size = 4`, so the size estimate includes one extra 32-bit unit beyond the character payload.
3. Fast-CDR v1.0.29 writes `wstrlen` and `wstrlen * 4` payload bytes; the Fast-CDR value ends after those `N` slots.
4. When RMW serialization runs into a zero-filled buffer sized from that estimate, the unused final slot remains as **four-byte zero tail slack** after a terminal wstring.

| Observation | Rows / cases | After core wstring |
|---|---|---|
| Exact sample end | Cyclone (H-CY, J-CY); Fast DDS big-endian `primitive_scalars` | **0** slack bytes |
| Four-byte zero tail slack | Fast DDS and Zenoh little-endian (H-FT, H-ZN, J-FT, J-ZN) | Exactly four `0x00` bytes after a **terminal** wstring |

Binding corpus evidence (Phase 1 contract):

- H-FT `primitive_scalars`: `N = 5`, five LE slots for `月面CDR`, then four-byte zero tail slack → total sample **104** bytes.
- H-FT `primitive_scalars_big_endian`: `N = 5`, five BE slots, exact sample end (0 slack) → **100** bytes.
- H-CY `collections`: `N = 16`, sixteen slots for `0123456789abcdef`, exact sample end → **156** bytes.
- H-FT / H-ZN `collections`: same `N = 16` and slots, then four-byte zero tail slack → **160** bytes. Jazzy rows follow the same CY versus FT/ZN split.

#### Completion modes

| Mode | Behavior after a fully decoded sample whose last member is a wstring |
|---|---|
| **Core field decode** | Value boundary is count + `N * 4`; any following bytes are handled only by the chosen completion mode |
| **Corpus completion** | Accepts the narrow Phase 1 row-compatible tail: **exactly four-byte zero tail slack** (`UInt32` zero) when the wstring is terminal in the sample |
| **Strict completion** | Requires a fully consumed stream; the same four zero bytes surface as `trailing_data` |

Cross-row semantic agreement compares the decoded logical string. M1-01d proves exact CY fixtures and FT/ZN four-byte zero tail slack fixtures normalize to the same value (for example `月面CDR` or `0123456789abcdef`).

When a later member follows a wstring, generated schema plans (M1-02) supply the next alignment so core decode ends at count + `N * 4` and the next member begins cleanly. The narrow corpus completion policy covers terminal wstring samples in the current corpus; expanded non-terminal cases land with those schema plans.

`invalid_wstring_scalar` covers a 32-bit character slot outside the accepted Unicode scalar values for this ROS profile. When a Char8 declared span ends on a nonzero byte, the fault is `missing_string_terminator`.

## Reader and writer API direction

```text
CdrWriter  ->  append primitives, strings, sequences, arrays, nested values
CdrReader  ->  pull the same surface with bounds checks
BytesView  ->  bounds-checked slice into parent storage the caller retains
```

- Writers append into a bounded owned buffer and return a typed fault when growth would exceed capacity.
- Readers advance an internal cursor. Padding is computed from origin and alignment. When padding would pass the stream end the fault is `alignment_overflow`. When a field ends past available bytes the fault is `truncated`.
- Public codecs are deterministic: the same logical value, the same CDR1 endianness, and the same writer limits produce the same bytes.
- Large binary fields return a bounds-checked `BytesView` into parent storage. The parent buffer remains retained by the caller for the view’s lifetime. Host lease tracking and buffer release live in M1-03.

### MoonBit surface (`rclmbt/cdr`)

| Surface | Batch | Notes |
|---|---|---|
| `CdrReader` | M1-01b1 | Encapsulation parse, origin-4 alignment, zero-copy `read_bytes`, strict completion |
| `CdrWriter` | M1-01b2 | Canonical header on construct, deterministic zero padding, owned `to_bytes` snapshots |
| Raw integers | b1/b2 | Width-exact APIs: `read_u8`/`write_u8` → `Byte`; `read_u16`/`write_u16` → `UInt16`; `read_u32`/`write_u32` → `UInt`; `read_u64`/`write_u64` → `UInt64`. Reader assembly uses `Byte::to_uint16` / `Byte::to_uint` so shifts stay unsigned through `0x80000000..0xffffffff` |
| Semantic primitives | M1-01c1 | `bool`; signed `i8`/`i16`/`i32`/`i64` (`Int`/`Int64`); `Float`/`Double` IEEE bit patterns; `Char8`/`Char16`. Built on raw read/write. `i8`/`i16` writers validate representable ranges. Boolean accepts `0`/`1` only (`invalid_boolean`) |
| Char8 string | M1-01c2a | `read_string` / `write_string` with optional `max_bytes` (UTF-8 payload bytes excluding NUL); owned `String` decode; direct writer emit after full-field preflight |
| ROS legacy wstring | M1-01c2b | ROS legacy wstring (`count * 4`, `invalid_wstring_scalar`, terminal four-byte zero tail slack) and corpus-tail completion |
| Arrays / sequences / views | M1-01c3 | Arrays, sequences, nested-depth guards, borrowed `BytesView` fields |

**Writer capacity:** `capacity = min(max_stream_bytes, max_temporary_allocation)`, counted over the **complete stream including the 4-byte header**. Construction emits the full canonical header immediately (`LE = 00 01 00 00`, `BE = 00 00 00 00`; options always `0x0000`). When temporary capacity is below 4, construction returns `bounds_exceeded` with `needed = 4` and `remaining =` temporary capacity. Each field preflights `pad + size` arithmetic and full capacity before mutating the buffer; faults leave position and bytes byte-identical. `to_bytes` returns an owned snapshot isolated from later writes.

**Writer allocation:** default construction allocates header-sized backing storage (`size_hint = HEADER_LENGTH` / `WRITER_INITIAL_SIZE_HINT`) and grows lazily under the logical `capacity` hard ceiling (Phase 1 absolute cap remains 64 MiB via limits). Position and remaining capacity derive from `buf.length()` as the single stream-length source. `CdrWriter` fields are package-private; external packages construct only through `CdrWriter::new` / `new_default`.

## Typed error taxonomy (`cdr_mbt`)

Implementable codec faults with stable codes:

| Code | When it surfaces |
|---|---|
| `invalid_encapsulation` | The 4-byte header is truncated or structurally unavailable |
| `unsupported_representation` | Representation identifier is outside `{0x0000, 0x0001}` |
| `invalid_limits` | `CdrLimits` construction is outside absolute Phase 1 ranges |
| `truncated` | Input ends before a required field completes |
| `invalid_boolean` | Boolean byte is outside `{0, 1}` |
| `invalid_utf8` | Char8 string payload fails UTF-8 well-formedness |
| `invalid_wstring_scalar` | ROS legacy `wstring` 32-bit slot is outside accepted Unicode scalar values from `u16string_to_wstring` |
| `missing_string_terminator` | Char8 declared span ends on a nonzero byte |
| `bounds_exceeded` | Input stream longer than `max_stream_bytes`, owned temporary allocation above capacity, or a configured type bound is exceeded |
| `length_overflow` | Length arithmetic overflows the host size domain, or a borrowed span length exceeds the absolute stream ceiling |
| `alignment_overflow` | Required padding would advance past the end of the stream |
| `trailing_data` | Strict completion mode requires a fully consumed stream and unread bytes remain (including four-byte zero tail slack) |

`CdrError` fields are public across packages. Numeric convention: **`needed` = requested/required size**, **`remaining` = available capacity**.

| Field | Meaning |
|---|---|
| `offset` | Absolute fault site (field-start on failed field reads; `0` for open/config faults) |
| `needed` | Requested or required size (input length when the stream is oversized; computed span/alloc size; header length when truncated; rejected limit value for `invalid_limits`). **`needed = 0`** is the sentinel when the `UInt64` request exceeds the host `Int` domain |
| `remaining` | Available capacity (e.g. `max_stream_bytes` for oversized open; `max_temporary_allocation` for alloc bounds; bytes remaining for field faults) |

`CdrLimits` values are re-validated at every reader/writer trust boundary (`CdrLimits::validate`, used by `CdrLimits::new`, `CdrReader::open`, and `CdrWriter::new`). Revalidation enforces the factory ranges for all received limit objects.

`checked_span_length` order: multiply → span above `max_stream_bytes` → `length_overflow` → span above remaining → `truncated`.
`schema_mismatch` and related identity faults belong to M1-02 generated types and M2-01 dynamic projection. Host buffer lease and transfer faults belong to M1-03.

## Overflow and allocation limits

| Limit | Absolute Phase 1 range | Default |
|---|---|---|
| `max_stream_bytes` | `4..=67 108 864` | **67 108 864** (R2WP `frame_payload_max_bytes`) |
| `max_nesting_depth` | `1..=64` | **64** |
| `max_temporary_allocation` | `0..=max_stream_bytes` | **67 108 864** |
| Field and type bounds | M1-02 generated-schema inputs | — |

Rationale: defaults are the absolute Phase 1 ceilings. Stream and temporary defaults match the R2WP payload ceiling; depth 64 bounds nested decode under a fixed stack budget with headroom for generated ROS schemas. Construction or open outside these ranges yields `invalid_limits`.

Borrowed `BytesView` spans (`read_bytes`, `checked_span_length`) are governed by remaining input and `max_stream_bytes`. `max_temporary_allocation` applies only to owned temporary allocations (`checked_alloc_length` and later owned buffers).

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
- exact CY fixtures and FT/ZN four-byte zero tail slack fixtures for the same logical wstring normalize to one semantic value;
- encode under Moonspan CDR1 uses exact wstring form (zero top-level tail slack) and round-trips with semantic equality;
- malformed truncation, illegal lengths, and alignment overflow return the typed error taxonomy above;
- resource bounds reject oversized streams with stable codes;
- strict completion reports `trailing_data` on FT/ZN four-byte zero tail slack samples; corpus completion accepts that narrow tail;
- M1-01c exercises `invalid_wstring_scalar` at the Unicode scalar boundary for legacy wstring slots.

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
| M1-01c | Primitives, strings/wstrings (legacy ROS profile, scalar-boundary tests), arrays, sequences, nested values, borrowed `BytesView` fields |
| M1-01d | Authoritative corpus proof: semantic agreement (CY exact vs FT/ZN four-byte zero tail slack), round trips, malformed input, resource bounds |

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
| eProsima Fast-CDR v1.0.29 `Cdr.cpp` | https://raw.githubusercontent.com/eProsima/Fast-CDR/v1.0.29/src/cpp/Cdr.cpp | Upstream `serialize(const wchar_t*)` / wide-string deserialize: `uint32` count then `count * 4` payload; Fast-CDR value ends after `N` slots |
| ROS 2 Humble `rosidl_typesupport_fastrtps_cpp` template | https://raw.githubusercontent.com/ros2/rosidl_typesupport_fastrtps/humble/rosidl_typesupport_fastrtps_cpp/resource/msg__type_support.cpp.em | AbstractWString serialize: `u16string_to_wstring` then Fast-CDR `<<`; `get_serialized_size` budgets `wchar_size * (size() + 1)` — explains one preallocated zero slot of top-level **tail slack** when the buffer is zero-filled |
| MoonBit core `@bytes` package | https://mooncakes.io/docs/moonbitlang/core/bytes | Core bytes and view APIs used for buffer slices |
| MoonBit language fundamentals | https://docs.moonbitlang.com/en/latest/language/fundamentals.html | Owned `Bytes` versus borrowed `BytesView` table and language-level slicing model |

Committed fixtures under [`conformance/cdr/`](../../conformance/cdr/README.md) are the binding Phase 1 wire contract for this profile. Fast-CDR v1.0.29 is the upstream reference for the core value layout; the Humble fastrtps typesupport template is the official ROS reference for size budgeting that leaves tail slack. Generator provenance and row pins live in the corpus README. Schema identity across Humble and Jazzy is fixed by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).
