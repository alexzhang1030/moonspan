# Moonspan implementation plan

## 1. Outcome and sequencing

Moonspan's mainline delivers R2WP, the MoonBit/Wasm runtime, the Rust gateway, the TypeScript SDK, ROS conformance, security, deployment, and a release package. The common Studio prototype starts after the M3 release gate and consumes the released SDK.

Planning windows guide sequencing. Gate evidence controls progression.

## 2. Current baseline

- M1 execution is authorized (human decision 2026-08-12). The M0 gate item "Human review approves M1" is complete.
- M0 carryover remains active: M0-01 decisions, M0-02 hosted CI review, and M0-05 collector plus hosted integration (M0-05b, M0-05c). M1-08 still depends on M0-05.
- M0-03 is complete. Its [completion note](../docs/milestones/m0-03-r2wp-foundation.md) records the delivered scope.
- M0-04 delivers the authoritative ROS CDR corpus across six Phase 1 rows.
- M0-05a is complete (qualification report v1 contract). M0-05 stays active for M0-05b/c.
- M1-01 is active. M1-01a freezes the [CDR core contract](../docs/runtime/cdr.md); M1-01b/c/d implement and prove `cdr_mbt`.
- Phase 1 covers Humble and Jazzy rows H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN (Fast DDS, Cyclone DDS, and Zenoh as first-class RMW rows).
- Studio begins at U0 after M3. Jazzy+ belongs to a later support expansion.

## 3. Authoritative documentation

| Area | Document |
|---|---|
| Product and sequence | [Product scope](../docs/product-scope.md) |
| Architecture | [Architecture](../docs/architecture.md) |
| Decisions | [ADR register](../docs/adr/README.md) |
| Protocol | [R2WP](../docs/protocol/r2wp.md) |
| Runtime and gateway | [`rclmbt`](../docs/runtime/rclmbt.md), [CDR core](../docs/runtime/cdr.md), [`rclwebd`](../docs/gateway/rclwebd.md) |
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

M0 exit requires accepted decisions, clean-checkout root commands, reproducible R2WP and CDR fixtures, and valid evidence artifacts. Human approval for M1 landed on 2026-08-12; remaining M0 items continue as carryover while M1 runs.

#### M0-05a — Qualification report v1 contract

**Description:** Publish the closed machine-readable qualification report contract, a dependency-free Bun checker, and committed valid fixtures.

**Acceptance criteria:**

- [x] JSON Schema 2020-12 at `evidence/schema/qualification-report-v1.json` generated from `scripts/evidence-schema.ts` (shared model in `evidence-model.ts`, runtime validation in `evidence-contract.ts`) with `--write`/`--check` byte identity.
- [x] Dependency-free model + contract + schema + FS modules enforce closed keys, enums, bounds, gate/level mapping, pending/human review lifecycle, sorted collections, path confinement, ancestor symlink rejection, closed valid corpus, and artifact integrity.
- [x] Valid corpus under `evidence/testdata/valid/` with referenced payloads under `evidence/testdata/payloads/`.
- [x] Focused tests, `bun run evidence:write`/`evidence:check`, `just evidence-check`, and root `bun run check` include the checker exactly once.
- [x] Docs/PCR/tasks route to `evidence/README.md`. Top-level M0-05 remains active for collector and hosted integration.

**Verification:** focused `bun run test:evidence`; `bun run evidence:write` then `evidence:check` identity; `bun run check`; `just check`; `just test`; `just build`; `git diff --check` clean.

- **Dependencies:** M0-02
- **Likely files:** `evidence/**`, `scripts/evidence-model.ts`, `scripts/evidence-contract.ts`, `scripts/evidence-schema.ts`, `scripts/evidence-check.ts`, `scripts/evidence-check.test.ts`, `package.json`, `justfile`, `docs/README.md`, `docs/validation.md`, `.agents/docs/README.md`, `tasks/plan.md`, `tasks/todo.md`
- **Scope:** M

### M1: Core data path

| ID | State | Deliverable | Depends on |
|---|---|---|---|
| M1-01 | Active | Implement the MoonBit CDR core and bounded views | M0-02, M0-04 |
| M1-01a | Complete | Freeze the CDR core contract and conformance plan | M0-04 |
| M1-01b | Complete | Bounded stream reader/writer, encapsulation, endian, alignment, limits, typed errors | M1-01a |
| M1-01b1 | Complete | Bounded CDR1 reader (header, options, origin-4 alignment, raw reads, limits, strict completion) | M1-01a |
| M1-01b2 | Complete | Bounded CDR1 writer (deterministic zero padding, options `0x0000`, matching limits) | M1-01b1 |
| M1-01c | Active | Primitives, strings/wstrings, arrays, sequences, nested values, borrowed BytesView fields | M1-01b |
| M1-01c1 | Complete | Semantic CDR1 primitive codecs (bool, signed ints, floats, Char8/Char16) | M1-01b |
| M1-01c2 | Complete | Strings and ROS legacy wstring | M1-01c1 |
| M1-01c2a | Complete | CDR1 UTF-8 Char8 string (`read_string` / `write_string`, optional payload `max_bytes`) | M1-01c1 |
| M1-01c2b | Complete | ROS legacy wstring and corpus-tail completion | M1-01c2a |
| M1-01c3 | Queued | Arrays, sequences, nested-depth guards, borrowed BytesView fields | M1-01c2 |
| M1-01d | Queued | Authoritative corpus proof: semantic agreement, round trips, malformed input, resource bounds | M1-01c, M0-04 |
| M1-02 | Queued | Generate types and build the schema-identity registry | M0-04, M1-01 |
| M1-03 | Queued | Establish the Wasm host ABI and executor poll loop | M0-02, M0-03 |
| M1-04 | Queued | Implement the serialized ROS C ABI | M0-02, M0-04 |
| M1-05 | Queued | Build the gateway graph, schema, telemetry, and scheduler core | M0-03, M1-04 |
| M1-06 | Queued | Implement WebTransport, WebSocket, and the browser I/O Worker | M0-03, M1-03, M1-05 |
| M1-07 | Queued | Deliver graph and publish/subscribe through the browser SDK | M1-01 through M1-06 |
| M1-08 | Queued | Qualify the headless PointCloud2 path and issue the gate report | M0-05, M1-07 |

