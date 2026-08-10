# `rclwebd` edge gateway

`rclwebd` is Moonspan's controlled edge boundary between browser sessions and ROS 2 domains. Rust owns transport, scheduling, sessions, schemas, policy, audit, metrics, and recovery. A narrow C ABI adapter owns distro-specific `rcl` and `rmw` integration.

**Status:** design baseline. M1 proves generic serialized graph and publish/subscribe; M2 expands ROS semantics; M3 qualifies production controls and operations.

## Responsibilities

- terminate TLS 1.3 for WebTransport/HTTP3 and WSS;
- authenticate browser sessions and materialize effective policy;
- discover ROS graph, endpoint, type, QoS, and liveliness state;
- obtain and cache recursive type descriptions by RIHS hash;
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
  crates/schema/         graph generations, RIHS cache, descriptions
  crates/policy/         ACL, resource limits, command policy, audit
  crates/telemetry/      metrics, traces, structured logs
  ros_adapter/include/   versioned C ABI
  ros_adapter/src/       distro and RMW integration
  tests/                 fixtures, fault tests, topology integration
```

## Narrow ROS C ABI

The adapter exposes generic serialized operations and explicit ownership. The planned surface covers:

- initialize, shutdown, and domain attachment;
- graph snapshot, ordered graph delta, endpoint QoS, and liveliness;
- subscribe, unsubscribe, take serialized sample, publish serialized sample;
- create, call, respond to, cancel, and destroy Service operations;
- create and drive Action goal, feedback, result, status, and cancellation operations;
- list, describe, get, set, and observe Parameter operations;
- query ROS and simulation clock state;
- fetch recursive type descriptions and RIHS hashes;
- poll readiness and release adapter-owned buffers.

ROS provides serialized publish and subscription capabilities through `rcl` and `rmw`; [internal interface documentation](https://docs.ros.org/en/rolling/Concepts/Advanced/About-Internal-Interfaces.html) and [RMW implementation guidance](https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html) define the integration surface.

The ABI uses fixed-width types, versioned structures, explicit lengths, opaque handles, caller-visible error codes, and ownership functions. Distro variation stays behind this boundary.

## Process and data path

The initial implementation uses one gateway process and a bounded SPSC exchange with the ROS adapter:

1. The adapter polls ROS readiness and places serialized events into a bounded ring.
2. Rust consumes events, resolves graph and schema identity, evaluates session policy, and admits each event to a channel queue.
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
- Endpoint records carry name, kind, type, RIHS hash, QoS, liveliness, domain, and adapter source.
- Schemas are keyed by RIHS hash and include recursive type description, encoding, source, and cache generation.
- Session policy filters the graph and schema view before transmission.
- Channel setup pins its graph and schema generation.
- Cache invalidation produces a structured channel transition and observable reason.

## Session lifecycle

```text
TLS connection
  -> hello and capability negotiation
  -> short-lived identity validation
  -> effective policy and resource envelope
  -> graph/schema synchronization
  -> channel operations
  -> graceful close or resumable interruption
```

Resume state includes session identity, acknowledged channel sequences, graph generation, policy revision, and expiry. A policy or schema generation change can require channel reauthorization during resume.

## ROS domain and fleet topology

A ROS domain selects one mapping:

- Fast DDS through its RMW;
- Cyclone DDS through its RMW;
- `rmw_zenoh` for a Zenoh-backed ROS domain;
- a selected Zenoh router topology through its explicit bridge process.

Gateway sessions aggregate multiple configured domains and retain domain identity on graph, schema, channel, policy, and audit records. [Compatibility](../compatibility.md) owns supported combinations.

## Compatibility endpoints

- Foxglove WSS/CDR runs as a declared capability with its own session, policy, and metrics.
- rosbridge JSON and CBOR-RAW run as declared capabilities with their own session, policy, and metrics.
- Compatibility endpoints share configured graph and schema sources while retaining their native wire contracts.
- Deployment can isolate each compatibility process from the primary R2WP gateway.

## Operations

The gateway exposes:

- liveness and readiness for process, ROS attachment, transport, identity provider, and policy source;
- Prometheus-style counters, gauges, histograms, and stable reason labels;
- structured logs carrying session, channel, operation, goal, domain, and trace identity;
- audit output with integrity and retention controls;
- configuration validation and effective-configuration output;
- graceful drain, restart, session expiry, and bounded recovery behavior.

Deployment artifacts cover container images, reverse proxy and UDP 443 setup, TLS certificates, SROS2 enclave mounting, OIDC configuration, COOP/COEP headers, storage, observability, upgrade, rollback, and recovery.

## Required evidence

- cross-language R2WP fixture agreement;
- serialized ROS interoperability across the declared distro/RMW matrix;
- bounded-memory behavior under sustained load and stalled consumers;
- fairness and deadline behavior across mixed channel classes;
- reconnect and resume behavior across gateway restart and network transitions;
- policy and audit conformance for every operation kind;
- fault injection across adapter, schema, identity, transport, and storage dependencies.
