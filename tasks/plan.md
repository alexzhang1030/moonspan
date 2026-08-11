# Moonspan implementation plan

## 1. Outcome and sequencing

Moonspan's mainline delivers R2WP, the MoonBit/Wasm runtime, the Rust gateway, the TypeScript SDK, ROS conformance, security, deployment, and a release package. The common Studio prototype starts after the M3 release gate and consumes the released SDK.

Planning windows guide sequencing. Gate evidence controls progression.

## 2. Current baseline

- M0 is active.
- M0-03 is complete. Its [completion note](../docs/milestones/m0-03-r2wp-foundation.md) records the delivered scope.
- M0-01 and M0-02 are active. Hosted CI evidence and human decisions remain open.
- M0-04 delivers the authoritative ROS CDR corpus across six Phase 1 rows.
- M0-05 is active. M0-05a lands the qualification report v1 contract; M0-05b/c cover collector and hosted integration.
- Phase 1 covers Humble and Jazzy rows H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN (Fast DDS, Cyclone DDS, and Zenoh as first-class RMW rows).
- Studio begins at U0 after M3. Jazzy+ belongs to a later support expansion.

## 3. Authoritative documentation

| Area | Document |
|---|---|
| Product and sequence | [Product scope](../docs/product-scope.md) |
| Architecture | [Architecture](../docs/architecture.md) |
| Decisions | [ADR register](../docs/adr/README.md) |
| Protocol | [R2WP](../docs/protocol/r2wp.md) |
| Runtime and gateway | [`rclmbt`](../docs/runtime/rclmbt.md), [`rclwebd`](../docs/gateway/rclwebd.md) |
| Security and compatibility | [Security](../docs/security.md), [compatibility](../docs/compatibility.md) |
| Supported profiles | [Support matrix](../docs/support-matrix.md) |
| Evidence | [Validation](../docs/validation.md) |
| Studio | [Common Studio prototype](../docs/prototypes/studio-ui.md) |

## 4. Working decisions

ADRs 0001 through 0009 define the current architecture baseline.

1. Keep protocol, runtime, gateway, SDK, fixtures, deployment, and documentation in one repository.
2. Version shared framing, schema identity, queue, error, and telemetry contracts.
3. Place deterministic ROS state and CDR work in MoonBit/Wasm.
4. Place browser APIs and scheduling in TypeScript Workers.
5. Place transport, policy, audit, and ROS attachment in the Rust gateway.
6. Bind each gateway process to one adapter support row and allow multiple domain IDs within that row.
7. Carry one R2WP semantic contract over WebTransport and binary WebSocket.
8. Give queues explicit sample and byte budgets with stable disposition reasons.
9. Use Bun for JavaScript workspaces, dependencies, scripts, tests, and builds.
10. Start Studio after the mainline release.
11. Treat the N3 Wasm sandbox as a bounded post-release experiment.

## 5. Phase plan

| Phase | Window | Result |
|---|---:|---|
| M0 Foundation | Weeks 1-2 | Contracts, profiles, fixtures, toolchains, and evidence schema |
| M1 Core data path | Weeks 3-6 | Graph and publish/subscribe through the full stack |
| M2 ROS semantics | Weeks 7-12 | N2 semantics, dynamic types, recording, and multi-domain support |
| M3 Production release | Weeks 13-18 | Security, compatibility, operations, SDK, and release evidence |
| U0 Studio prototype | Weeks 19-24 | Common UI built on the released SDK |
| X0 N3 experiment | Post-release | Measured upstream package sandbox |

## 6. Dependency order

```text
M0 contracts and evidence
  -> M1 core data path
  -> M2 ROS semantics
  -> M3 production release
       -> U0 Studio prototype
       -> X0 N3 experiment
```

Shared contracts land before their consumers. Contract changes carry fixtures and compatibility evidence.

## 7. Gate policy

Each phase closes when its automated evidence passes and the designated human review approves progression. A gate report links the environment, raw artifacts, derived results, decisions, and follow-up work.

## 8. Tasks

### M0: Foundation

