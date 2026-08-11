# Product scope

Moonspan gives browser applications typed, secure, and measurable access to ROS 2. The mainline serves robotics developers, integration engineers, operators, fleet teams, and application teams through a stable SDK.

## Mainline outcome

| Deliverable | Role |
|---|---|
| R2WP | Versioned binary protocol for ROS data and control over WebTransport and binary WebSocket |
| `rclmbt` | MoonBit/Wasm runtime for ROS state, CDR, types, QoS, and operations |
| `rclwebd` | Rust edge gateway for ROS attachment, scheduling, identity, policy, audit, and operations |
| Browser SDK | TypeScript APIs, Worker hosts, typed data, sessions, telemetry, and examples |
| Qualification package | Fixtures, conformance, benchmarks, security evidence, deployment assets, and release records |

Delivery follows a dependency chain: contracts and fixtures, core data path, ROS semantics, production qualification, and release.

## User needs

| User | Need |
|---|---|
| Robotics developer | Typed topics, operations, clocks, schemas, graph state, and QoS |
| Integration engineer | Reproducible interoperability and traceable failures |
| Robot operator | Scoped commands, connection health, audit identity, and recovery |
| Fleet team | A controlled edge boundary across robot domains and networks |
| Application team | A stable SDK for custom operational interfaces |

## Product contracts

- ROS semantics execute in browser Wasm through `rclmbt`.
- CDR stays on the binary data path.
- Every queue and resource-sensitive operation has visible budgets and telemetry.
- Identity, SROS2 policy, operation ACLs, resource control, and audit meet at `rclwebd`.
- WebTransport and binary WebSocket share one R2WP semantic contract.
- Generated and dynamic types share a schema-identity registry.
- Support claims require a reviewed **Qualified** row in the [support matrix](./support-matrix.md).

## Native levels

| Level | Meaning | Role |
|---|---|---|
| N1 Wire-native | CDR, schemas, graph, QoS, and ROS time agree across the wire | Mainline foundation |
| N2 Runtime-native | Browser Wasm provides the planned ROS runtime semantics | Mainline runtime |
| N3 Package-native | Selected upstream ROS packages run in Wasm | Post-release experiment |

## Common Studio prototype

Studio is a post-mainline side project. It demonstrates the released SDK through a generic robotics workspace with graph inspection, visual panels, replay, and command workflows. Its scope lives in [Common Studio prototype](./prototypes/studio-ui.md).

Mainline work improves ROS semantics, bounded data flow, secure edge attachment, compatibility, evidence, SDK quality, operations, or release quality. Studio consumes those released contracts as an application.
