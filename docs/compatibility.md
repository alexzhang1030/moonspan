# Compatibility strategy

rclweb publishes support as reviewed matrix rows across ROS, RMW, CPU architecture, browser capability, transport, buffer path, network profile, and compatibility endpoint. Exact pins and row state live in the [support matrix](./support-matrix.md).

## Support rows

| Row | ROS | RMW | Host |
|---|---|---|---|
| H-FT | Humble | `rmw_fastrtps_cpp` | Ubuntu 22.04 |
| H-CY | Humble | `rmw_cyclonedds_cpp` | Ubuntu 22.04 |
| H-ZN | Humble | `rmw_zenoh_cpp` | Ubuntu 22.04 |
| J-FT | Jazzy | `rmw_fastrtps_cpp` | Ubuntu 24.04 |
| J-CY | Jazzy | `rmw_cyclonedds_cpp` | Ubuntu 24.04 |
| J-ZN | Jazzy | `rmw_zenoh_cpp` | Ubuntu 24.04 |

Each row qualifies independently on `amd64` and `arm64`. One gateway process binds one row and may host multiple ROS domain IDs. Applications combine independent sessions across rows. Startup validates the row and adapter profile before readiness.

ROS variation stays behind the versioned adapter ABI. R2WP, the `rclweb` core, and the TypeScript package remain shared.

## Schema identity

| ROS | Scheme | Acquisition |
|---|---|---|
| Humble | `rclweb-schema-v1` | Recursive deployment bundle and manifest |
| Jazzy | `rep2011-rihs` | Native `GetTypeDescription` |

R2WP, the adapter, caches, fixtures, and recordings carry schema identity `(scheme, value)`, type name, encoding, and generation. [ADR 0007](./adr/0007-humble-jazzy-schema-identity.md) owns the decision.

## Browser tiers

| Tier | Capability | Transport |
|---|---|---|
| A | Worker, Wasm, WebTransport, transferable buffers, optional isolated fast path | WebTransport with WebSocket recovery |
| B | Worker, Wasm, binary WebSocket, transferable buffers | Binary WebSocket |
| C | Declared reduced package capability set | Binary WebSocket |

The support matrix pins the browser reference. Broader browser tiers come from automated and manual evidence. Studio publishes separate graphics and media tiers with the [Studio prototype](./prototypes/studio-ui.md).

## Transport and network

- WebTransport uses reliable streams and datagrams according to [R2WP channel mapping](./protocol/r2wp.md#channel-mapping).
- Binary WebSocket carries the same semantic frames through one scheduled connection.
- Proxy, TLS, origin, timeout, frame-size, and browser-isolation settings belong to the deployment profile ([deploy](./deploy.md)).
- Network evidence covers loopback, reference LAN, constrained bandwidth, latency, loss, reordering, roaming, sleep and wake, and path changes.

## External endpoints

Foxglove WSS/CDR and rosbridge JSON or CBOR-RAW are explicit compatibility capabilities. Each endpoint has its own authentication, authorization, rate policy, metrics, logs, and advertised scope.

## Types, recording, and versions

Generated bindings cover pinned interfaces. Dynamic descriptions cover custom interfaces through recursive schemas and lazy projection. Conformance includes core ROS containers, PointCloud2, Service, and Action types.

MCAP uses the same schema and channel identity model as live sessions. The TypeScript package presents live and replay samples through one event contract.

R2WP negotiates wire versions, the adapter ABI uses versioned structures, the TypeScript package follows semantic versioning, and release artifacts pin their qualified environments.

## Qualification and expansion

A support row records its code and environment identity, adapter profile, gateway and domain provenance, browser and buffer path, transport and network profile, semantic results, performance summary, raw evidence, limits, and reviewer. A row becomes **Qualified** after its evidence passes [validation](./validation.md) and human review.

The six support rows already include Fast DDS, Cyclone DDS, and Zenoh (`rmw_zenoh_cpp`) as first-class rows. Later expansion covers Kilted, Lyrical, Rolling, broader browser tiers, Zenoh router topologies beyond those rows, and additional transport or process topologies. Each candidate receives an independent matrix revision and qualification cycle.