| ID | State | Deliverable | Depends on |
|---|---|---|---|
| M0-01 | Active | Close architecture, support-profile, ownership, and licensing decisions | None |
| M0-02 | Active | Complete root tooling, workspaces, and reviewed hosted CI evidence | M0-01 |
| M0-03 | Complete | Freeze R2WP v0 and prove TypeScript, Rust, and MoonBit agreement | M0-01, M0-02 |
| M0-04 | Complete | Generate the authoritative ROS CDR corpus | M0-01, M0-02 |
| M0-05 | Active | Establish the evidence schema and report harness | M0-02 |
| M0-05a | Complete | Qualification report v1 schema, checker, and fixtures | M0-02 |
| M0-05b | Queued | Evidence collector that writes valid reports from raw runs | M0-05a |
| M0-05c | Queued | Hosted CI integration and final M0-05 review | M0-05a, M0-02 |

M0 exit requires accepted decisions, clean-checkout root commands, reproducible R2WP and CDR fixtures, valid evidence artifacts, and human approval for M1.

#### M0-05a — Qualification report v1 contract

**Description:** Publish the closed machine-readable qualification report contract, a dependency-free Bun checker, and committed valid fixtures.

**Acceptance criteria:**

- [x] JSON Schema 2020-12 at `evidence/schema/qualification-report-v1.json`.
- [x] Dependency-free `scripts/evidence-check.ts` enforces closed keys, enums, bounds, sorted collections, path confinement, symlink rejection, and artifact integrity.
- [x] Valid corpus under `evidence/testdata/valid/` with referenced artifacts.
- [x] Focused tests, `bun run evidence:check`, `just evidence-check`, and root `bun run check` include the checker exactly once.
- [x] Docs/PCR/tasks route to `evidence/README.md`. Top-level M0-05 remains active for collector and hosted integration.

**Verification:** focused `bun run test:evidence`; `bun run evidence:check`; `bun run check`; `just check`; `just test`; `just build`; `git diff --check` clean.

- **Dependencies:** M0-02
- **Likely files:** `evidence/**`, `scripts/evidence-check.ts`, `scripts/evidence-check.test.ts`, `package.json`, `justfile`, `docs/README.md`, `docs/validation.md`, `.agents/docs/README.md`, `tasks/plan.md`, `tasks/todo.md`
- **Scope:** M

### M1: Core data path

| ID | Deliverable | Depends on |
|---|---|---|
| M1-01 | Implement the MoonBit CDR core and bounded views | M0-02, M0-04 |
| M1-02 | Generate types and build the schema-identity registry | M0-04, M1-01 |
| M1-03 | Establish the Wasm host ABI and executor poll loop | M0-02, M0-03 |
| M1-04 | Implement the serialized ROS C ABI | M0-02, M0-04 |
| M1-05 | Build the gateway graph, schema, telemetry, and scheduler core | M0-03, M1-04 |
| M1-06 | Implement WebTransport, WebSocket, and the browser I/O Worker | M0-03, M1-03, M1-05 |
| M1-07 | Deliver graph and publish/subscribe through the browser SDK | M1-01 through M1-06 |
| M1-08 | Qualify the headless PointCloud2 path and issue the gate report | M0-05, M1-07 |

M1 exit requires CDR agreement, bidirectional graph and publish/subscribe, both transports, both browser buffer paths, bounded resource behavior, and human approval for M2.

### M2: ROS semantics

| ID | Deliverable | Depends on |
|---|---|---|
| M2-01 | Complete dynamic type descriptions and lazy projection | M1-02, M1-07 |
| M2-02 | Complete QoS and durability conformance | M1-07 |
| M2-03 | Deliver Service semantics | M2-01, M2-02 |
| M2-04 | Deliver Action semantics | M2-01 through M2-03 |
| M2-05 | Deliver Parameter semantics | M2-01, M2-03 |
| M2-06 | Complete Clock and simulation-time behavior | M1-07 |
| M2-07 | Add MCAP recording and replay adapters | M2-01, M2-06 |
| M2-08 | Validate multi-domain DDS sessions for each Phase 1 row | M2-02, M2-06 |
| M2-09 | Stabilize the public browser SDK | M2-01 through M2-08 |
| M2-10 | Issue the N2 semantic gate report | M2-02 through M2-09 |

M2 exit requires the planned N2 conformance surface, generated and dynamic type agreement, a shared live and replay event model, multi-domain isolation, and human approval for M3.

### M3: Production release

| ID | Deliverable | Depends on |
|---|---|---|
| M3-01 | Implement OIDC identity and session lifecycle | M2-10 |
| M3-02 | Enforce SROS2, operation ACLs, and audit | M3-01 |
| M3-03 | Enforce resource and command safety policy | M3-01, M2-03 through M2-05 |
| M3-04 | Automate compatibility endpoints and qualification | M2-10 |
| M3-05 | Package deployment and observability | M3-01 through M3-03 |
| M3-06 | Run fuzzing, soak, fault, and performance qualification | M3-02 through M3-05 |
| M3-07 | Publish the SDK, examples, migration guides, and operations docs | M2-09, M3-04, M3-05 |
| M3-08 | Complete the mainline release gate | M3-02 through M3-07 |

