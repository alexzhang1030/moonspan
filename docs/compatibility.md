# Compatibility strategy

Moonspan publishes support as an explicit matrix across ROS distro, RMW, topology, browser capability, transport, recording, and compatibility endpoint. Each supported row links to a reproducible qualification report.

## ROS platform baseline

- **Primary planning baseline:** ROS 2 Lyrical Luth.
- **First compatibility adapter:** ROS 2 Jazzy.
- **DDS matrix:** Fast DDS and Cyclone DDS.
- **Zenoh matrix:** a selected `rmw_zenoh` profile and a separately selected Zenoh router topology.
- **Domain rule:** one ROS domain selects one DDS or Zenoh mapping; gateway sessions aggregate configured domains.

ROS distro variation stays inside the versioned C ABI adapter. R2WP, `rclmbt`, and the browser SDK remain shared across adapters.

## Browser SDK capability tiers

| Tier | Required capabilities | Buffer path | Transport path | Intended qualification |
|---|---|---|---|---|
| A | Dedicated Worker, WebAssembly, WebTransport, transferable buffers | Transferable `ArrayBuffer`; optional isolated fast path | WebTransport over HTTP/3 plus WSS recovery | Primary high-rate SDK profile |
| B | Dedicated Worker, WebAssembly, binary WebSocket, transferable buffers | Transferable `ArrayBuffer` | WSS | Broad enterprise and proxy profile |
| C | Declared reduced feature set through the SDK | Implementation-specific bounded path | WSS | Functional compatibility profile |

Chrome, Edge, Safari, and Firefox receive explicit tier assignments from automated and manual evidence in M3. The common Studio prototype publishes its own rendering and media capability table for WebGPU, WebGL2, OffscreenCanvas, and WebCodecs.

## Transport compatibility

- WebTransport uses reliable streams and datagrams according to [R2WP channel mapping](./protocol/r2wp.md#channel-mapping).
- R2WP v0 qualifies the HTTP/3 mapping first; additional WebTransport mappings receive their own support rows.
- Binary WSS uses the same frame and control semantics through one scheduled connection.
- Reverse proxies, UDP 443, TLS termination, origin rules, idle timeouts, and maximum frame settings are part of the deployment profile.
- Network qualification covers loopback, 1 GbE LAN, constrained bandwidth, latency, loss, reordering, Wi-Fi roam, sleep/wake, and path change.

## External tool endpoints

- Foxglove WSS/CDR provides a declared compatibility endpoint and benchmark baseline.
- rosbridge JSON and CBOR-RAW provide declared legacy endpoints and benchmark baselines.
- Each endpoint has independent authentication, authorization, rate policy, metrics, logs, and advertised capability scope.
- Endpoint deployment can use isolated processes connected to the configured ROS graph and schema sources.

## Type compatibility

- Channel identity includes type name, RIHS hash, encoding, and schema generation.
- Generated MoonBit and TypeScript bindings cover pinned common and application interfaces.
- Dynamic type descriptions cover custom interfaces through recursive schema loading and lazy field projection.
- The corpus includes primitives, arrays, strings, wide strings, nesting, bounded and unbounded sequences, PointCloud2, Service, and Action types.
- Adapter reports record type-description availability and compatibility handling for each ROS baseline.

## Recording and replay

MCAP schema and channel identity map to the same type registry used by live R2WP sessions. The browser SDK presents live and replay samples through one subscription event model. Recording transfer uses independent reliable channels with checksum, range, bandwidth quota, and resume.

## Version compatibility

- R2WP uses explicit version negotiation and stable within-version registries.
- The C ABI uses versioned structures and a compatibility check at gateway startup.
- The browser SDK follows semantic versioning and publishes upgrade guidance for public API changes.
- Schemas use RIHS identity and generation tracking.
- Release artifacts pin Rust, MoonBit, Bun, ROS image, browser, and fixture versions.

## Qualification matrix fields

Every supported row records:

- release and code revision;
- ROS distro, image digest, RMW, middleware version, and domain mapping;
- OS, CPU architecture, browser version, Wasm mode, and buffer path;
- gateway transport, proxy, TLS, network profile, and deployment headers;
- graph, type, QoS, publish/subscribe, Service, Action, Parameter, Clock, reconnect, and policy results;
- performance summary, raw artifact location, known limits, and reviewer.

## Support changes

A new platform enters through adapter build evidence, semantic conformance, fault scenarios, performance qualification, deployment documentation, and an explicit support-tier decision. A support-tier change updates this document, the matrix, release notes, and SDK capability reporting together.
