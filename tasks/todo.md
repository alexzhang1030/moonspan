# rclweb execution checklist

Status values: `[ ]` queued, `[~]` active, `[x]` verified. Phase details live in the [plan](./plan.md).

## R0: Stop-loss and renames

- [x] R0-01 One implementation per side; baseline tagged.
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
- [x] R2-03 Fixtures regenerated for the v0.1 subset; fuzzing.
- [x] R2-04 Performance baseline versus Foxglove bridge and rosbridge.

## R3: Semantics and breadth

- [x] R3-01 Services, actions, parameters, graph; re-freeze parked sections.
- [x] R3-02 Generated types and dual-scheme schema registry.
- [x] R3-03 Second row (H-FT); WebTransport.
- [x] R3-04 Versioned adapter ABI; dynamic typesupport.

## R4: Productionization

- [~] R4-01 OIDC, SROS2/ACL, audit (Authenticate off-by-default / opt-in `oidc` + audit; ACL/SROS2 enclave still open).
- [~] R4-02 Deployment and observability (ops endpoints + J-FT / H-FT runtime images; PKI/remaining-row images/orchestrators still open).
- [~] R4-03 Support matrix against live gates (no committed measurement JSON; remaining-row live e2e and human Qualified promotion still open).
- [~] R4-04 SDK stabilization and release (rclcpp-shaped `init`/`Node`, SDK docs, Worker URL, subscribe-chatter on `dist/`, Worker session ops, PointCloud2 and Phase 1 corpus msg types; npm publish still open).

## Kickoff decisions

The [decision register](./plan.md#kickoff-decision-register) owns details and closure artifacts.

- [ ] D-01 Reference qualification environment.
- [ ] D-02 Named workstream and review owners.
- [x] D-03 Bun version and workspace convention.
- [ ] D-04 OIDC provider and SROS2 environment.
- [ ] D-05 Benchmark artifact retention and publication.
- [ ] D-06 Repository and third-party licensing policy.