M3 exit requires security, compatibility, soak, fault, performance, deployment, recovery, package, supply-chain, and human release approval.

### U0: Common Studio prototype

Every U0 task follows M3-08.

| ID | Deliverable |
|---|---|
| U0-01 | Freeze the prototype contract and frontend decisions |
| U0-02 | Build the shell, layout, workspace state, and subscription broker |
| U0-03 | Build Graph Explorer and Context Inspector |
| U0-04 | Build Plot, Raw, Diagnostics, and Log panels |
| U0-05 | Build 3D, TF, map, and PointCloud2 rendering |
| U0-06 | Build the camera and WebCodecs path |
| U0-07 | Complete workspace, timeline, commands, sharing, and accessibility |
| U0-08 | Qualify and publish the common prototype |

U0 exit requires accepted workflows, performance, browser tiers, accessibility, command safety, and human prototype approval.

### X0: Post-release N3 experiment

X0-01 measures an upstream ROS package Wasm sandbox after M3-08. Its report covers reproducibility, supported APIs, package constraints, artifact size, startup, memory, runtime behavior, and maintenance cost.

## 9. Definition of done

Every task provides:

- acceptance evidence or a named manual procedure;
- focused tests and relevant integration checks;
- versioned examples for public contracts;
- explicit budgets for queues, buffers, timeouts, retries, and caches;
- authorization and audit behavior for sensitive operations;
- raw evidence for performance claims;
- updated documentation and PCR context;
- a passing root command surface.

## 10. Ownership model

Work is grouped into ROS and middleware, MoonBit and Wasm, Rust and transport, browser SDK and performance, and platform and release. Shared contracts have one owner. Each vertical slice has an integration owner responsible for its evidence report. D-02 records the named assignments.

## 11. Immediate execution order

1. Resolve D-01, D-02, and D-06 through M0-01.
2. Capture reviewed hosted CI artifacts for M0-02.
3. Build the ROS CDR corpus in M0-04.
4. Build the evidence harness in M0-05.
5. Review the M0 gate and open M1.

## 12. Risks and responses

| Risk | Early evidence | Response |
|---|---|---|
| Wasm host maturity | M1 host timing and ownership tests | Keep a synchronous runtime core with a bounded Worker ABI |
| CDR and custom type coverage | M0 corpus and M1 differential tests | Use generated codecs and schema-keyed dynamic projection |
| QoS drift across RMWs | Cross-row conformance | Use explicit state, stable telemetry, and per-row suites |
| WebTransport coverage | Proxy and reconnect tests | Keep binary WebSocket under the same R2WP contract |
| Large-message pressure | Queue and memory traces | Apply byte budgets, bounded pools, and explicit admission policy |
| Compatibility cost | Matrix duration and artifact size | Use tiered profiles and reusable environments |
| UI coupling | SDK review and release evidence | Start integrated Studio work after M3-08 |

## 13. Kickoff decision register

| ID | Decision | Accountable role | Closure artifact | Deadline | State |
|---|---|---|---|---|---|
| D-01 | Reference robot, artifact storage, and qualification environment | Platform and release owner | Reviewed environment manifest and storage record | M0-01 exit | Partial |
| D-02 | Named workstream, integration, and review owners | Project lead | Ownership record | M0-02 entry | Open |
| D-03 | Bun version and workspace convention | Browser SDK and performance owner | Project pins, workspace manifests, lockfile, and root checks | M0-02 scaffold | Resolved 2026-08-11 with Bun 1.3.14 |
| D-04 | OIDC provider and SROS2 reference environment | Security owner | Identity tenant and SROS2 environment record | M3-01 entry | Open |
| D-05 | Benchmark artifact retention and publication | Platform and release owner | Storage, retention, access, and integrity policy | M0-05 schema freeze | Open |
| D-06 | Repository license and third-party licensing policy | Repository owner | License, notice, dependency inventory, and compliance policy | M0-01 exit | Human ruling pending |

M0-01 requires D-01 and D-06 resolution. Open rows retain an accountable role, closure artifact, deadline, and current state. Resolution adds the decision date and durable artifact link.
