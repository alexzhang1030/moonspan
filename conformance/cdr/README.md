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
just cdr-corpus-check
just cdr-corpus-write
just cdr-corpus-reproduce
```

Root `bun run check` runs `cdr-corpus:check` after the R2WP agreement gate.

## Coverage

Primitives, little/big endian, arrays, bounds, strings, wide strings, nesting, PointCloud2, Service request/response, and Action goal/result/feedback. Humble schema identity uses `moonspan-schema-v1` bundle digests. Jazzy uses native `rep2011-rihs` values with committed RIHS-to-bundle provenance. Each native case compares Fast DDS, Cyclone DDS, and Zenoh byte digests and records semantic equality.

## Serializer provenance

- Native little-endian fixtures use ROS RMW serialization through `rclcpp::Serialization` with zero-filled padding (`rmw_serialize_zero_padding_v1`).
- The big-endian primitive case uses the ROS-generated Fast-CDR typesupport callback (`rosidl_typesupport_fastrtps_cpp`) and records that serializer explicitly.
- Padding is pre-zeroed in a fixed buffer before serialize so cross-process padding is stable.
