# Moonspan execution checklist

Status values: `[ ]` queued, `[~]` active, `[x]` verified.

## M0 — Foundation, Weeks 1–2

- [~] M0-01 Complete architecture ADRs and the reference support profile.
- [~] M0-02 Bootstrap the monorepo, polyglot workspaces, root commands, and CI (local workspace/commands/pins proven; foundation workflow implemented + local actionlint complete; hosted run pending).
- [x] M0-03 Freeze R2WP v0 and cross-language golden frames (sub-batches below; top-level verified after M0-03h Codex h4 review Accept).
  - [x] M0-03a Normative contract, ADR 0009, registry, and control CDDL (verified; ADR 0009 Accepted).
  - [x] M0-03b Contract validator and root command (verified; `scripts/protocol-check.ts` + root wiring).
  - [x] M0-03c TypeScript deterministic CBOR subset (`sdk/typescript/src/protocol`; verified).
  - [x] M0-03d TypeScript bootstrap/frame codec and valid/boundary fixtures (verified; codecs `bootstrap`/`extension`/`control`/`frame`; 20 fixtures via `scripts/protocol-fixtures.ts` + `protocol/testdata/`; commits `5c21f74`…`fc18b3d`; fixture tests 25/25, full `bun test` 332/332).
  - [x] M0-03e Malformed, state-sequence, and transport parity fixtures (verified; e1–e4 review Accept).
    - [x] M0-03e1 Static malformed wire corpus (55 fixtures; `protocol/testdata/malformed/`, `scripts/protocol-malformed-fixtures.ts`; commit `3600ff4`).
    - [x] M0-03e2 State-sequence corpus (13 scenarios / 26 events; `protocol/testdata/sequences/`, `scripts/protocol-sequence-fixtures.ts`; commit `63f21df`).
    - [x] M0-03e3 Transport parity and aggregate checking (46 shared identities + 20 registry-bound rules; aggregate order `valid_boundary → malformed → sequences → parity` once each; commit `154afb1`; parity SHA-256 `d75d07e46f878be00bb05fd395ccec768ad52950f749cad8b9fcd28a208f80c9` after two aggregate writes).
    - [x] M0-03e4 Documentation/status closeout after e1–e3 evidence (commit subject `docs(plan): record r2wp scenario fixture completion`).
  - [x] M0-03f Rust reference parser in `rclwebd` (verified; review Accept; commits `9c07b4a` bootstrap, `cca270c` frame).
  - [x] M0-03g MoonBit reference parser in `rclmbt/protocol` (verified; review Accept; commits `2f7352f` fixture bridge, `1157138` bootstrap+CBOR, `0c5e4d2` extension+CONTROL, `133fd9f` frame; `moon test --frozen --target wasm rclmbt/protocol` 69 of 69).
  - [x] M0-03h Cross-language agreement and M0-03 gate (verified; Codex h4 review Accept + h5 docs closeout).
    - [x] M0-03h1 TypeScript expected corpus (`72ccd28b53820af9c3dd015b9be77a35aa6371b6`).
    - [x] M0-03h2 Rust agreement emitter (`33c947414110fee47fa96429a70e795a645cc5cb`).
    - [x] M0-03h3 MoonBit agreement emitter (`9fa91a4f9f956670368b0d36783991312f0e6900`).
    - [x] M0-03h4 Triple-language gate and `report.json` (`da5f28c3e6b9db8b939c2bceee5ba415442358d5`; 234265 bytes; SHA-256 `e1295ab1ee56c83a3c3e8e5ada6699fdc7b693b86bd9dc399f07a00ccc8753d4`; 101/46/55; focused agreement 22/22 with 94 assertions and exactly two real emitter subprocesses; full `bun test` 675/675 with 5228 assertions; `cargo test --locked -p rclwebd` 56 across 3 suites; MoonBit 69/69; pinned `just check` green).
    - [x] M0-03h5 Documentation/status closeout (commit subject `docs(plan): record r2wp agreement completion`).
- [ ] M0-04 Generate the authoritative ROS CDR corpus.
- [ ] M0-05 Establish the evidence harness and report schema.

### M0 gate

- [ ] ADR and support-profile review passes.
- [ ] Root commands pass from a clean checkout with pinned Bun, Rust, MoonBit, and just (local proven; foundation CI hosted run pending).
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
- [ ] M2-08 Validate multi-domain DDS sessions.
- [ ] M2-09 Stabilize the public browser SDK contract.
- [ ] M2-10 Issue the N2 semantic gate report.

### M2 gate

- [ ] The planned N2 conformance surface passes.
- [ ] Dynamic and generated types agree across the declared corpus.
- [ ] Recording and live transport share one SDK event model.
- [ ] Multi-domain DDS isolation across declared first-stage rows passes.
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

Register: [Kickoff decision register](./plan.md#13-kickoff-decision-register).

- [ ] D-01 Reference qualification environment (robot, artifact storage, pinned profile confirmation).
- [ ] D-02 Named workstream and review owners (past M0-02 entry deadline; human names still required).
- [x] D-03 Exact Bun version and root workspace/lockfile convention (includes committed `bun.lock` with `@moonspan/sdk`).
- [ ] D-04 OIDC provider and SROS2 reference environment.
- [ ] D-05 Raw benchmark artifact retention and publication.
- [ ] D-06 Repository license and third-party licensing policy.

## U0 entry decisions

- [ ] Review React, Vite, state ownership, and docking choices.
- [ ] Pin prototype browser, GPU, WebGPU/WebGL2, codec, and accessibility profiles.
