# rclweb execution checklist

Status values: `[ ]` queued, `[~]` active, `[x]` verified. Phase details live in the [plan](./plan.md); pre-restructure M-phase history lives at tag `pre-restructure`.

## R0: Stop-loss and renames

- [x] R0-01 Tag `pre-restructure`; delete the agreement apparatus, fixture generators, MoonBit stack, TS protocol implementation, and evidence harness.
- [x] R0-02 Extract the `rclweb` core crate; thin `rclwebd`; wasm32 build in the command surface.
- [x] R0-03 Rename project to rclweb; declare the protocol v0.1 normative scope.
- [x] R0-04 Rewrite plan/checklist, add ADR 0010, refresh PCR records and docs tree.

### R0 gate

- [x] `just check`, `just test`, `just build` green on the shrunk repository.

## R1: Walking skeleton

- [x] R1-01 Port the CDR core to Rust against the frozen contract; pass the committed corpus.
- [x] R1-02 Session/channel state machine for the v0.1 subset.
- [x] R1-03 Gateway WebSocket endpoint and serialized-only rcl FFI attachment.
- [x] R1-04 Wasm host boundary, I/O Worker, SDK subscribe path.
- [x] R1-05 End-to-end CI evidence, demo, wasm size and poll latency, copy counters.

### R1 gate

- [~] Live sample flows in CI; demo ready for human review; copy budget counters recorded.

## R2: Data-plane hardening

- [x] R2-01 Publish direction, QoS subset, budgets, reconnect.
- [x] R2-02 Large-message path on both buffer strategies.
- [ ] R2-03 Fixtures regenerated for the v0.1 subset; fuzzing.
- [ ] R2-04 Performance baseline versus Foxglove bridge and rosbridge.

## R3: Semantics and breadth

- [ ] R3-01 Services, actions, parameters, graph; re-freeze parked sections.
- [ ] R3-02 Generated types and dual-scheme schema registry.
- [ ] R3-03 Second row (H-FT); WebTransport.
- [ ] R3-04 Versioned adapter ABI; dynamic typesupport.

## R4: Productionization

- [ ] R4-01 OIDC, SROS2/ACL, audit.
- [ ] R4-02 Deployment and observability.
- [ ] R4-03 Evidence harness returns; support matrix expansion.
- [ ] R4-04 SDK stabilization and release.

## Kickoff decisions

The [decision register](./plan.md#kickoff-decision-register) owns details and closure artifacts.

- [ ] D-01 Reference qualification environment.
- [ ] D-02 Named workstream and review owners.
- [x] D-03 Bun version and workspace convention.
- [ ] D-04 OIDC provider and SROS2 environment.
- [ ] D-05 Benchmark artifact retention and publication.
- [ ] D-06 Repository and third-party licensing policy.
