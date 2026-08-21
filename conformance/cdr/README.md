# Authoritative ROS CDR corpus

Pinned Humble and Jazzy CDR fixtures for the six support rows:

| Row | Distro | RMW |
|---|---|---|
| H-FT | humble | `rmw_fastrtps_cpp` |
| H-CY | humble | `rmw_cyclonedds_cpp` |
| H-ZN | humble | `rmw_zenoh_cpp` |
| J-FT | jazzy | `rmw_fastrtps_cpp` |
| J-CY | jazzy | `rmw_cyclonedds_cpp` |
| J-ZN | jazzy | `rmw_zenoh_cpp` |

This corpus is the oracle for `rclweb::cdr`. All six rows stay committed; live talker e2e covers each row. Humble identity is `rclweb-schema-v1` (SHA-256 of canonical bundle bytes); the corpus id is `rclweb-ros-cdr-v1`; interfaces live in `rclweb_cdr_interfaces` ([ADR 0012](../../docs/adr/0012-rclweb-schema-identifiers.md)). Those strings are part of the bundle hash — renaming them rehashes Humble `SchemaKey.value` without changing CDR payload bytes.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Corpus index: environments, fixtures, coverage, RMW comparisons, provenance |
| `tail-slack.json` | Top-level zero-tail evidence overlay (canonical prefix + zero suffix) |
| `fixtures/<row>/` | Per-row serialized `.bin` artifacts and `row.json` metadata |
| `fixtures/bundles/` | Canonical recursive interface bundles, named from the root type |
| `fixtures/provenance/jazzy-rihs-to-bundle.json` | Jazzy RIHS-to-bundle mapping |
| `generate/` | Dockerized ROS generator package and Dockerfile |
| `../interfaces/rclweb_cdr_interfaces/` | Corpus message, service, and action interfaces |

## Commands

```bash
bun run cdr-corpus:check       # rebuild metadata from committed artifacts and verify
bun run cdr-corpus:write       # regenerate against pinned ROS Docker images
bun run cdr-corpus:reproduce   # full pinned-environment reproduce gate
bun run test:cdr-corpus        # focused helper suite
bun run cdr-tail-slack:check   # verify top-level tail-slack evidence artifact
bun run cdr-tail-slack:write   # regenerate tail-slack.json from committed binaries
bun run test:cdr-tail-slack    # focused tail-slack helper suite
bun run generated-types:check  # metadata byte-identity check
bun run generated-types:write  # regenerate rclweb/generated/metadata/
bun run test:generated-types   # focused generated-types helper suite
just cdr-corpus-check
just cdr-corpus-write
just cdr-corpus-reproduce
just cdr-tail-slack-check
just cdr-tail-slack-write
just generated-types-check
just generated-types-write
just rosidl-dts-check
just rosidl-dts-write
```

Root `bun run check` runs `cdr-corpus:check`, `cdr-tail-slack:check`,
`generated-types:check`, and `rosidl-dts:check`.

## Top-level tail slack

Every committed fixture is a canonical logical prefix plus a zero-filled top-level suffix from RMW serializer capacity budgeting. The evidence file records per-fixture logical length and zero-tail length, plus the 18 cross-row comparison groups.

| Zero-tail length | Fixtures |
|---:|---:|
| 0 (exact) | 24 |
| 4 | 12 |
| 12 | 20 |

The 4- and 12-byte tails appear on Fast DDS and Zenoh little-endian rows. Cyclone rows, big-endian primitives, and PointCloud2 use exact logical length. The slack belongs to top-level serializer capacity; core wstring boundaries remain count plus N times 4. `echo_nested_response` ends on a `bool`, which confirms the tail sits outside the last member value boundary.

## Coverage

Primitives, little/big endian, arrays, bounds, strings, wide strings, nesting, PointCloud2, Service request/response, and Action goal/result/feedback. Humble schema identity uses `rclweb-schema-v1` bundle digests. Jazzy uses native `rep2011-rihs` values with committed RIHS-to-bundle provenance. Each native case compares Fast DDS, Cyclone DDS, and Zenoh byte digests and records semantic equality.

## Serializer provenance

- Native little-endian fixtures use ROS RMW serialization through `rclcpp::Serialization` with zero-filled padding (`rmw_serialize_zero_padding_v1`).
- The big-endian primitive case uses the ROS-generated Fast-CDR typesupport callback (`rosidl_typesupport_fastrtps_cpp`) and records that serializer explicitly.
- Padding is pre-zeroed in a fixed buffer before serialize so cross-process padding is stable.
