# Compatibility strategy

Moonspan publishes support as reviewed matrix rows across ROS, RMW, CPU architecture, browser capability, transport, buffer path, network profile, and compatibility endpoint. Exact pins and row state live in the [support matrix](./support-matrix.md).

## Phase 1 ROS profile

| Row | ROS | RMW | Host |
|---|---|---|---|
| H-FT | Humble | `rmw_fastrtps_cpp` | Ubuntu 22.04 |
| H-CY | Humble | `rmw_cyclonedds_cpp` | Ubuntu 22.04 |
| J-FT | Jazzy | `rmw_fastrtps_cpp` | Ubuntu 24.04 |
| J-CY | Jazzy | `rmw_cyclonedds_cpp` | Ubuntu 24.04 |

Each row qualifies independently on `amd64` and `arm64`. One gateway process binds one row and may host multiple ROS domain IDs. Applications combine independent sessions across rows. Startup validates the row and adapter profile before readiness.

ROS variation stays behind the versioned adapter ABI. R2WP, `rclmbt`, and the SDK remain shared.

## Schema identity

| ROS | Scheme | Acquisition |
|---|---|---|
| Humble | `moonspan-schema-v1` | Recursive deployment bundle and manifest |
| Jazzy | `rep2011-rihs` | Native `GetTypeDescription` |

R2WP, the adapter, caches, fixtures, and recordings carry schema identity `(scheme, value)`, type name, encoding, and generation. [ADR 0007](./adr/0007-humble-jazzy-schema-identity.md) owns the decision.

## Browser tiers

| Tier | Capability | Transport |
|---|---|---|
| A | Worker, Wasm, WebTransport, transferable buffers, optional isolated fast path | WebTransport with WebSocket recovery |
| B | Worker, Wasm, binary WebSocket, transferable buffers | Binary WebSocket |
| C | Declared reduced SDK capability set | Binary WebSocket |

The support matrix pins the Phase 1 browser reference. M3 assigns broader browser tiers from automated and manual evidence. Studio publishes separate graphics and media tiers at U0.

## Transport and network

- WebTransport uses reliable streams and datagrams according to [R2WP channel mapping](./protocol/r2wp.md#channel-mapping).
- Binary WebSocket carries the same semantic frames through one scheduled connection.
- Proxy, TLS, origin, timeout, frame-size, and browser-isolation settings belong to the deployment profile.
- Network evidence covers loopback, reference LAN, constrained bandwidth, latency, loss, reordering, roaming, sleep and wake, and path changes.

## External endpoints

Foxglove WSS/CDR and rosbridge JSON or CBOR-RAW are explicit compatibility capabilities. Each endpoint has its own authentication, authorization, rate policy, metrics, logs, and advertised scope.

## Types, recording, and versions

Generated bindings cover pinned interfaces. Dynamic descriptions cover custom interfaces through recursive schemas and lazy projection. Conformance includes core ROS containers, PointCloud2, Service, and Action types.

MCAP uses the same schema and channel identity model as live sessions. The SDK presents live and replay samples through one event contract.

R2WP negotiates wire versions, the adapter ABI uses versioned structures, the SDK follows semantic versioning, and release artifacts pin their qualified environments.

## Qualification and expansion

A support row records its code and environment identity, adapter profile, gateway and domain provenance, browser and buffer path, transport and network profile, semantic results, performance summary, raw evidence, limits, and reviewer. A row becomes **Qualified** after its evidence passes [validation](./validation.md) and human review.

Later expansion covers Kilted, Lyrical, Rolling, selected `rmw_zenoh` and Zenoh router profiles, broader browser tiers, and additional transport or process topologies. Each candidate receives an independent matrix revision and qualification cycle.
