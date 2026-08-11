# `rclwebd` edge gateway

`rclwebd` is Moonspan's controlled edge boundary between browser sessions and ROS 2 domains. Rust owns transport, scheduling, sessions, schemas, policy, audit, metrics, and recovery. A narrow C ABI adapter owns distro-specific `rcl` and `rmw` integration.

**Status:** design baseline for gateway process work. M0-03f lands the R2WP v0 reference parser under [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) (bootstrap steps 1–9, selected-frame steps 1–16; review Accept commits `9c07b4a`, `cca270c`). M1 proves generic serialized graph and publish/subscribe; M2 expands ROS semantics; M3 qualifies production controls and operations.

Schema identity follows [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md). Process and support-row topology follows [ADR 0008](../adr/0008-one-adapter-row-per-gateway-process.md). Phase 1 distro, RMW, image, and row status live in the [support matrix](../support-matrix.md) (H-FT, H-CY, J-FT, J-CY).

## R2WP reference parser (M0-03f)

The crate exposes public `rclwebd::protocol` and reexports primary parser types and functions from crate root (`rclwebd::{parse_bootstrap, parse_frame, ProtocolError, …}`):

- `parse_bootstrap` — bootstrap receiver validation steps 1–9;
- `parse_frame` / `FrameOptions` — selected-frame steps 1–16;
- deterministic CBOR decode; extension TLV decode; CONTROL_CBOR decode for all 15 kinds with nested CDDL;
- `ProtocolError` agreement fields: registry code, name, reason, absolute offset, plane, step.

Locked tests load committed fixtures from [`protocol/testdata/`](../../protocol/testdata/README.md): all 20 valid entries (including the manifest-driven 64 MiB segment recipe) and all 55 malformed binaries (14 bootstrap / 41 frame). The `rclwebd` normal tree is std only. The `serde_json` dev dependency serves fixture tests. Focused verification: `cargo test --locked -p rclwebd`.

## Responsibilities

- terminate TLS 1.3 for WebTransport/HTTP3 and WSS;
- authenticate browser sessions and materialize effective policy;
- discover ROS graph, endpoint, type, QoS, and liveliness state;
- obtain and cache recursive type descriptions by schema identity `(scheme, value)`;
- bridge serialized topic, Service, Action, Parameter, and Clock operations;
- schedule R2WP channels under sample, byte, rate, bandwidth, concurrency, priority, and deadline budgets;
- emit stable policy, queue, transport, schema, and ROS failure reasons;
- correlate browser, gateway, and ROS traces;
- expose health, readiness, metrics, audit, and compatibility endpoints;
- host or route Foxglove and rosbridge compatibility processes.

## Planned structure

```text
rclwebd/
  crates/gateway/        process lifecycle, configuration, readiness
  crates/r2wp/           frame, control plane, versioning, transport adapters
  crates/session/        identity, resume, channel lifecycle
  crates/scheduler/      queues, fairness, priorities, deadlines, budgets
  crates/schema/         graph generations, (scheme, value) cache, descriptions
  crates/policy/         ACL, resource limits, command policy, audit
  crates/telemetry/      metrics, traces, structured logs
  ros_adapter/include/   versioned C ABI
  ros_adapter/src/       distro and RMW integration
  tests/                 fixtures, fault tests, topology integration
```

## Process and support-row binding

