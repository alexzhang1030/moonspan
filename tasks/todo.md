# Moonspan execution checklist

Status values: `[ ]` queued, `[~]` active, `[x]` verified.

## M0 — Foundation, Weeks 1–2

- [ ] M0-01 Complete architecture ADRs and the reference support profile.
- [ ] M0-02 Bootstrap the monorepo, Bun workspaces, root commands, and CI.
- [ ] M0-03 Freeze R2WP v0 and cross-language golden frames.
- [ ] M0-04 Generate the authoritative ROS CDR corpus.
- [ ] M0-05 Establish the evidence harness and report schema.

### M0 gate

- [ ] ADR and support-profile review passes.
- [ ] Root commands pass from a clean checkout with pinned Bun.
- [ ] R2WP and CDR manifests reproduce.
- [ ] Evidence smoke artifacts validate and regenerate.
- [ ] Human review approves M1.

## M1 — Core data path, Weeks 3–6

- [ ] M1-01 Implement `cdr_mbt`.
- [ ] M1-02 Implement generated types and the type registry core.
- [ ] M1-03 Establish the Wasm host ABI and executor poll loop.
- [ ] M1-04 Implement the generic serialized ROS C ABI.
- [ ] M1-05 Build `rclwebd` graph, schema, and bounded scheduler core.
- [ ] M1-06 Implement WebTransport, WSS, and the browser I/O Worker.
- [ ] M1-07 Deliver graph and publish/subscribe through the browser SDK.
- [ ] M1-08 Qualify the PointCloud2 headless path and issue the M1 gate report.

### M1 gate

- [ ] CDR agreement reaches 100% for the M1 corpus.
- [ ] Graph and publish/subscribe operate bidirectionally across the declared matrix.
- [ ] Both transports and both browser buffer paths pass.
- [ ] PointCloud2, memory, transport, reconnect, and fault targets pass.
- [ ] Human review approves M2.

## M2 — ROS semantics, Weeks 7–12

- [ ] M2-01 Complete dynamic type descriptions and lazy projection.
- [ ] M2-02 Complete QoS and durability conformance.
- [ ] M2-03 Deliver Service semantics.
- [ ] M2-04 Deliver Action semantics.
- [ ] M2-05 Deliver Parameter semantics.
- [ ] M2-06 Complete Clock and simulation-time behavior.
- [ ] M2-07 Add MCAP recording and replay adapters.
- [ ] M2-08 Validate multi-domain sessions and Zenoh topologies.
- [ ] M2-09 Stabilize the public browser SDK contract.
- [ ] M2-10 Issue the N2 semantic gate report.

### M2 gate

- [ ] The planned N2 conformance surface passes.
- [ ] Dynamic and generated types agree across the declared corpus.
- [ ] Recording and live transport share one SDK event model.
- [ ] Multi-domain isolation and selected Zenoh profiles pass.
- [ ] Human review approves M3.

## M3 — Production release, Weeks 13–18

- [ ] M3-01 Implement OIDC identity and session lifecycle.
- [ ] M3-02 Enforce SROS2, operation ACLs, and audit.
- [ ] M3-03 Enforce resource and command safety policy.
- [ ] M3-04 Automate compatibility endpoints and the support matrix.
- [ ] M3-05 Package deployment and observability.
- [ ] M3-06 Run fuzzing, soak, fault, and performance qualification.
- [ ] M3-07 Publish the SDK, examples, migration guides, and operations docs.
- [ ] M3-08 Complete the mainline release gate.

### M3 gate

- [ ] Security, compatibility, soak, fault, and performance qualification pass.
- [ ] Install, upgrade, rollback, and recovery pass on the reference edge.
- [ ] SDK packages, examples, runbooks, release notes, SBOMs, provenance, and signatures publish.
- [ ] Human review approves the mainline release.
- [ ] U0 and X0 entry gates open.

## U0 — Common Studio prototype, Weeks 19–24

Each U0 item follows M3-08.

- [ ] U0-01 Freeze the prototype contract and frontend ADRs.
- [ ] U0-02 Build the shell, five-region layout, and subscription broker.
- [ ] U0-03 Build Graph Explorer and Context Inspector.
- [ ] U0-04 Build Plot, Raw, Diagnostics, and Log panels.
- [ ] U0-05 Build 3D, TF, map, and PointCloud2 rendering.
- [ ] U0-06 Build the camera and WebCodecs path.
- [ ] U0-07 Complete workspace, timeline, commands, sharing, and accessibility.
- [ ] U0-08 Qualify and publish the common prototype.

### U0 gate

- [ ] Planned panel families and workflows pass end to end.
- [ ] Workspace, PointCloud2, camera, main-thread, and memory targets pass.
- [ ] Browser rendering and media tiers publish.
- [ ] Accessibility and command-safety reviews pass.
- [ ] Human review accepts the common prototype.

## X0 — Post-release N3 experiment

- [ ] X0-01 Measure an upstream ROS package Wasm sandbox.

### X0 review

- [ ] Reproducible builds and custom-message demonstration pass.
- [ ] API, size, startup, memory, runtime, patch, and maintenance evidence publish.
- [ ] Human review records continuation scope.

## Kickoff decisions

- [ ] Confirm M0/M1 hardware, ROS image, RMW, browser, CPU, network, and artifact storage.
- [ ] Assign five workstream owners and product, architecture, security, and operations reviewers.
- [ ] Pin the Bun version and approve the workspace/lockfile convention.
- [ ] Confirm OIDC and SROS2 reference environments.
- [ ] Confirm raw benchmark retention and publication policy.
- [ ] Assign the repository license and third-party licensing policy decision.

## U0 entry decisions

- [ ] Review React, Vite, state ownership, and docking choices.
- [ ] Pin prototype browser, GPU, WebGPU/WebGL2, codec, and accessibility profiles.
