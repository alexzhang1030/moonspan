# Compatibility strategy

Moonspan publishes support as an explicit matrix across ROS distro, RMW, topology, browser capability, transport, recording, and compatibility endpoint. Each supported row links to a reproducible qualification report.

Exact support-profile image, browser, and environment pins, first-stage row IDs, and promotion status live in the [reference support profile](./support-matrix.md). This document owns strategy, tier language, and compatibility behavior. Gateway process and support-row topology follows [ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md).

## ROS platform baseline

- **First-stage distros:** ROS 2 Humble Hawksbill and ROS 2 Jazzy Jalisco.
- **First-stage hosts:** Humble on Ubuntu 22.04 Jammy; Jazzy on Ubuntu 24.04 Noble; each on `amd64` and `arm64`.
- **First-stage RMW rows:** `rmw_fastrtps_cpp` is the reference and default row on each distro; `rmw_cyclonedds_cpp` is the second qualification row. The four distro/RMW combinations are independent support rows (H-FT, H-CY, J-FT, J-CY).
- **Process and domain topology:** one gateway process binds exactly one support row; that process may host multiple ROS domain IDs under the selected row; cross-row composition uses independent SDK sessions.
- **Provenance fields:** graph, schema, channel, policy, audit, and evidence records carry `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable.
- **Startup validation:** each process validates support-row profile identity at startup; readiness surfaces `adapter_profile_mismatch` when configuration and artifact identity diverge.
- **Claim state:** every first-stage row is a **Qualification target** until a qualification report promotes it to **Qualified** under the rules in the [support matrix](./support-matrix.md).

ROS distro variation stays inside the versioned C ABI adapter. R2WP, `rclmbt`, and the browser SDK remain shared across adapters.

## Schema identity

Unified schema identity is the pair `(scheme, value)`. R2WP, the C ABI, caches, fixtures, and recording metadata carry `scheme`, `value`, type name, encoding, and schema generation together.

| Distro | Scheme | Behavior |
|---|---|---|
| Humble | `moonspan-schema-v1` | Complete recursive deployment bundle and manifest. Value is the SHA-256 digest of deterministic canonical bundle bytes. Channel open returns `schema_unavailable` when the required bundle is missing. |
| Jazzy | `rep2011-rihs` | Native `GetTypeDescription` with REP-2011 RIHS. Optional bundle-digest mapping records provenance and cross-version lookup while schemes stay independent. |

[ADR 0007](./adr/0007-humble-jazzy-schema-identity.md) owns this decision. Canonical bundle layout freezes in M0-04.

## Browser SDK capability tiers

| Tier | Required capabilities | Buffer path | Transport path | Intended qualification |
|---|---|---|---|---|
| A | Dedicated Worker, WebAssembly, WebTransport, transferable buffers | Transferable `ArrayBuffer`; optional isolated fast path | WebTransport over HTTP/3 plus WSS recovery | Primary high-rate SDK profile |
| B | Dedicated Worker, WebAssembly, binary WebSocket, transferable buffers | Transferable `ArrayBuffer` | WSS | Broad enterprise and proxy profile |
| C | Declared reduced feature set through the SDK | Implementation-specific bounded path | WSS | Functional compatibility profile |

The first-stage browser reference is Playwright-managed Chrome for Testing build 151.0.7922.34 pinned in the [support matrix](./support-matrix.md) (`@playwright/test` 1.62.0, Playwright image `v1.62.0-noble`). Chrome, Edge, Safari, and Firefox receive explicit tier assignments from automated and manual evidence in M3. The common Studio prototype publishes its own rendering and media capability table for WebGPU, WebGL2, OffscreenCanvas, and WebCodecs.

## Transport compatibility

- WebTransport uses reliable streams and datagrams according to [R2WP channel mapping](./protocol/r2wp.md#channel-mapping).
- R2WP v0 qualifies the HTTP/3 mapping first; additional WebTransport mappings receive their own support rows.
- Binary WSS uses the same frame and control semantics through one scheduled connection.
- Reverse proxies, UDP 443, TLS termination, origin rules, idle timeouts, and maximum frame settings are part of the deployment profile.
- Network qualification covers loopback, 1 GbE LAN, constrained bandwidth, latency, loss, reordering, Wi-Fi roam, sleep/wake, and path change. Isolated full-duplex 1 GbE LAN is the reference network profile in the [support matrix](./support-matrix.md).

## External tool endpoints

- Foxglove WSS/CDR provides a declared compatibility endpoint and benchmark baseline.
- rosbridge JSON and CBOR-RAW provide declared legacy endpoints and benchmark baselines.
- Each endpoint has independent authentication, authorization, rate policy, metrics, logs, and advertised capability scope.
- Endpoint deployment can use isolated processes connected to the configured ROS graph and schema sources.

## Type compatibility

- Channel identity includes type name, schema identity `(scheme, value)`, encoding, and schema generation.
- Generated MoonBit and TypeScript bindings cover pinned common and application interfaces.
- Dynamic type descriptions cover custom interfaces through recursive schema loading and lazy field projection.
- The corpus includes primitives, arrays, strings, wide strings, nesting, bounded and unbounded sequences, PointCloud2, Service, and Action types.
- Adapter reports record type-description availability, identity scheme, and compatibility handling for each ROS baseline.

## Recording and replay

MCAP schema and channel identity map to the same type registry used by live R2WP sessions, including `(scheme, value)`, type name, encoding, and schema generation. The browser SDK presents live and replay samples through one subscription event model. Recording transfer uses independent reliable channels with checksum, range, bandwidth quota, and resume.

## Version compatibility

- R2WP uses explicit version negotiation and stable within-version registries.
- The C ABI uses versioned structures and a compatibility check at gateway startup.
- Each gateway process validates support-row profile identity at startup and keeps `support_row_id` immutable for the running artifact.
- The browser SDK follows semantic versioning and publishes upgrade guidance for public API changes.
- Schemas use `(scheme, value)` identity and generation tracking.
- Release artifacts pin ROS image digests, browser runner, and fixture versions as recorded in the [support matrix](./support-matrix.md). M0-02 pins Rust, MoonBit, and Bun in repository manifests; qualification reports record those resolved versions.

## Qualification matrix fields

Every qualification report records:

- release and code revision;
- `support_row_id`, ROS distro, multi-arch image digest, per-architecture manifest digest, RMW, middleware version, adapter ABI/profile identity, and exercised `domain_id` values;
- `gateway_instance_id` and readiness/profile-validation results;
- OS, CPU architecture, browser version, Wasm mode, and buffer path;
- gateway transport, proxy, TLS, network profile, and deployment headers;
- graph, type identity (`scheme` + `value`), QoS, publish/subscribe, Service, Action, Parameter, Clock, reconnect, and policy results;
- performance summary, raw artifact location, known limits, and reviewer.

A row moves from **Qualification target** to **Qualified** when its report set passes the evidence gates in [validation](./validation.md) and human review accepts the row for the named release revision.

## Later expansion candidates

These profiles form the post-first-stage expansion set and enter through independent qualification stages:

- ROS distros Kilted, Lyrical, and Rolling;
- selected `rmw_zenoh` profiles and Zenoh router topologies;
- broader browser tiers beyond the Playwright/Chrome reference;
- additional WebTransport mappings and process or buffer experiments covered by later ADRs.

[ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md) is the first-stage process and support-row baseline. Each later candidate receives an explicit process and topology decision during its independent qualification. Router-backed or in-process multi-row topology changes require a dedicated ADR and evidence.

## Support changes

A new platform enters through adapter build evidence, semantic conformance, fault scenarios, performance qualification, deployment documentation, and an explicit support-tier decision. A support-tier change updates this document, the [support matrix](./support-matrix.md), release notes, and SDK capability reporting together. Immutable digests and exact tool or browser versions change through reviewed matrix revision and fresh qualification evidence.
