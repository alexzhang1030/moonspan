# Product scope

rclweb gives browser applications typed, secure access to ROS 2. Robotics developers, integration engineers, operators, fleet teams, and application teams consume it through a TypeScript package that matches rclcpp shape.

## What ships

| Piece | Role |
|---|---|
| R2WP | Versioned binary protocol for ROS data and control over WebTransport and binary WebSocket |
| `rclweb` core | Rust core for protocol, CDR, ROS state, types, QoS, and operations — native in the gateway, wasm32 in the browser |
| `rclwebd` | Rust edge gateway for ROS attachment, scheduling, identity, policy, audit, and operations |
| TypeScript package `rcl-web` | Application API: [how to](./typescript.md), [reference](./api.md) |
| Corpus and gates | Committed CDR fixtures, live talker e2e, support-matrix rows |

## Users

| User | Need |
|---|---|
| Robotics developer | Typed topics, operations, clocks, schemas, graph state, and QoS |
| Integration engineer | Reproducible interoperability and traceable failures |
| Robot operator | Scoped commands, connection health, audit identity, and recovery |
| Fleet team | A controlled edge boundary across robot domains and networks |
| Application team | A stable package for custom operational interfaces |

## Contracts

- ROS semantics execute in browser Wasm through the `rclweb` core.
- CDR stays on the binary data path. There is no JSON transcoding on the sample path.
- Every queue and resource-sensitive operation has visible budgets and telemetry.
- Operation ACLs, resource control, and audit meet at `rclwebd`. Authenticate and SROS2 stay off / parked ([open work](../tasks/plan.md)). The reference ACL matrix is [acl-reference.json](./acl-reference.json).
- WebTransport and binary WebSocket share one R2WP semantic contract.
- Generated and dynamic types share a schema-identity registry.
- A support row is **Qualified** only when a human updates the [support matrix](./support-matrix.md).

## What this is not

- Not a second ROS client library. The browser core is an R2WP protocol client with rcl-shaped semantics; the gateway binds the serialized rcl surface ([ADR 0010](./adr/0010-restructure-single-rust-core.md)).
- Not a visual robotics IDE. [Studio](./prototypes/studio-ui.md) is an optional post-release UI that consumes the released package.
- Not a sandbox for running arbitrary upstream ROS packages in Wasm. That remains a later experiment.

## Wire and runtime agreement

The mainline requires wire agreement (CDR, schemas, graph, QoS, ROS time) and a browser runtime that performs the planned ROS operations against a live gateway. Support claims need a reviewed **Qualified** row, not only a green CI job.
