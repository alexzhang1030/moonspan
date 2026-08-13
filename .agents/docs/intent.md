# Project intent

rclweb gives browser applications typed, secure access to ROS 2 through a versioned protocol (R2WP), a single Rust core that runs natively at the edge and as Wasm in the browser, and a TypeScript SDK.

## Mainline

The mainline is one Rust core for gateway and browser ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)). Delivery follows the [implementation plan](../../tasks/plan.md):

1. R0–R3 complete: one implementation per side, walking skeleton, data-plane hardening, ROS semantics, H-FT, WebTransport.
2. R4 in progress: identity, policy, deployment, support-matrix qualification, and a stable SDK release.
3. U0 after release: Studio prototype.

## Users

| User | Need |
|---|---|
| Robotics developer | Typed topics, operations, clocks, schemas, graph state, and QoS |
| Integration engineer | Reproducible conformance, diagnostics, and traceable failures |
| Robot operator | Scoped commands, clear capabilities, audit identity, and recovery |
| Fleet team | A controlled edge boundary across domains and network topologies |
| Application team | A stable SDK for purpose-built interfaces |

## Product contracts

- The `rclweb` core owns deterministic ROS state, protocol codecs, and CDR behavior — one codebase for gateway and browser.
- R2WP carries CDR and control data over bounded, observable transports.
- `rclwebd` owns ROS attachment, identity, policy, scheduling, schema, audit, and operations at the edge.
- Supported profiles carry conformance, performance, security, and deployment evidence.
- The SDK exposes an rclcpp-shaped public application contract (`init` / `Node`) ([SDK](../../docs/sdk.md)).
- The repository is Apache-2.0; third-party crates on the published surface stay OSI-permissive ([licensing](../../docs/licensing.md)).

## Non-goals and posture

- No JSON transcoding on the sample path; CDR stays end to end.
- No client library reinvention: the browser core is an R2WP protocol client with rcl-shaped semantics, and the gateway binds the serialized-only rcl surface directly (owner constraint in ADR 0010).
- Contracts harden after they carry traffic; platform expansion enters through the [support matrix](../../docs/support-matrix.md).

## Post-release work

The common Studio prototype starts at U0 after the mainline release and exercises the public SDK through a reusable robotics UI. The N3 sandbox is a separate experiment that measures selected upstream ROS packages in Wasm.
