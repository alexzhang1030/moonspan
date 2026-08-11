# Authoritative ROS CDR corpus (M0-04)

Pinned Humble and Jazzy CDR fixtures for the six Phase 1 support rows:

| Row | Distro | RMW |
|---|---|---|
| H-FT | humble | `rmw_fastrtps_cpp` |
| H-CY | humble | `rmw_cyclonedds_cpp` |
| H-ZN | humble | `rmw_zenoh_cpp` |
| J-FT | jazzy | `rmw_fastrtps_cpp` |
| J-CY | jazzy | `rmw_cyclonedds_cpp` |
| J-ZN | jazzy | `rmw_zenoh_cpp` |

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Corpus index: environments, fixtures, coverage, RMW comparisons, provenance |
| `tail-slack.json` | Top-level zero-tail evidence overlay (canonical prefix + zero suffix) |
| `fixtures/<row>/` | Per-row serialized `.bin` artifacts and `row.json` metadata |
| `fixtures/bundles/` | Canonical `moonspan-schema-v1` recursive interface bundles |
| `fixtures/provenance/jazzy-rihs-to-bundle.json` | Jazzy RIHS-to-bundle mapping |
| `generate/` | Dockerized ROS generator package and Dockerfile |
| `../interfaces/moonspan_cdr_interfaces/` | Corpus message, service, and action interfaces |

## Commands

```bash
bun run cdr-corpus:check       # rebuild metadata from committed artifacts and verify
bun run cdr-corpus:write       # regenerate against pinned ROS Docker images
bun run cdr-corpus:reproduce   # full pinned-environment reproduce gate
bun run test:cdr-corpus        # focused helper suite
bun run cdr-tail-slack:check   # verify top-level tail-slack evidence artifact
bun run cdr-tail-slack:write   # regenerate tail-slack.json from committed binaries
bun run test:cdr-tail-slack    # focused tail-slack helper suite
bun run cdr-moonbit-fixtures:check  # verify MoonBit white-box corpus bridge
bun run cdr-moonbit-fixtures:write  # regenerate rclmbt/cdr/fixture_data_wbtest.mbt
bun run test:cdr-moonbit-fixtures   # focused bridge helper suite
just cdr-corpus-check
just cdr-corpus-write
just cdr-corpus-reproduce
just cdr-tail-slack-check
just cdr-tail-slack-write
just cdr-moonbit-fixtures-check
just cdr-moonbit-fixtures-write
```

### MoonBit white-box bridge (M1-01d1)

Package-internal fixtures and CDR open/tail proofs generated from this corpus:

| Field | Value |
|---|---|
| Output | [`rclmbt/cdr/fixture_data_wbtest.mbt`](../../rclmbt/cdr/fixture_data_wbtest.mbt) |
| Size | 85 351 bytes |
| SHA-256 | `b1bff5ea561802909ce26dcdd304f978361f4dc7780f6aa779f6294a42e2c15d` |
| Fixtures / comparisons | 56 / 18 |
| Source manifest SHA-256 | `319cb1c55da8a236054ba625f3fdbd43e239bd13c74c523d7912618c02b9fa7f` |
| Source tail-slack SHA-256 | `1531d011f0715e5b82fa675be266d97387db7dd55ed8ff06784b213ae6256984` |
| Check | `bun run cdr-moonbit-fixtures:check` / `just cdr-moonbit-fixtures-check` |

Root `bun run check` runs `cdr-corpus:check`, then `cdr-tail-slack:check`, then `cdr-moonbit-fixtures:check` after the R2WP agreement gate.

## Top-level tail slack

Every committed fixture is a canonical logical prefix plus a zero-filled top-level suffix from RMW serializer capacity budgeting. The evidence file records per-fixture logical length and zero-tail length, plus the 18 cross-row comparison groups.

| Zero-tail length | Fixtures |
|---:|---:|
| 0 (exact) | 24 |
| 4 | 12 |
| 12 | 20 |

The 4- and 12-byte tails appear on Fast DDS and Zenoh little-endian rows. Cyclone rows, big-endian primitives, and PointCloud2 use exact logical length. The slack belongs to top-level serializer capacity; core wstring boundaries remain count plus N times 4. `echo_nested_response` ends on a `bool`, which confirms the tail sits outside the last member value boundary.

## Coverage

Primitives, little/big endian, arrays, bounds, strings, wide strings, nesting, PointCloud2, Service request/response, and Action goal/result/feedback. Humble schema identity uses `moonspan-schema-v1` bundle digests. Jazzy uses native `rep2011-rihs` values with committed RIHS-to-bundle provenance. Each native case compares Fast DDS, Cyclone DDS, and Zenoh byte digests and records semantic equality.

## Serializer provenance

- Native little-endian fixtures use ROS RMW serialization through `rclcpp::Serialization` with zero-filled padding (`rmw_serialize_zero_padding_v1`).
- The big-endian primitive case uses the ROS-generated Fast-CDR typesupport callback (`rosidl_typesupport_fastrtps_cpp`) and records that serializer explicitly.
- Padding is pre-zeroed in a fixed buffer before serialize so cross-process padding is stable.
