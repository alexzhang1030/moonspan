# Moonspan execution checklist

Status values: `[ ]` queued, `[~]` active, `[x]` verified.

## M0: Foundation

- [~] M0-01 Close architecture, support-profile, ownership, and licensing decisions.
- [~] M0-02 Complete root tooling, workspaces, and reviewed hosted CI evidence.
- [x] M0-03 Freeze R2WP v0 and establish cross-language agreement. See the [completion note](../docs/milestones/m0-03-r2wp-foundation.md).
- [x] M0-04 Generate the authoritative ROS CDR corpus (six Phase 1 rows H-FT/H-CY/H-ZN/J-FT/J-CY/J-ZN; `bun run cdr-corpus:check` / `just cdr-corpus-check`; focused `bun run test:cdr-corpus`).
- [ ] M0-05 Establish the evidence harness and report schema.

### M0 gate

- [ ] Decisions and support profile receive review.
- [ ] Root commands pass from a clean checkout and hosted evidence receives review.
- [ ] R2WP, CDR, and evidence artifacts reproduce.
- [ ] Human review approves M1.

## M1: Core data path

- [ ] M1-01 Implement `cdr_mbt`.
- [ ] M1-02 Implement generated types and the type registry.
- [ ] M1-03 Establish the Wasm host ABI and executor poll loop.
- [ ] M1-04 Implement the serialized ROS C ABI.
- [ ] M1-05 Build the gateway graph, schema, telemetry, and scheduler core.
- [ ] M1-06 Implement WebTransport, WebSocket, and the browser I/O Worker.
- [ ] M1-07 Deliver graph and publish/subscribe through the browser SDK.
- [ ] M1-08 Qualify the headless PointCloud2 path and issue the gate report.

### M1 gate

- [ ] CDR, graph, and bidirectional publish/subscribe conformance pass.
- [ ] Transport, buffer, memory, reconnect, and fault targets pass.
- [ ] Human review approves M2.

## M2: ROS semantics

- [ ] M2-01 Complete dynamic type descriptions and lazy projection.
- [ ] M2-02 Complete QoS and durability conformance.
- [ ] M2-03 Deliver Service semantics.
- [ ] M2-04 Deliver Action semantics.
- [ ] M2-05 Deliver Parameter semantics.
- [ ] M2-06 Complete Clock and simulation-time behavior.
- [ ] M2-07 Add MCAP recording and replay adapters.
- [ ] M2-08 Validate multi-domain DDS sessions.
- [ ] M2-09 Stabilize the public browser SDK.
- [ ] M2-10 Issue the N2 semantic gate report.

### M2 gate

- [ ] N2 conformance and type agreement pass.
- [ ] Live, replay, and multi-domain behavior pass.
- [ ] Human review approves M3.

## M3: Production release

- [ ] M3-01 Implement OIDC identity and session lifecycle.
- [ ] M3-02 Enforce SROS2, operation ACLs, and audit.
- [ ] M3-03 Enforce resource and command safety policy.
- [ ] M3-04 Automate compatibility endpoints and qualification.
- [ ] M3-05 Package deployment and observability.
- [ ] M3-06 Run fuzzing, soak, fault, and performance qualification.
- [ ] M3-07 Publish the SDK, examples, migration guides, and operations docs.
- [ ] M3-08 Complete the mainline release gate.

### M3 gate

- [ ] Security, compatibility, operations, and qualification evidence pass.
- [ ] Packages and supply-chain artifacts publish.
- [ ] Human review approves the mainline release and opens U0 and X0.

## U0: Common Studio prototype

- [ ] U0-01 Freeze the prototype contract and frontend decisions.
- [ ] U0-02 Build the shell, layout, workspace state, and subscription broker.
- [ ] U0-03 Build Graph Explorer and Context Inspector.
- [ ] U0-04 Build Plot, Raw, Diagnostics, and Log panels.
- [ ] U0-05 Build 3D, TF, map, and PointCloud2 rendering.
- [ ] U0-06 Build the camera and WebCodecs path.
- [ ] U0-07 Complete workspace, timeline, commands, sharing, and accessibility.
- [ ] U0-08 Qualify and publish the common prototype.

### U0 gate

- [ ] Workflows, performance, browser tiers, accessibility, and command safety pass.
- [ ] Human review accepts the prototype.

## X0: N3 experiment

- [ ] X0-01 Measure an upstream ROS package Wasm sandbox.
- [ ] Human review records the continuation scope.

## Kickoff decisions

The [decision register](./plan.md#13-kickoff-decision-register) owns details and closure artifacts.

- [ ] D-01 Reference qualification environment.
- [ ] D-02 Named workstream and review owners.
- [x] D-03 Bun version and workspace convention.
- [ ] D-04 OIDC provider and SROS2 environment.
- [ ] D-05 Benchmark artifact retention and publication.
- [ ] D-06 Repository and third-party licensing policy.
