# 0006: Isolate ROS integration behind a serialized C ABI

## Status

Accepted

## Date

2026-08-10

## Context

`rclwebd` must terminate browser transports, enforce policy, and schedule R2WP channels while attaching to ROS distros and RMW implementations that differ in handles, executors, type description sources, and deployment packaging. Browser clients need ROS semantics through versioned network contracts while robot credentials and native ROS libraries stay at the edge.

## Decision

Isolate ROS integration behind a versioned serialized C ABI.

- `rclwebd` Rust code owns TLS, R2WP transports, sessions, scheduling, schemas, policy, audit, metrics, recovery, and external compatibility routing.
- A distro-specific ROS adapter owns `rcl`/`rmw` handles, executor and readiness integration, graph discovery, type descriptions, clocks, and generic serialized ROS operations.
- The browser reaches ROS through the TypeScript SDK and R2WP contracts. ROS libraries and credentials stay in the edge environment.
- The adapter ABI uses versioned structs, fixed-width values, explicit lengths, opaque handles, stable error codes, and explicit buffer ownership and release operations.
- CDR bytes cross the ABI for topics, Service, and Action payloads. Graph, QoS, type, Parameter, Clock, and operation metadata use versioned ABI records.
- The initial process model uses one gateway process unit bound to one adapter support row ([ADR 0008](./0008-one-adapter-row-per-gateway-process.md)) with adapter-owned ROS execution.
- The initial SPSC topology uses one bounded adapter-to-Rust event queue and one bounded Rust-to-adapter command queue, with one producer and one consumer in each direction. Each queue declares sample and byte limits.
- ABI startup performs an explicit compatibility check. Each ROS distro/RMW combination builds and qualifies as an adapter support row.
- Each side contains panics or exceptions and converts failures into stable status records before returning across the ABI.
- Each allocator releases the buffers it created through explicit release operations.
- Buffer-sharing and multi-process isolation enter through later evidence-backed ADRs. M1 starts with a measurable one-copy path.

## Rationale

- A narrow serialized ABI concentrates ROS distro and RMW variation behind one adapter surface.
- Rust retains ownership of browser-facing transport, policy, and scheduling where resource budgets and audit identity live.
- CDR on the sample path preserves ROS serialization through gateway admission and R2WP delivery.
- Versioned structs, fixed-width fields, opaque handles, and explicit ownership give a measurable FFI boundary across language runtimes.
- One process with two bounded SPSC queues keeps M1 path length short while sample and byte limits stay observable in each direction.
- Adapter support rows make each ROS/RMW combination an explicit compatibility claim with its own evidence.

## Consequences

- M1 implements the generic serialized graph and publish/subscribe path through the ABI and measures the one-copy gateway route.
- Each supported ROS distro/RMW pair ships an adapter build, startup compatibility check, and qualification row.
- ABI calls return stable status records; each allocator owns and releases its buffers through explicit operations.
- Schema, graph, Parameter, Clock, Service, and Action metadata travel as versioned ABI records alongside CDR payloads.
- Later buffer-sharing or multi-process designs require a new ADR and measured evidence before replacing the M1 path.

## Revisit triggers

- One-copy path latency, throughput, copy count, or memory evidence falls outside an accepted gate.
- A required ROS distro/RMW combination needs ABI surface beyond versioned serialized operations and metadata records.
- Exception, allocator, or buffer-ownership evidence shows leakage across the Rust and adapter boundary.
- Deployment needs multi-process isolation or buffer-sharing with measured gains that justify a new process model.

## Source

Gateway ownership and ABI surface in [`rclwebd`](../gateway/rclwebd.md). Edge and ROS domain boundaries in [architecture](../architecture.md) and [architecture rationale](../../.agents/docs/architecture.md). Adapter support matrix in [compatibility](../compatibility.md).