M1 exit requires CDR agreement, bidirectional graph and publish/subscribe, both transports, both browser buffer paths, bounded resource behavior, and human approval for M2. M0-05b and M0-05c continue in parallel; M1-08 keeps its dependency on M0-05.

#### M1-01 — MoonBit CDR core

**Description:** Implement `cdr_mbt` against the frozen [CDR core contract](../docs/runtime/cdr.md) and the committed ROS corpus (`moonspan-ros-cdr-v1`, manifest `schema_version` 1, runtime `schema_generation` 1, 56 fixtures, six Phase 1 rows, 18 semantic comparisons).

**Sub-batches:**

| ID | State | Scope |
|---|---|---|
| M1-01a | Complete | Documentation and plan freeze: CDR1 little and big endian target; body origin absolute offset 4; ROS 2 legacy wstring profile (count + count×4; four-byte zero tail slack policy); XCDR2 stream foundations as follow-on; semantic cross-row agreement; 4-byte encapsulation framing; deterministic zero-fill encoder padding; official sources |
| M1-01b | Complete | Bounded stream reader/writer split into b1 reader and b2 writer |
| M1-01b1 | Complete | Bounded CDR1 reader in `rclmbt/cdr`: encapsulation, network-order options `UInt16`, origin-4 alignment, width-exact raw reads, borrowed `BytesView`, frozen limits, strict completion |
| M1-01b2 | Complete | Bounded CDR1 writer: canonical header, capacity min(stream,temp), deterministic zero padding, options `0x0000`, owned `to_bytes` snapshots |
| M1-01c | Active | Primitives, strings/wstrings, arrays, sequences, nested values, borrowed `BytesView` fields |
| M1-01c1 | Complete | Semantic primitives: bool, signed ints, IEEE floats, Char8/Char16 on raw codecs |
| M1-01c2 | Complete | Strings and ROS legacy wstring |
| M1-01c2a | Complete | CDR1 UTF-8 Char8 string: endian-aware length including NUL, optional payload `max_bytes`, strict UTF-8, owned `String`, direct writer emit |
| M1-01c2b | Complete | ROS legacy wstring (`count * 4`, `invalid_wstring_scalar`) and `ensure_corpus_complete_terminal_wstring` |
| M1-01c3 | Queued | Arrays, sequences, nested-depth guards, borrowed `BytesView` fields |
| M1-01d | Queued | Corpus-driven proof: CY exact vs FT/ZN four-byte zero tail slack wstring semantic agreement, round trips, malformed input, resource bounds |

**Acceptance criteria (M1-01 overall):**

- [x] Authoritative contract at `docs/runtime/cdr.md` routed from docs and PCR maps (M1-01a), including body origin at absolute offset 4, ROS 2 legacy wstring profile, exact canonical encode (zero top-level tail slack), and narrow corpus completion for four-byte zero tail slack.
- [x] Bounded CDR1 reader with encapsulation, options metadata, width-exact endian raw reads, origin-4 alignment, limits (stream/temp 67 108 864, depth 64), and structured `CdrError` (M1-01b1).
- [x] Bounded CDR1 writer with capacity min(stream,temp), deterministic zero padding, options `0x0000`, and owned snapshots (M1-01b2).
- [x] Semantic primitive codecs (bool, signed ints, floats, Char8/Char16) with LE/BE fidelity and atomic boolean faults (M1-01c1).
- [x] CDR1 UTF-8 Char8 string codecs with optional payload bound, strict UTF-8, and atomic faults (M1-01c2a).
- [x] ROS `wstring` core decode of exactly `count * 4`; scalar-boundary tests for `invalid_wstring_scalar`; corpus-tail completion (M1-01c2b).
- [ ] Arrays, sequences, nested-depth guards, borrowed `BytesView` fields (M1-01c3).
- [ ] Corpus agreement: exact CY fixtures and FT/ZN four-byte zero tail slack fixtures normalize to one semantic value; strict completion reports `trailing_data` on four-byte zero tail slack samples; adversarial resource cases (M1-01d).

**Verification:** focused MoonBit/Wasm tests for `cdr_mbt`; corpus-driven checks against `conformance/cdr/manifest.json`; root `just check`, `just test`, and `just build` when implementation lands.

- **Dependencies:** M0-02, M0-04 (M1-01a complete on documentation alone)
- **Likely files:** `docs/runtime/cdr.md`, `docs/runtime/rclmbt.md`, `docs/README.md`, `.agents/docs/**`, `tasks/plan.md`, `tasks/todo.md`, later `rclmbt/**` for b–d
- **Scope:** L

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

1. Complete M1-01b through M1-01d against the frozen CDR contract (M1-01a complete).
2. Continue M0 carryover in parallel: M0-01 decisions, M0-02 hosted CI review, M0-05b collector, M0-05c hosted integration.
3. Advance M1-02 and M1-03 once M1-01 behavior is stable enough for consumers.
4. Keep M1-08 gated on M0-05 so the PointCloud2 report uses the finished evidence harness.

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
