# Project intent

Moonspan gives browser applications typed, secure access to ROS 2 through a versioned protocol, a browser runtime, an edge gateway, and a TypeScript SDK.

## Mainline

The mainline follows this order:

1. Freeze contracts, fixtures, supported profiles, tooling, and evidence formats.
2. Deliver graph and publish/subscribe through `rclmbt`, `rclwebd`, and the SDK.
3. Complete ROS semantics, dynamic types, QoS, recording, and topology support.
4. Qualify identity, policy, compatibility, deployment, and operations.
5. Publish a stable SDK and release package.

## Users

| User | Need |
|---|---|
| Robotics developer | Typed topics, operations, clocks, schemas, graph state, and QoS |
| Integration engineer | Reproducible conformance, diagnostics, and traceable failures |
| Robot operator | Scoped commands, clear capabilities, audit identity, and recovery |
| Fleet team | A controlled edge boundary across domains and network topologies |
| Application team | A stable SDK for purpose-built interfaces |

## Product contracts

- `rclmbt` owns deterministic browser-side ROS state and CDR behavior.
- R2WP carries CDR and control data over bounded, observable transports.
- `rclwebd` owns ROS attachment, identity, policy, scheduling, schema, audit, and operations at the edge.
- Supported profiles carry conformance, performance, security, and deployment evidence.
- The SDK exposes the reusable public application contract.

## Post-release work

The common Studio prototype starts at U0 after the mainline release and exercises the public SDK through a reusable robotics UI. The N3 sandbox is a separate experiment that measures selected upstream ROS packages in Wasm.

Mainline work improves ROS semantics, bounded data flow, secure edge attachment, compatibility, evidence, SDK quality, operations, or release quality. Studio demonstrates those released contracts as an application.
