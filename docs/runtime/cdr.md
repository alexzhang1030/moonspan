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
| Canonical Moonspan encode | Exact form only: count + `N * 4` payload |

#### Top-level zero tail slack

Core wstring boundary remains `UInt32` count plus `N * 4`. Tail slack is a **top-level serialized-buffer** property from RMW capacity budgeting, independent of the final member type.

Machine-checkable evidence: [`conformance/cdr/tail-slack.json`](../../conformance/cdr/tail-slack.json) (SHA-256 `1531d011f0715e5b82fa675be266d97387db7dd55ed8ff06784b213ae6256984`). Frozen counts: **56** fixtures, **18** comparisons, **24** exact, **12** with four zero bytes, **20** with twelve zero bytes. FT/ZN little-endian rows carry 4 or 12 depending on sample shape; Cyclone, big-endian primitive, and PointCloud2 are exact. `echo_nested_response` ends with `bool` and carries a 12-byte tail, so the boundary sits outside member values.

| Mode | Behavior after core sample decode |
|---|---|
| **Strict** (`ensure_complete`) | Fully consumed stream; every remaining tail surfaces as `trailing_data` |
| **Declared zero tail** (`ensure_complete_with_zero_tail`) | Exact end, or remaining length equals the declared all-zero byte count |

M1-02 supplies the declared expected tail from schema/support-row metadata (Phase 1 values `0`, `4`, or `12`). Canonical Moonspan encode remains exact (zero top-level tail). Cross-row semantic agreement compares decoded logical values; M1-01d proves agreement across exact and zero-tail fixtures.

`invalid_wstring_scalar` covers a 32-bit character slot outside the accepted Unicode scalar values for this ROS profile. When a Char8 declared span ends on a nonzero byte, the fault is `missing_string_terminator`.

## Arrays, sequences, and nesting (M1-01c3)

Implementable container surface for Phase 1 CDR1. Generated codecs (M1-02) compose these primitives with schema-declared counts and types.

### Fixed arrays

| Rule | Contract |
|---|---|
| Serialization | Exactly the schema-declared element count, by composing the existing element codec for each slot |
| Alignment | The first element uses normal body-origin alignment for its type; each later element uses the element codec’s own alignment |
| Preflight | Fixed-width element arrays may preflight `count × element_width` before the element loop |
| Schema ownership | Schema-generated code owns the declared array count and value-length validation |

### Sequences

Public direction:

```text
CdrReader::read_sequence_length(max_elements? : UInt) -> Result[Int, CdrError]
CdrWriter::write_sequence_length(length : Int, max_elements? : UInt) -> Result[Unit, CdrError]
CdrReader::read_byte_sequence(max_elements? : UInt) -> Result[BytesView, CdrError]
CdrWriter::write_byte_sequence(value : BytesView, max_elements? : UInt) -> Result[Unit, CdrError]
```

| Rule | Contract |
|---|---|
| Wire layout | Endian-aware aligned `UInt32` element count, then elements under normal CDR1 alignment |
| Optional `max_elements` | Counts elements. Exact bound succeeds; bound + 1 yields `bounds_exceeded` before allocation or writer mutation |
| `read_sequence_length` | Applies `max_stream_bytes` as the absolute element-work ceiling before host `Int` conversion and returns a bounded `Int` suitable for element loops |
| `read_byte_sequence` | One complete field preflight; returns a borrowed zero-copy `BytesView`. `max_temporary_allocation` remains for owned allocations only |
| `write_byte_sequence` | One complete field preflight, then direct emission into the owned writer buffer |
| Large `UInt` bounds | Values above the host `Int` domain stay open relative to Phase 1 absolute ceilings (same rule as Char8 / wstring bounds) |
| Fault atomicity | Count, arithmetic, ceiling, truncation, and capacity faults restore the count-field cursor on the reader and leave writer position and bytes unchanged |

### Nested values

Public direction:

```text
CdrNesting          // immutable token; public depth() observation
CdrReader::root_nesting() / CdrWriter::root_nesting()  // depth 0
CdrReader::enter_nested(parent) / CdrWriter::enter_nested(parent)  // child at depth + 1
```

| Rule | Contract |
|---|---|
| Depth budget | `depth <= max_nesting_depth` succeeds. The next level yields `bounds_exceeded` at the current reader/writer offset with `needed =` attempted depth and `remaining = max_nesting_depth` |
| Token model | Tokens carry depth by value, so sibling branches keep independent state. `enter_nested` leaves cursor and bytes unchanged |
| Generated use | Generated codecs pass the token through nested aggregate encode/decode calls |

### M1-01c3 acceptance focus