- One `rclwebd` process binds to exactly one adapter support row: H-FT, H-CY, J-FT, or J-CY.
- That process may create multiple ROS contexts and domain IDs under the same selected row.
- The four first-stage rows ship as separate process and image variants, each with its distro adapter, RMW selection, adapter ABI version, and support-row identity.
- `support_row_id` is immutable for the running artifact and profile.
- `gateway_instance_id` is a deployment-provided stable identifier for one logical gateway instance. It persists across ordinary process restart and in-place upgrade when resumable state is preserved. A replacement deployment or intentionally fresh instance receives a new identifier. Matching `gateway_instance_id` supports restart resume; a replacement instance drives a clean session.
- Startup validates configured `support_row_id`, ROS distro, selected RMW implementation identifier, adapter ABI version, and artifact profile.
- A mismatch yields stable readiness and startup status `adapter_profile_mismatch` on the readiness endpoint and in logs. A profile mismatch keeps the gateway outside the ready state.
- Graph, schema, channel, policy, metrics, logs, audit, and evidence records carry `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable.
- One R2WP session terminates at one gateway instance and one support row; the session may expose multiple domain IDs under that row.
- Cross-row fleet views use multiple independent SDK sessions and retain gateway, support-row, and domain provenance in the application layer.

## Narrow ROS C ABI

The adapter exposes generic serialized operations and explicit ownership. The planned surface covers:

- initialize, shutdown, and domain attachment;
- graph snapshot, ordered graph delta, endpoint QoS, and liveliness;
- subscribe, unsubscribe, take serialized sample, publish serialized sample;
- create, call, respond to, cancel, and destroy Service operations;
- create and drive Action goal, feedback, result, status, and cancellation operations;
- list, describe, get, set, and observe Parameter operations;
- query ROS and simulation clock state;
- fetch recursive type descriptions and schema identity records carrying `scheme` and `value`;
- poll readiness and release adapter-owned buffers.

ROS provides serialized publish and subscription capabilities through `rcl` and `rmw`; [internal interface documentation (Jazzy)](https://docs.ros.org/en/jazzy/Concepts/Advanced/About-Internal-Interfaces.html) and [RMW implementation guidance](https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html) define the integration surface.

Adapter schema acquisition:

- **Jazzy adapter:** acts as a client of a node's native `~/get_type_description` endpoint using the [`GetTypeDescription`](https://docs.ros.org/en/jazzy/p/type_description_interfaces/srv/GetTypeDescription.html) service; schema identity uses scheme `rep2011-rihs`.
- **Humble adapter:** generic serialized publish and subscribe plus installed runtime type support, combined with the complete recursive deployment bundle identified by `moonspan-schema-v1`.

The ABI uses fixed-width types, versioned structures, explicit lengths, opaque handles, caller-visible error codes, and ownership functions. Distro variation stays behind this boundary. C ABI schema records carry scheme, value, type name, encoding, and schema generation.

## Process and data path

The initial implementation uses one gateway process bound to one support row and a bounded SPSC exchange with the ROS adapter:

1. The adapter polls ROS readiness and places serialized events into a bounded ring.
2. Rust consumes events, resolves graph and schema identity `(scheme, value)`, attaches `gateway_instance_id`, `support_row_id`, and `domain_id`, evaluates session policy, and admits each event to a channel queue.
3. The scheduler selects control, reliable stream, datagram, or sample-stream work according to priority and deadlines.
4. Transport completion releases or recycles the buffer through its recorded owner.
5. Browser-originated operations follow the reverse path after policy and schema validation.

M1 targets a measurable one-copy gateway path. Later buffer-sharing work proceeds through evidence on adapter support, allocator ownership, and lifetime safety.

## Channel scheduler

Each channel declares:

- reliability and history behavior;
- maximum queued samples and bytes;
- maximum sample size;
- rate and bandwidth budgets;
- concurrency and in-flight operation limits;
- priority class, deadline, lifespan, and eviction policy;
- transient-local cache budget where applicable.

The scheduler gives control and cancellation traffic bounded latency, applies fair service across data channels, and records admission, delay, send, eviction, expiry, and cancellation outcomes. WSS uses the same scheduler before multiplexing frames into its single connection.

## Graph and schema registry

- Graph state has a monotonic generation and ordered deltas.
- Endpoint records carry name, kind, type name, schema identity `(scheme, value)`, encoding where relevant, schema generation, QoS, liveliness, `domain_id`, `support_row_id`, `gateway_instance_id`, and adapter source.
- Schema identity is exactly `(scheme, value)`. The schema cache key is `(scheme, value, type name, encoding, schema generation)`.
- Cached schema records include the normalized recursive type description, applicable source-bundle entries, encoding, source, and cache generation.
- Session policy filters the graph and schema view before transmission.
- Channel setup pins its graph generation, schema identity, schema generation, domain, and support-row provenance.
- Missing required Humble bundles surface `schema_unavailable` at channel open.
- Cache invalidation produces a structured channel transition and observable reason.

## Session lifecycle

```text
TLS connection
  -> hello and capability negotiation
  -> short-lived identity validation
  -> effective policy and resource envelope
  -> SessionReady with gateway/support-row profile
  -> graph/schema synchronization
  -> channel operations
  -> graceful close or resumable interruption
