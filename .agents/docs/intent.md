# Project intent

rclweb gives browser applications typed, secure access to ROS 2 through a versioned protocol (R2WP), a single Rust core that runs natively at the edge and as Wasm in the browser, and a TypeScript SDK.

## Mainline

The mainline follows the restructure plan ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)):

1. R0: stop-loss — one implementation per side, one gated support row, a declared protocol subset.
2. R1: walking skeleton — a browser page subscribes to a live ROS 2 topic end-to-end.
3. R2: data-plane hardening — publish, QoS, budgets, adversarial fixtures, performance baseline.
4. R3: ROS semantics, generated types, second row, WebTransport.
5. R4: identity, policy, deployment, evidence, and a stable SDK release.

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
- The SDK exposes the reusable public application contract.

## Non-goals and posture

- No JSON transcoding on the sample path; CDR stays end to end.
- No client library reinvention: the browser core is an R2WP protocol client with rcl-shaped semantics, and the gateway binds the serialized-only rcl surface directly (owner constraint in ADR 0010).
- Contracts harden after they carry traffic; breadth (rows, transports, evidence harnesses) follows the walking skeleton, not the other way around.

## Post-release work

The common Studio prototype starts at U0 after the mainline release and exercises the public SDK through a reusable robotics UI. The N3 sandbox is a separate experiment that measures selected upstream ROS packages in Wasm.