LE/BE sequence counts; exact and over element bounds; high-bit counts; borrowed-view physical identity; temporary-cap independence from borrowed spans; writer atomicity; fixed-array composition; nested structure composition; depth 64 accept / 65 reject and custom depth limits; cross-package public API compile-and-run coverage.

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
| ROS legacy wstring | M1-01c2b | `read_wstring` / `write_wstring` with optional `max_scalars`; accepted Unicode scalar slots; `invalid_wstring_scalar`; canonical encode exact (count + `N * 4`) |
| Declared zero tail | M1-01d0 | `ensure_complete_with_zero_tail(expected_tail_bytes)`; top-level completion independent of final member; Phase 1 declarations `0`/`4`/`12` |
| Corpus fixture bridge | M1-01d1 | Deterministic Bun bridge from committed corpus + tail-slack into package-internal `rclmbt/cdr/fixture_data_wbtest.mbt` (56 fixtures, CDR open + tail prefix proofs) |
| Fixed arrays | M1-01c3b | Schema-declared element count composed from existing element codecs; first-element body-origin alignment; optional fixed-width preflight via `checked_span_length` |
| Sequences | M1-01c3b | `read_sequence_length` / `write_sequence_length`; `read_byte_sequence` / `write_byte_sequence` with optional `max_elements`; stream work ceiling; borrowed byte views |
| Nesting | M1-01c3b | Immutable `CdrNesting` token; `root_nesting` / `enter_nested`; depth against `max_nesting_depth` |

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
| `trailing_data` | Strict completion requires a fully consumed stream, or declared zero-tail completion sees a length/content mismatch |

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

Legal ROS encoders may emit distinct bytes for one logical value, including exact samples and samples with top-level zero tail slack. Cross-row validation compares **decoded semantics** (and committed semantic digests) as the agreement criterion. When byte digests match across rows, the corpus records that equality as an additional observation.

### Round trip and malformed input

M1-01d proves:

- **M1-01d1 complete:** the committed corpus bridges into MoonBit white-box tests at [`rclmbt/cdr/fixture_data_wbtest.mbt`](../../rclmbt/cdr/fixture_data_wbtest.mbt) (85 306 bytes, SHA-256 `515a532a56f7b040591565665e98a0479e7798c4662b26dc730cb42031119499`). The generator joins `manifest.json` (SHA-256 `319cb1c55da8a236054ba625f3fdbd43e239bd13c74c523d7912618c02b9fa7f`) with independent `tail-slack.json` (SHA-256 `1531d011f0715e5b82fa675be266d97387db7dd55ed8ff06784b213ae6256984`), materializes all 56 binaries, opens each with `CdrReader::open_default`, checks endianness and zero tails, and asserts 18 multi-row comparison identities plus 2 big-endian singletons. Commands: `bun run cdr-moonbit-fixtures:check` / `just cdr-moonbit-fixtures-check`.
- decode of every committed fixture yields the expected semantic value (M1-01d2);
- exact and zero-tail fixtures for the same logical sample normalize to one semantic value;
- encode under Moonspan CDR1 uses exact form (zero top-level tail) and round-trips with semantic equality;
- malformed truncation, illegal lengths, and alignment overflow return the typed error taxonomy above;
- resource bounds reject oversized streams with stable codes;
- strict completion reports `trailing_data` on zero-tail samples; declared completion accepts exact end or the declared all-zero length;
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
| M1-01d | Authoritative corpus proof: top-level zero-tail completion (d0 complete), fixture bridge (d1 complete), semantic agreement, round trips, malformed input, resource bounds |

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
| ROS 2 Humble `rosidl_typesupport_fastrtps_cpp` template | https://raw.githubusercontent.com/ros2/rosidl_typesupport_fastrtps/humble/rosidl_typesupport_fastrtps_cpp/resource/msg__type_support.cpp.em | AbstractWString serialize: `u16string_to_wstring` then Fast-CDR `<<`; size budgeting contributes to top-level serialized-buffer zero tail (see `tail-slack.json`) |
| MoonBit core `@bytes` package | https://mooncakes.io/docs/moonbitlang/core/bytes | Core bytes and view APIs used for buffer slices |
| MoonBit language fundamentals | https://docs.moonbitlang.com/en/latest/language/fundamentals.html | Owned `Bytes` versus borrowed `BytesView` table and language-level slicing model |

Committed fixtures under [`conformance/cdr/`](../../conformance/cdr/README.md) are the binding Phase 1 wire contract for this profile. Fast-CDR v1.0.29 is the upstream reference for the core value layout. The Humble fastrtps typesupport template is the source reference for size budgeting associated with the observed top-level zero tail; actual 0/4/12 tail lengths are proven by [`tail-slack.json`](../../conformance/cdr/tail-slack.json). Generator provenance and row pins live in the corpus README. Schema identity across Humble and Jazzy is fixed by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).