```

Resume state includes session identity, selected wire version, compatible negotiated capabilities, matching `gateway_instance_id` and immutable `support_row_id`, acknowledged channel sequences, graph generation, schema generation, policy revision, and expiry. Ordinary restart with the same `gateway_instance_id` and preserved resumable state may continue the session. A replacement `gateway_instance_id` or a `support_row_id` change requires a clean session and fresh authorization. A policy revision or schema generation change may require channel reauthorization during an otherwise valid resume.

## ROS domain and fleet topology

### First-stage domain mappings

A first-stage gateway process selects one support-matrix **Qualification target** row and may open multiple ROS domain IDs under that row:

- H-FT: Humble + `rmw_fastrtps_cpp` (reference / default on Humble);
- H-CY: Humble + `rmw_cyclonedds_cpp`;
- J-FT: Jazzy + `rmw_fastrtps_cpp` (reference / default on Jazzy);
- J-CY: Jazzy + `rmw_cyclonedds_cpp`.

Each row is a separate process and image variant. Gateway sessions retain `gateway_instance_id`, `support_row_id`, and `domain_id` on graph, schema, channel, policy, audit, and evidence records.

### Later-expansion topologies

These profiles form the post-first-stage expansion set and enter through independent support-matrix qualification:

- selected `rmw_zenoh` profiles for a Zenoh-backed ROS domain;
- selected Zenoh router topologies through their explicit bridge processes;
- Kilted, Lyrical, and Rolling distro adapters.

[Compatibility](../compatibility.md) owns strategy language for those stages.

## Compatibility endpoints

- Foxglove WSS/CDR runs as a declared capability with its own session, policy, and metrics.
- rosbridge JSON and CBOR-RAW run as declared capabilities with their own session, policy, and metrics.
- Compatibility endpoints share configured graph and schema sources while retaining their native wire contracts.
- Deployment can isolate each compatibility process from the primary R2WP gateway.

## Operations

The gateway exposes:

- liveness and readiness for process, ROS attachment, transport, identity provider, policy source, and adapter profile validation;
- Prometheus-style counters, gauges, histograms, and stable reason labels;
- structured logs carrying session, channel, operation, goal, `gateway_instance_id`, `support_row_id`, `domain_id`, schema identity, and trace identity;
- audit output with integrity and retention controls, including gateway, support-row, and domain provenance;
- configuration validation and effective-configuration output;
- graceful drain, restart, session expiry, and bounded recovery behavior.

Deployment artifacts cover per-row container images, reverse proxy and UDP 443 setup, TLS certificates, SROS2 enclave mounting, OIDC configuration, COOP/COEP headers, storage, observability, upgrade, rollback, and recovery.

## Required evidence

- cross-language R2WP fixture agreement;
- serialized ROS interoperability across the declared first-stage distro/RMW matrix, with multi-domain suites repeated independently per support row and CPU variant;
- schema identity handling for `rep2011-rihs` and `moonspan-schema-v1`, including missing-bundle behavior;
- startup validation and `adapter_profile_mismatch` behavior;
- bounded-memory behavior under sustained load and stalled consumers;
- fairness and deadline behavior across mixed channel classes;
- reconnect and resume behavior across gateway restart and network transitions, including gateway instance and support-row matching;
- policy and audit conformance for every operation kind;
- fault injection across adapter, schema, identity, transport, and storage dependencies.
