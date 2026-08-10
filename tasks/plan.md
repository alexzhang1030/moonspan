# Moonspan implementation plan

## 1. Outcome and sequencing

The mainline delivers a production-ready browser-native ROS 2 platform:

- R2WP, a versioned CDR-first protocol over WebTransport and binary WebSocket;
- `rclmbt`, a MoonBit-to-Wasm N2 runtime;
- `rclwebd`, a Rust edge gateway with a narrow ROS C ABI;
- a typed TypeScript browser SDK and Worker host;
- conformance, benchmark, security, compatibility, deployment, and release evidence.

The common Studio UI is a post-mainline side project. Its U0 tasks start after M3-08 approves the mainline release and consume the released SDK and policy contracts.

The planning baseline uses five core engineers, 18 weeks for the mainline, and 6 weeks for the common prototype. Gate evidence can revise estimates and scope.

## 2. Current baseline

- The repository contains formal technical specifications, PCR records, polyglot workspace scaffolding, and this execution plan.
- M0-02 has local root commands, pinned Bun/Rust/MoonBit/just identities, and a foundation CI workflow; hosted CI run evidence remains open.
- M0-03a freezes the R2WP wire version 0 normative package (markdown, registry JSON, control CDDL, ADR 0009 Accepted); validator, codecs, fixtures, and language parsers follow in M0-03b–h.
- Active mainline workspaces: `rclwebd/` (Cargo), `rclmbt/` (`moon.work`), `sdk/typescript/` (`@moonspan/sdk`). Studio workspace enrollment begins at U0.
- R2WP, MoonBit/Wasm, Rust/C ABI, ROS support, and performance values are design baselines awaiting their named gates.
- The mainline and UI side-project boundary is fixed in [product scope](../docs/product-scope.md).

## 3. Authoritative documentation

| Work area | Specification |
|---|---|
| Product direction and sequence | [Product scope](../docs/product-scope.md) |
| Accepted decisions | [ADR register](../docs/adr/README.md) |
| System boundaries | [Architecture](../docs/architecture.md) |
| Protocol | [R2WP](../docs/protocol/r2wp.md) |
| Browser runtime | [`rclmbt`](../docs/runtime/rclmbt.md) |
| Edge gateway | [`rclwebd`](../docs/gateway/rclwebd.md) |
| Security and policy | [Security](../docs/security.md) |
| Platform tiers | [Compatibility](../docs/compatibility.md) |
| Exact first-stage pins and row status | [Support matrix](../docs/support-matrix.md) |
| Evidence and targets | [Validation](../docs/validation.md) |
| Existing solution roles | [Landscape](../docs/landscape.md) |
| Common UI side project | [Common Studio prototype](../docs/prototypes/studio-ui.md) |
| Visual system | [DESIGN.md](../.agents/docs/DESIGN.md) |

## 4. Working decisions

ADRs 0001–0009 accept the mainline/prototype sequence, Bun, monorepo ownership, browser/Wasm boundary, R2WP wire versioning, edge/ROS C ABI, Humble/Jazzy schema identity, one adapter support row per gateway process, and R2WP wire version 0 encoding/registries. The [support matrix](../docs/support-matrix.md) pins first-stage rows as **Qualification targets**. M0-01 still owns licensing and remaining open support-profile acceptance. U0-01 records prototype frontend decisions.

1. Use one monorepo for Rust, MoonBit, TypeScript, protocol fixtures, conformance, deployment, and documentation.
2. Treat R2WP framing, schemas with identity `(scheme, value)`, queue limits, errors, and telemetry as shared versioned contracts.
3. Keep deterministic runtime state and CDR work in MoonBit/Wasm; keep browser async APIs in the TypeScript Worker host.
4. Use Rust for gateway concurrency and policy; isolate ROS distro variation behind a narrow serialized C ABI.
5. Bind each gateway process to one adapter support row with multiple domain IDs under that row ([ADR 0008](../docs/adr/0008-one-adapter-row-per-gateway-process.md)).
6. Deliver N1 and N2 as the mainline native surface on first-stage Humble/Jazzy Fast DDS and Cyclone DDS rows.
7. Support WebTransport and binary WSS through one R2WP semantic envelope.
8. Give every queue explicit sample and byte budgets and emit stable disposition reasons.
9. Use Bun for JavaScript workspaces, dependencies, lockfile, scripts, tests, builds, and one-shot tools.
10. Schedule the common Studio prototype after the M3 release gate.
11. Schedule the N3 package sandbox as a bounded post-release experiment.
12. Keep Kilted, Lyrical, Rolling, `rmw_zenoh`, and Zenoh router topologies as post-first-stage expansion candidates in the [support matrix](../docs/support-matrix.md).

## 5. Planned repository layout

```text
docs/                       Formal product and technical documentation
docs/adr/                   Accepted architecture decisions
protocol/                   R2WP schema, registries, and golden frames
rclmbt/                     MoonBit CDR, runtime, types, and host ABI
rclwebd/                    Rust gateway and ROS C ABI adapter
sdk/typescript/             Browser SDK, Worker host, generated bindings
examples/headless-client/   Mainline SDK integration example
conformance/                ROS interfaces, golden CDR, semantic harnesses
benchmarks/                 Workloads, runners, result schemas, reports
deploy/                     Containers, proxy, SROS2, observability, runbooks
studio/                     Post-release common UI prototype
tasks/                      Plan and execution checklist
```

## 6. Dependency graph

```text
M0 contracts, fixtures, toolchains, evidence schema
  |
  +--> M1 rclmbt core + rclwebd core + browser transport
  |      |
  |      +--> graph/pub-sub + PointCloud2 headless gate
  |              |
  |              v
  +----------> M2 complete N2 semantics + SDK contract
                         |
                         v
                M3 security + compatibility + operations + release
                         |
                         +--> U0 common Studio prototype
                         |
                         +--> X0 N3 package sandbox experiment
```

Shared contracts freeze before dependent implementation. Later changes include versioned fixtures and compatibility review.

## 7. Schedule and gates

| Phase | Planning window | Result | Exit gate |
|---|---:|---|---|
| M0 Foundation | Weeks 1–2 | Accepted contracts, support profile, toolchains, fixtures, and evidence schema | Contract baseline approval |
| M1 Core data path | Weeks 3–6 | N1 graph and publish/subscribe path through R2WP, `rclmbt`, `rclwebd`, and SDK | Core architecture approval |
| M2 ROS semantics | Weeks 7–12 | Complete planned N2 surface, dynamic types, recording, and multi-domain DDS isolation | Semantic capability approval |
| M3 Production release | Weeks 13–18 | Security, compatibility, operations, SDK package, and signed release | Mainline release approval |
| U0 Common prototype | Weeks 19–24 | Generic Studio UI over the released SDK | Prototype acceptance |
| X0 N3 experiment | Post-release | Measured selected-package Wasm sandbox | Experiment continuation decision |

## 8. Workstreams

| Workstream | Mainline responsibility | U0 responsibility |
|---|---|---|
| ROS / middleware | C ABI, graph, QoS, Service, Action, Parameter, SROS2 | Integration fixtures and ROS workflow review |
| MoonBit / Wasm | CDR, generated and dynamic types, runtime state, host ABI | Typed projections and runtime profiling |
| Rust / transport | R2WP, WebTransport/WSS, scheduler, sessions, policy | Transport and command integration support |
| Browser SDK / performance | TypeScript SDK, Workers, buffers, Playwright, benchmarks | Shell, broker, rendering, media, accessibility |
| Platform / release | CI, support matrix, deployment, observability, evidence, release | Prototype qualification and packaging |

Each shared contract has one designated owner. Each vertical slice has one integration owner who publishes the evidence report.

## 9. Project-wide definition of done

Every task clears these conditions:

- Acceptance criteria have automated evidence or a named manual procedure.
- Focused tests, package builds, and relevant end-to-end smoke tests pass.
- Public contracts and metrics have versioned examples.
- Queues, buffers, timeouts, retries, and caches declare explicit budgets.
- Security-sensitive operations include authorization, audit identity, and failure behavior.
- Performance-sensitive changes include a trace or benchmark derived from raw artifacts.
- Documentation and PCR records reflect changed intent, architecture, stack, validation, or known traps.
- The repository remains buildable through root commands.

## 10. Detailed tasks

### M0 — Foundation, Weeks 1–2

#### M0-01 — Complete architecture ADRs and the reference support profile

**Description:** Complete the remaining architecture ADRs, assign licensing decisions, and pin the first qualification environment.

**Acceptance criteria:**

- [ ] Existing ADRs cover mainline sequencing, Bun, monorepo ownership, browser/Wasm boundary, R2WP versioning, edge/ROS boundary, Humble/Jazzy schema identity ([ADR 0007](../docs/adr/0007-humble-jazzy-schema-identity.md)), and one adapter support row per gateway process ([ADR 0008](../docs/adr/0008-one-adapter-row-per-gateway-process.md)).
- [ ] The [support matrix](../docs/support-matrix.md) names first-stage Humble/Jazzy Fast DDS and Cyclone DDS rows as independently qualified per-process artifact/image profiles, image digests, OS, CPU variants, browser reference, Wasm mode, buffer paths, and 1 GbE network as **Qualification targets**.
- [ ] Support-row topology documents immutable `support_row_id`, deployment-provided `gateway_instance_id` lifecycle, multi-domain IDs within a row, and independent sessions for cross-row composition.
- [ ] The [kickoff decision register](#13-kickoff-decision-register) lists D-01 through D-06 with accountable role, required evidence, decision deadline, and current state.
- [ ] D-01 and D-06 are resolved with actual decision date and durable artifact; every other open kickoff choice remains registered with owner, evidence, and deadline.
- [ ] Repository license and third-party licensing policy follow the recorded D-06 human ruling, including owner, evidence, deadline, state, and actual decision date on resolution.

**Verification:** Architecture review records decisions and support-profile approval; documentation link checks pass.

- **Dependencies:** None
- **Likely files:** `docs/adr/0003-*.md` onward, `docs/support-matrix.md`
- **Scope:** M

#### M0-02 — Bootstrap the monorepo, Bun workspaces, and CI

**Description:** Create Rust, MoonBit, and TypeScript workspaces with one documented root command surface.

**Acceptance criteria:**

- [x] `just toolchain-check`, `just check`, `just test`, and `just build` run from the repository root under the pinned toolchains (Studio workspace enrollment begins at U0).
- [x] Root `package.json` declares Bun workspaces (`sdk/*`, `examples/*`) and scripts; private `@moonspan/sdk` lives at `sdk/typescript`; install succeeds with zero external dependencies and committed text `bun.lock`; U0 adds exact `studio` workspace.
- [x] The repository pins Bun `1.3.14` (`.bun-version`, `packageManager`, `engines`), Rust `1.97.1` (`rust-toolchain.toml`, workspace `rust-version`), MoonBit `moonc` `0.10.6+80dc50f24` (`.moon-version`), and just `1.50.0` (`.just-version`); `scripts/toolchain-check.ts` enforces exact installed identities (including `moon version --all` bundle coverage) and pin-file consistency.
- [x] Cargo virtual workspace member `rclwebd`, `moon.work` member `rclmbt` (wasm), and committed `Cargo.lock` / `bun.lock` are present with empty public product APIs and package-identity smoke coverage only.
- [ ] CI caches dependencies and publishes test and documentation artifacts (**workflow implemented**; local `actionlint` complete; **hosted run pending** — acceptance stays open until a reviewed hosted run records dual evidence artifacts).
- [x] `bun run check` is the documentation static check (`docs:check`); `bun run toolchain-check` probes installed tools; `bun test` covers docs, toolchain unit tests, and SDK package-contract tests.
- [x] Foundation CI workflow (`.github/workflows/ci.yml`) pins Actions by full SHA, installs project tool pins on `ubuntu-24.04` (SHA256-verified MoonBit installer and just asset), caches dependency material only, initializes `artifacts/ci/` placeholders after checkout, runs frozen/locked root recipes with tee logs, and uploads available documentation + test-build evidence after checkout via `if: always()` (14-day retention). Foundation lane is generic M0 tooling evidence; Humble/Jazzy H-FT/H-CY/J-FT/J-CY stay with later ROS container qualification workflows; Studio enrollment begins at U0.

**Verification:** A clean checkout executes the documented bootstrap and all root commands locally. Current CI evidence is local `actionlint` plus those pinned commands. CI acceptance requires a reviewed hosted workflow run with both evidence artifacts; the first hosted run will record artifact URLs.

- **Dependencies:** M0-01
- **Likely files:** `justfile`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `moon.work`, `package.json`, `bun.lock`, `.bun-version`, `.moon-version`, `.just-version`, `bunfig.toml`, `scripts/docs-check.ts`, `scripts/toolchain-check.ts`, `rclwebd/`, `rclmbt/`, `sdk/typescript/`, `.github/workflows/ci.yml`
- **Scope:** M

#### M0-03 — Freeze R2WP v0

**Description:** Turn the R2WP design baseline into a normative v0 contract with registries, control CDDL, validators, fixtures, and multi-language agreement. Delivery is sequential sub-batches M0-03a through M0-03h. Each sub-batch is Scope M or smaller with exact paths.

##### M0-03a — Normative contract, ADR, registry, and CDDL

**Description:** Publish wire version 0 normative prose, single JSON registry, control CDDL (root-first), ADR 0009, and documentation entry points.

**Acceptance criteria:**

- [x] Normative package freezes bootstrap, framing, sequence domains/dispositions, opcode/channel/transport invariants, extensions, bounds, SessionReady/Resume, capability negotiation, QoS/ChannelReady rules, Parameter composition, media/recording/asset contracts, and transport length rules with RFC 2119 keywords.
- [x] Registry is exhaustive and machine-usable: scoped `control_field_keys` for bootstrap, every control message, and nested maps; enums, dispositions, source-entry encodings, non-ROS payload keys, bounds, single-valued `validation_order`, protocol state machine, and direction tables as source of truth.
- [x] CDDL root is `r2wp-v0-control`; all collections are bounded; dead rules eliminated; channel/payload mappings cover topics, Service client **and** server, Action client **and** server (browser OpenChannel roles with inverted directions), Parameter composition, media, recording, and assets; graph endpoint roles remain independent.
- [x] ADR 0009 Accepted after Codex review; phase-one support rows remain H-FT/H-CY/J-FT/J-CY only; Studio workspace enrollment and Jazzy+ expansion stay outside this batch (U0 / later expansion).

**Verification (Codex acceptance evidence):** `bun run check` status=ok (34 markdown, 310 links); `bun test` 53/53; `git diff --check` clean; JSON parse OK; official `cddl` gem generated 100 instances; `just check`/`test`/`build` under Bun 1.3.14, Rust 1.97.1, MoonBit moonc 0.10.6+80dc50f24, just 1.50.0.

- **Dependencies:** M0-01, M0-02
- **Likely files:** `protocol/r2wp-v0.md`, `protocol/registry/r2wp-v0.json`, `protocol/schema/control-v0.cddl`, `docs/adr/0009-r2wp-v0-wire-encoding.md`, `docs/adr/README.md`, `docs/protocol/r2wp.md`, `docs/README.md`, `docs/references.md`, `.agents/docs/technology-stack.md`, `tasks/plan.md`, `tasks/todo.md`
- **Scope:** M

##### M0-03b — Contract validator and root command

**Description:** Validate registry shape, CDDL/registry consistency, and absolute bounds from a root command.

**Acceptance criteria:**

- [ ] `scripts/protocol-check.ts` loads `protocol/registry/r2wp-v0.json` and rejects malformed shape, missing required registries, and unbound collections.
- [ ] Root surface exposes the check (`just protocol-check` and/or package script) with deterministic diagnostics.
- [ ] Unit tests cover success and intentional registry corruption.

**Verification:** `bun test scripts/protocol-check.test.ts`; `just protocol-check` exit 0 on the tree.

- **Dependencies:** M0-03a
- **Likely files:** `scripts/protocol-check.ts`, `scripts/protocol-check.test.ts`, `justfile`, `package.json`
- **Scope:** M

##### M0-03c — TypeScript deterministic CBOR subset

**Description:** Implement the R2WP v0 deterministic CBOR encode/decode subset inside the TypeScript SDK package.

**Acceptance criteria:**

- [ ] Encoder/decoder enforce definite lengths, shortest integers, sorted uint keys, and reject tags/floats/indefinite/duplicate keys/invalid UTF-8 with `invalid_control` semantics.
- [ ] Nesting depth and map entry bounds match the registry.
- [ ] Focused Bun tests cover accept and reject vectors without full frame fixtures yet.

**Verification:** `bun test` for `sdk/typescript/src/protocol/**`.

- **Dependencies:** M0-03b
- **Likely files:** `sdk/typescript/src/protocol/cbor.ts`, `sdk/typescript/src/protocol/cbor.test.ts`, `sdk/typescript/package.json`
- **Scope:** M

##### M0-03d — TypeScript bootstrap/frame codec and valid/boundary fixtures

**Description:** Build bootstrap and selected-version frame codecs on the CBOR subset and commit valid/boundary golden fixtures.

**Acceptance criteria:**

- [ ] Codecs cover 12-byte bootstrap prefix, 32-byte headers, extension TLVs, and CONTROL_CBOR maps.
- [ ] Fixtures cover header boundaries, flags, schema identity pairs, SessionReady fields, and absolute limit boundaries.
- [ ] Manifest records bytes, semantic JSON, and expected success.

**Verification:** `bun test` codec suite; byte-stable re-encode of goldens under `protocol/testdata/valid/`.

- **Dependencies:** M0-03c
- **Likely files:** `sdk/typescript/src/protocol/frame.ts`, `sdk/typescript/src/protocol/bootstrap.ts`, `sdk/typescript/src/protocol/*.test.ts`, `protocol/testdata/valid/`, `protocol/testdata/manifest.json`
- **Scope:** M

##### M0-03e — Malformed, state-sequence, and transport parity fixtures

**Description:** Extend fixtures for malformed frames, session sequences, resume mismatch, dispositions, and WT/WSS parity.

**Acceptance criteria:**

- [ ] Malformed cases cover truncation, overflow, bad extensions, duplicate CBOR keys, and zero common version.
- [ ] Sequences cover open/resume success and `gateway_instance_mismatch` / `support_row_mismatch`, multi-domain same-row, cross-row independent sessions, `sequence_gap`, and `stale_sequence`.
- [ ] Parity manifest states one semantic fixture set for WebTransport and binary WSS.

**Verification:** Fixture suite expects stable codes; parity file under `protocol/testdata/parity.json`.

- **Dependencies:** M0-03d
- **Likely files:** `protocol/testdata/malformed/`, `protocol/testdata/sequences/`, `protocol/testdata/parity.json`, `sdk/typescript/src/protocol/*test*`
- **Scope:** M

##### M0-03f — Rust reference parser in rclwebd

**Description:** Implement the wire version 0 parser inside the gateway crate.

**Acceptance criteria:**

- [ ] `rclwebd` parses valid fixtures into structured records and maps malformed fixtures to registry error codes.
- [ ] Locked Cargo tests load committed fixture bytes from `protocol/testdata/`.

**Verification:** `cargo test --locked -p rclwebd`.

- **Dependencies:** M0-03e
- **Likely files:** `rclwebd/src/protocol/mod.rs`, `rclwebd/src/protocol/frame.rs`, `rclwebd/src/protocol/bootstrap.rs`, `rclwebd/src/protocol/tests.rs`, `rclwebd/Cargo.toml`
- **Scope:** M

##### M0-03g — MoonBit reference parser in rclmbt

**Description:** Implement the wire version 0 parser inside the MoonBit runtime module.

**Acceptance criteria:**

- [ ] `rclmbt` parses the same fixture set with matching error codes for assigned coverage.
- [ ] Frozen `moon test --target wasm` covers the protocol package.

**Verification:** `moon test --frozen --target wasm` for `rclmbt/protocol` sources.

- **Dependencies:** M0-03e
- **Likely files:** `rclmbt/protocol/moon.pkg`, `rclmbt/protocol/frame.mbt`, `rclmbt/protocol/bootstrap.mbt`, `rclmbt/protocol/frame_test.mbt`, `rclmbt/moon.mod`
- **Scope:** M

##### M0-03h — Cross-language agreement and M0-03 gate

**Description:** Prove Rust, MoonBit, and TypeScript agreement on the fixture set and close M0-03 after review.

**Acceptance criteria:**

- [ ] Agreement report covers every golden fixture semantic record or stable error code across the three parsers.
- [ ] WebTransport and WSS share the semantic fixture set in the report.
- [ ] Plan/todo mark M0-03 complete only after review Accept.

**Verification:** Root test or `just protocol-agree` runs multi-language agreement; docs updated.

- **Dependencies:** M0-03f, M0-03g
- **Likely files:** `scripts/protocol-agree.ts`, `protocol/testdata/agreement/`, `justfile`, `tasks/plan.md`, `tasks/todo.md`
- **Scope:** M

#### M0-04 — Generate the authoritative ROS CDR corpus

**Description:** Produce reproducible ROS-generated bytes and recursive type metadata for the mainline conformance set.

**Acceptance criteria:**

- [ ] Fixtures cover primitives, endian cases, arrays, strings, wide strings, nesting, bounds, PointCloud2, Service, and Action types.
- [ ] Each fixture carries values, type description, schema identity `(scheme, value)`, type name, encoding, schema generation, serialized bytes, ROS image, RMW, and generator revision.
- [ ] Jazzy fixtures use scheme `rep2011-rihs`; Humble fixtures use scheme `moonspan-schema-v1` with recursive bundle metadata.
- [ ] Corpus includes canonical bundle bytes and Jazzy provenance-mapping fixtures between `rep2011-rihs` and `moonspan-schema-v1`.
- [ ] Corpus generation reproduces the manifest hashes in the pinned environment.
- [ ] Fast DDS and Cyclone DDS rows on Humble and Jazzy expose any byte or semantic differences explicitly.

**Verification:** `just cdr-corpus-check` regenerates metadata and matches the committed manifest.

- **Dependencies:** M0-01, M0-02
- **Likely files:** `conformance/interfaces/`, `conformance/cdr/generate/`, `conformance/cdr/fixtures/`, `conformance/cdr/manifest.json`
- **Scope:** M

#### M0-05 — Establish the evidence harness and report schema

**Description:** Build the common artifact format, environment capture, workload schema, and report generator used by every gate.

**Acceptance criteria:**

- [ ] Machine-readable schemas cover environment, invocation, workload, samples, budgets, metrics, errors, raw artifact hashes, and review metadata.
- [ ] Environment and result schemas record `gateway_instance_id`, `support_row_id`, exercised `domain_id` values, adapter ABI/artifact identity, and readiness/profile-validation results.
- [ ] A deterministic sample run produces raw output and a generated Markdown report.
- [ ] Workload definitions cover the transport matrix, graph churn, fault scenarios, and soak tests.
- [ ] Artifact retention and publication locations are documented.

**Verification:** `just evidence-smoke` validates schemas and regenerates the sample report byte-for-byte.

- **Dependencies:** M0-02
- **Likely files:** `benchmarks/schema/`, `benchmarks/workloads/`, `benchmarks/report/`, `docs/evidence/`
- **Scope:** M

#### M0 gate

- [ ] ADR and support-profile review passes.
- [ ] Root commands pass from a clean checkout with the pinned Bun toolchain.
- [ ] R2WP and CDR fixtures have reproducible manifests.
- [ ] Evidence smoke artifacts validate and regenerate.
- [ ] Human review approves M1 execution.

### M1 — Core data path, Weeks 3–6

#### M1-01 — Implement `cdr_mbt`

**Description:** Implement the MoonBit CDR correctness core and bounded views for the M1 corpus.

**Acceptance criteria:**

- [ ] CDR1 encode and decode cover the declared corpus and endian cases.
- [ ] The declared XCDR2 subset has explicit fixtures and behavior.
- [ ] Truncation, alignment, bounds, overflow, and schema mismatch return typed errors.
- [ ] PointCloud2 fields expose bounded views with explicit buffer ownership.

**Verification:** `moon test --target wasm` and `just cdr-conformance` reach 100% agreement for the M1 corpus.

- **Dependencies:** M0-02, M0-04
- **Likely files:** `rclmbt/cdr_mbt/`, `rclmbt/conformance/cdr/`
- **Scope:** L

#### M1-02 — Implement generated types and the type registry core

**Description:** Generate MoonBit and TypeScript types from ROS interfaces and register codecs by schema identity `(scheme, value)`.

**Acceptance criteria:**

- [ ] `.msg`, `.srv`, `.action`, and recursive descriptions generate deterministic source.
- [ ] Generated bindings carry type name, schema identity `(scheme, value)`, encoding, field metadata, and codec registration.
- [ ] Duplicate, conflicting, missing, and stale registrations produce stable errors.
- [ ] Source regeneration is reproducible in CI.

**Verification:** `just types-generate-check` produces a clean diff and cross-language fixture tests pass.

- **Dependencies:** M0-04, M1-01
- **Likely files:** `rclmbt/rosidl_generator_mbt/`, `rclmbt/rosidl_mbt_runtime/`, `sdk/typescript/generated/`, `conformance/types/`
- **Scope:** L

#### M1-03 — Establish the Wasm host ABI and executor poll loop

**Description:** Implement the bounded event-batch boundary between MoonBit/Wasm and the TypeScript Worker host.

**Acceptance criteria:**

- [ ] `poll(batch)` processes inbound frames, timers, graph state, and outbound work deterministically.
- [ ] Results carry completed operations, application events, released buffers, metrics, and the next deadline.
- [ ] Transferable-buffer and cross-origin-isolated ring paths share one lifecycle contract.
- [ ] Batch item, byte, execution-time, and retained-buffer budgets are configurable and observable.
- [ ] Worker fault and restart release ownership and complete pending work with structured errors.

**Verification:** MoonBit unit tests, Vitest host-contract tests, and Playwright Worker restart tests pass.

- **Dependencies:** M0-02, M0-03
- **Likely files:** `rclmbt/rclmbt_core/`, `rclmbt/web_host/`, `sdk/typescript/src/worker/`
- **Scope:** L

#### M1-04 — Implement the generic serialized ROS C ABI

**Description:** Build the versioned adapter for graph discovery and generic serialized publish/subscribe.

**Acceptance criteria:**

- [ ] Adapter lifecycle, graph snapshot/delta, subscribe, take, publish, buffer release, and errors use versioned fixed-width structures.
- [ ] Humble and Jazzy adapter builds share one ABI conformance suite and produce independently testable per-row adapter artifacts (H-FT, H-CY, J-FT, J-CY).
- [ ] Each per-row artifact ships an immutable adapter profile descriptor with `support_row_id`, ROS distro, RMW identifier, and adapter ABI version.
- [ ] Fast DDS and Cyclone DDS run the graph and sample fixtures on both distros across support-matrix CPU variants.
- [ ] Ownership, thread, callback, and shutdown rules are documented and tested.

**Verification:** C ABI contract tests and ROS container integration tests pass for the declared M1 matrix.

- **Dependencies:** M0-02, M0-04
- **Likely files:** `rclwebd/ros_adapter/include/`, `rclwebd/ros_adapter/src/`, `conformance/ros_adapter/`
- **Scope:** L

#### M1-05 — Build `rclwebd` graph, schema, and bounded scheduler core

**Description:** Connect the ROS adapter to Rust graph generations, schema cache keyed by `(scheme, value, type name, encoding, schema generation)`, channel state, and queue scheduling.

**Acceptance criteria:**

- [ ] Graph snapshots and deltas have monotonic generations and stable ordering.
- [ ] Schema cache entries carry schema identity `(scheme, value)`, type name, encoding, source, and generation.
- [ ] Graph, schema, channel, policy, metrics, logs, and audit records carry `gateway_instance_id`, immutable `support_row_id`, and `domain_id` where applicable.
- [ ] Channels enforce sample, byte, message-size, rate, bandwidth, priority, and deadline budgets.
- [ ] Admission, send, eviction, expiry, cancellation, and adapter errors emit stable reasons and metrics.
- [ ] At startup the gateway validates configuration and artifact profile against the adapter profile descriptor; divergence keeps readiness false with status `adapter_profile_mismatch`.
- [ ] The gateway exposes liveness, readiness, structured logs, and a metrics endpoint.

**Verification:** Rust unit/property tests, scheduler load tests, and adapter integration tests pass.

- **Dependencies:** M0-03, M1-04
- **Likely files:** `rclwebd/crates/gateway/`, `rclwebd/crates/scheduler/`, `rclwebd/crates/schema/`, `rclwebd/crates/telemetry/`
- **Scope:** L

#### M1-06 — Implement WebTransport, WSS, and the browser I/O Worker

**Description:** Carry R2WP v0 through both transports and expose one bounded event stream to the runtime Worker.

**Acceptance criteria:**

- [ ] Hello, graph, schema, channel, sample, clock, error, close, and resume flows pass fixtures, including `SessionReady` gateway/support-row profile fields.
- [ ] WebTransport maps reliable topics, datagrams, and sample streams according to the protocol.
- [ ] WSS preserves control priority, fairness, deadlines, and channel metrics through one connection.
- [ ] Reconnect, path changes, transport closure, and stale generations produce deterministic SDK events.
- [ ] Resume matching covers selected wire version, capabilities, `gateway_instance_id`, and `support_row_id`; mismatch yields the R2WP resume-mismatch result.
- [ ] Malformed, oversized, and pressure inputs stay within declared memory budgets.

**Verification:** Rust/TypeScript interop tests and browser end-to-end transport tests pass under loss, delay, and stalled-consumer scenarios.

- **Dependencies:** M0-03, M1-03, M1-05
- **Likely files:** `rclwebd/crates/r2wp/`, `rclwebd/crates/session/`, `sdk/typescript/src/io/`, `conformance/r2wp/`
- **Scope:** L

#### M1-07 — Deliver graph and publish/subscribe through the browser SDK

**Description:** Integrate the runtime, gateway, adapter, and SDK into the first bidirectional N1/N2 slice.

**Acceptance criteria:**

- [ ] The SDK connects, exposes graph state, creates a node, subscribes, and publishes typed messages.
- [ ] Real ROS nodes observe browser publications and browser subscribers observe real ROS samples.
- [ ] Sensor-data and reliable profiles expose compatibility and queue state.
- [ ] Headless examples run through WebTransport and WSS.
- [ ] SDK events and telemetry preserve `gateway_instance_id`, `support_row_id`, and `domain_id` provenance.
- [ ] Traces correlate ROS, gateway, browser, runtime, and application events.

**Verification:** `just e2e-pubsub` passes against each declared M1 ROS/RMW/transport row.

- **Dependencies:** M1-01, M1-02, M1-03, M1-04, M1-05, M1-06
- **Likely files:** `sdk/typescript/src/`, `examples/headless-client/`, `conformance/e2e/pubsub/`
- **Scope:** L

#### M1-08 — Qualify the PointCloud2 headless path and issue the M1 gate report

**Description:** Run the first architecture gate through a typed headless PointCloud2 consumer and the comparative transport matrix.

**Acceptance criteria:**

- [ ] PointCloud2 4 MiB at 10 Hz runs for 30 minutes within declared gateway, JS, Wasm, queue, copy, allocation, and memory budgets.
- [ ] Consumer checksums prove projected field correctness.
- [ ] 64 B, 32 KiB, and 64 KiB–4 MiB workloads run through the declared bridge matrix.
- [ ] Reports include raw artifacts, environment manifests, variance, and stable reasons.
- [ ] The gate report records architecture approval or scoped remediation.

**Verification:** `just gate-m1` validates all evidence and regenerates the report.

- **Dependencies:** M0-05, M1-07
- **Likely files:** `benchmarks/runners/`, `benchmarks/reports/m1/`, `conformance/e2e/pointcloud/`
- **Scope:** L

#### M1 gate

- [ ] CDR agreement reaches 100% for the M1 corpus.
- [ ] Graph and publish/subscribe work bidirectionally across the declared matrix.
- [ ] Both transports and both browser buffer paths pass.
- [ ] PointCloud2, memory, transport-efficiency, reconnect, and fault targets pass.
- [ ] Human review approves M2 execution.

### M2 — ROS semantics, Weeks 7–12

#### M2-01 — Complete dynamic type descriptions and lazy projection

**Description:** Load recursive custom schemas at runtime and build reusable alignment-aware field plans.

**Acceptance criteria:**

- [ ] Gateway schema acquisition and R2WP advertisement preserve type name, schema identity `(scheme, value)`, encoding, source, and generation.
- [ ] Runtime validates recursion, bounds, identity scheme and value, and cache generations.
- [ ] Field projection decodes requested fields across nested custom interfaces.
- [ ] Missing required Humble bundles produce stable `schema_unavailable` before channel activation.
- [ ] Cache pressure, schema changes, and stale channels produce stable behavior and metrics.

**Verification:** Custom-message fixtures and generated-versus-dynamic differential tests pass.

- **Dependencies:** M1-02, M1-07
- **Likely files:** `rclmbt/type_registry_mbt/`, `rclwebd/crates/schema/`, `conformance/types/dynamic/`
- **Scope:** L

#### M2-02 — Complete QoS and durability conformance

**Description:** Implement compatibility, history, durability, deadline, lifespan, and liveliness behavior across runtime, gateway, and transport.

**Acceptance criteria:**

- [ ] `RELIABLE`, `BEST_EFFORT`, `KEEP_LAST`, bounded `KEEP_ALL`, `TRANSIENT_LOCAL`, `DEADLINE`, `LIFESPAN`, and `LIVELINESS` have explicit state machines.
- [ ] Browser and gateway queue budgets remain consistent and observable.
- [ ] Compatibility explanations identify endpoint values and the governing rule.
- [ ] Fast DDS, Cyclone DDS, WebTransport, and WSS rows publish a conformance matrix.

**Verification:** `just qos-conformance` passes every supported row and emits the matrix report.

- **Dependencies:** M1-07
- **Likely files:** `rclmbt/rmw_web_mbt/`, `rclwebd/crates/scheduler/`, `conformance/qos/`
- **Scope:** L

#### M2-03 — Deliver Service semantics

**Description:** Add typed Service clients and servers with per-call streams, deadlines, cancellation, and policy context.

**Acceptance criteria:**

- [ ] Generated and dynamic request/response types operate end to end.
- [ ] Calls isolate correlation identity, deadline, cancellation, and terminal state.
- [ ] Gateway concurrency and resource limits apply per session and target.
- [ ] Browser client and server paths interoperate with real ROS counterparts.

**Verification:** Service conformance covers success, application error, timeout, cancellation, disconnect, restart, and pressure.

- **Dependencies:** M2-01, M2-02
- **Likely files:** `rclmbt/rmw_web_mbt/`, `rclwebd/ros_adapter/`, `sdk/typescript/src/service/`, `conformance/service/`
- **Scope:** L

#### M2-04 — Deliver Action semantics

**Description:** Add goal, feedback, status, result, and cancellation state across runtime, gateway, and SDK.

**Acceptance criteria:**

- [ ] Goal identity isolates concurrent operations and reconnect behavior.
- [ ] Feedback follows negotiated QoS and bounded queue policy.
- [ ] Result and cancellation transitions match the declared ROS behavior.
- [ ] Browser client and server paths interoperate with real ROS counterparts.

**Verification:** Action conformance covers acceptance, rejection state, feedback pressure, success, abort, cancellation, timeout, disconnect, and restart.

- **Dependencies:** M2-01, M2-02, M2-03
- **Likely files:** `rclmbt/rmw_web_mbt/`, `rclwebd/ros_adapter/`, `sdk/typescript/src/action/`, `conformance/action/`
- **Scope:** L

#### M2-05 — Deliver Parameter semantics

**Description:** Add list, describe, get, set, atomic update, events, type validation, and permission behavior.

**Acceptance criteria:**

- [ ] Typed and dynamic parameter values preserve descriptors and constraints.
- [ ] Atomic updates produce one correlated result and event sequence.
- [ ] Permission and resource decisions surface through structured SDK errors.
- [ ] Cache and event state recover across reconnect and graph changes.

**Verification:** Parameter conformance covers types, descriptors, atomicity, events, authorization, failure, and reconnect.

- **Dependencies:** M2-01, M2-03
- **Likely files:** `rclmbt/rmw_web_mbt/`, `rclwebd/ros_adapter/`, `sdk/typescript/src/parameter/`, `conformance/parameter/`
- **Scope:** M

#### M2-06 — Complete Clock and simulation-time behavior

**Description:** Implement ROS, system, steady, and simulation clocks with explicit mapping and jump behavior.

**Acceptance criteria:**

- [ ] Every timestamp and deadline names its clock.
- [ ] Clock synchronization publishes skew, uncertainty, age, and source.
- [ ] Simulation-time enable, pause, jump, and reset update runtime state deterministically.
- [ ] Deadlines and timers react according to their declared clock contract.

**Verification:** Clock conformance covers normal flow, skew, drift, pause, forward/backward jumps, source change, and reconnect.

- **Dependencies:** M1-07
- **Likely files:** `rclmbt/rclmbt_core/`, `rclwebd/ros_adapter/`, `sdk/typescript/src/clock/`, `conformance/clock/`
- **Scope:** M

#### M2-07 — Add MCAP recording and replay adapters

**Description:** Map MCAP schemas and channels to the shared registry and expose one SDK subscription model for live and replay sources.

**Acceptance criteria:**

- [ ] Recording preserves channel identity, schema identity `(scheme, value)`, type name, encoding, schema generation, source time, and trace context.
- [ ] Replay supports indexed seek, rate, pause, ranges, checksum, and bounded buffering.
- [ ] Live and replay samples use the same typed SDK event contract.
- [ ] Reliable transfer supports quotas, ranges, resume, and integrity verification.

**Verification:** Round-trip fixtures and mixed live/replay integration tests pass with timestamp and checksum evidence.

- **Dependencies:** M2-01, M2-06
- **Likely files:** `rclwebd/crates/recording/`, `sdk/typescript/src/recording/`, `conformance/mcap/`
- **Scope:** L

#### M2-08 — Validate multi-domain DDS sessions

**Description:** Preserve domain identity across gateway aggregation when one process selects exactly one distro/RMW adapter support row and multiple ROS domain IDs.

**Acceptance criteria:**

- [ ] One test run selects exactly one support-matrix adapter row (H-FT, H-CY, J-FT, or J-CY) and multiple ROS domain IDs under that row.
- [ ] Graph, schema, channel, policy, and audit records retain `gateway_instance_id`, immutable `support_row_id`, and `domain_id` within the selected row.
- [ ] Session isolation holds across duplicate ROS names and schema identities within the selected row.
- [ ] Reconnect and fault isolation hold within the selected row.
- [ ] Cross-row composition uses independent SDK sessions and retains gateway, support-row, and domain provenance.
- [ ] The matrix runner repeats the multi-domain suite independently for H-FT, H-CY, J-FT, and J-CY and for declared CPU variants; the report compares all rows.

**Verification:** Multi-domain DDS suites pass per row and produce a comparative mapping report.

- **Dependencies:** M2-02, M2-06
- **Likely files:** `rclwebd/crates/gateway/`, `conformance/topology/`
- **Scope:** L

#### M2-09 — Stabilize the public browser SDK contract

**Description:** Consolidate connection, graph, typed data, operations, clocks, recording, telemetry, errors, and capabilities into a versioned public API.

**Acceptance criteria:**

- [ ] Public TypeScript declarations have API review and generated reference documentation.
- [ ] Lifecycle, cancellation, retries, buffer retention, and errors have executable examples.
- [ ] Node and browser-compatible package boundaries are explicit.
- [ ] Compatibility and capability reporting drive runtime feature selection.
- [ ] API fixtures protect serialization and event compatibility.

**Verification:** Bun package tests, API-extractor checks, Playwright integration, and headless examples pass.

- **Dependencies:** M2-01, M2-02, M2-03, M2-04, M2-05, M2-06, M2-07, M2-08
- **Likely files:** `sdk/typescript/`, `examples/headless-client/`, `docs/sdk/`
- **Scope:** L

#### M2-10 — Issue the N2 semantic gate report

**Description:** Run the complete semantic and topology matrix and record M2 approval.

**Acceptance criteria:**

- [ ] Graph, dynamic types, QoS, Service, Action, Parameter, Clock, recording, and multi-domain DDS suites have raw evidence.
- [ ] Declared first-stage Humble/Jazzy Fast DDS and Cyclone DDS rows and transport paths have explicit results and limits.
- [ ] SDK contract review and migration baseline are complete.
- [ ] Remediation items have owner, scope, and gate disposition.

**Verification:** `just gate-m2` validates artifacts and regenerates the report.

- **Dependencies:** M2-02, M2-03, M2-04, M2-05, M2-06, M2-07, M2-08, M2-09
- **Likely files:** `benchmarks/reports/m2/`, `docs/reports/m2-semantic-gate.md`
- **Scope:** M

#### M2 gate

- [ ] The planned N2 conformance surface passes.
- [ ] Dynamic and generated types agree across the declared corpus.
- [ ] Recording and live transport share one SDK event model.
- [ ] Multi-domain DDS isolation across declared first-stage rows passes.
- [ ] Human review approves M3 execution.

### M3 — Production release, Weeks 13–18

#### M3-01 — Implement OIDC identity and session lifecycle

**Description:** Authenticate browser clients, issue short-lived session state, and bind identity to R2WP capabilities and resume.

**Acceptance criteria:**

- [ ] Issuer, audience, expiry, rotation, and revocation behavior are configurable and tested.
- [ ] Effective identity, policy revision, resource envelope, and capability set reach the SDK with `gateway_instance_id` and `support_row_id` context.
- [ ] Resume revalidates identity, policy generation, channel state, expiry, `gateway_instance_id`, and `support_row_id`.
- [ ] Stable-ID restart with preserved resumable state may continue the session; a replacement `gateway_instance_id` or `support_row_id` change requires a clean session.
- [ ] Identity service outages and cache expiry produce visible bounded behavior.

**Verification:** Authentication integration tests cover valid, expired, replayed, wrong-audience, wrong-issuer, rotated, and outage scenarios.

- **Dependencies:** M2-10
- **Likely files:** `rclwebd/crates/session/`, `rclwebd/crates/policy/`, `deploy/identity/`, `conformance/security/identity/`
- **Scope:** L

#### M3-02 — Enforce SROS2, operation ACLs, and audit

**Description:** Map browser capabilities into a dedicated gateway enclave and produce correlated audit records.

**Acceptance criteria:**

- [ ] Graph, subscribe, publish, Service, Action, Parameter, recording, asset, and diagnostic permissions have explicit rules scoped with `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable.
- [ ] SROS2 enclave, governance, permissions, keystore, and rotation procedures are reproducible.
- [ ] Audit records contain the fields and integrity controls defined by the security model, including the provenance trio.
- [ ] Policy changes update graph visibility and channel authorization by generation.
- [ ] Audit sink health and buffering follow a documented operation policy.

**Verification:** Policy matrix, SROS2 integration, rotation, denial, and audit integrity suites pass.

- **Dependencies:** M3-01
- **Likely files:** `rclwebd/crates/policy/`, `deploy/sros2/`, `conformance/security/authorization/`, `docs/runbooks/security.md`
- **Scope:** L

#### M3-03 — Enforce resource and command safety policy

**Description:** Apply aggregate and per-channel ceilings plus structured command controls.

**Acceptance criteria:**

- [ ] Sessions enforce connections, streams, channels, samples, bytes, size, rate, bandwidth, concurrency, queue, cache, and trace ceilings.
- [ ] Publish, Service, Action, and Parameter operations carry target, type, deadline, correlation, policy, and audit identity.
- [ ] Limit events use stable R2WP and SDK codes with scoped diagnostics.
- [ ] Pressure tests preserve control and cancellation latency within accepted budgets.

**Verification:** Resource exhaustion, concurrency, command, and mixed-priority suites pass with bounded-memory evidence.

- **Dependencies:** M3-01, M2-03, M2-04, M2-05
- **Likely files:** `rclwebd/crates/policy/`, `rclwebd/crates/scheduler/`, `sdk/typescript/src/capabilities/`, `conformance/security/resources/`
- **Scope:** L

#### M3-04 — Automate compatibility endpoints and the support matrix

**Description:** Qualify Humble and Jazzy adapters, Fast DDS and Cyclone DDS rows, the pinned Chrome reference, later browser tier assignment, transports, buffer paths, proxies, Foxglove, and rosbridge through one matrix runner.

**Acceptance criteria:**

- [ ] Humble and Jazzy adapters build and run the declared semantic rows on support-matrix CPU variants as per-process artifact/image profiles.
- [ ] Every row included in the release support set reaches **Qualified** through a reviewed report that records `gateway_instance_id`, `support_row_id`, domain IDs, adapter ABI/profile identity, and readiness/profile-validation results.
- [ ] Rows that retain **Qualification target** status stay in the future qualification set.
- [ ] The pinned Playwright-managed Chrome for Testing reference qualifies; Edge, Safari, and Firefox receive explicit SDK capability tiers from M3 evidence.
- [ ] WebTransport, WSS, reverse-proxy, and both buffer paths have environment-qualified results.
- [ ] Foxglove WSS/CDR and rosbridge JSON/CBOR-RAW expose independent policy and telemetry.

**Verification:** `just compatibility-matrix` produces a machine-readable matrix and linked report.

- **Dependencies:** M2-10
- **Likely files:** `conformance/matrix/`, `rclwebd/crates/compat/`, `deploy/compat/`, `docs/support-matrix.md`
- **Scope:** L

#### M3-05 — Package deployment and observability

**Description:** Create reproducible edge deployment artifacts, headers, configuration validation, health, telemetry, and recovery procedures.

**Acceptance criteria:**

- [ ] Images and packages pin gateway, adapter, ROS, and runtime dependencies as per-row profiles with immutable `support_row_id`.
- [ ] Deployment assigns a stable `gateway_instance_id` that persists across ordinary restart and in-place upgrade when resumable state is preserved.
- [ ] Proxy configuration covers HTTP/3, UDP 443, WSS, TLS, origin, COOP, and COEP.
- [ ] Health, readiness, metrics, logs, traces, and audit have dashboards and alerts, including readiness status `adapter_profile_mismatch`.
- [ ] Install, configuration, drain, upgrade, rollback, backup, and recovery procedures are executable.
- [ ] Effective configuration and secret mounting follow documented ownership.

**Verification:** A clean reference edge runs install, smoke, upgrade, rollback, restart, and recovery drills.

- **Dependencies:** M3-01, M3-02, M3-03
- **Likely files:** `deploy/containers/`, `deploy/proxy/`, `deploy/observability/`, `docs/runbooks/`
- **Scope:** L

#### M3-06 — Run fuzzing, soak, fault, and performance qualification

**Description:** Exercise protocol parsers, schemas, sustained workloads, dependency failures, and network faults against release budgets.

**Acceptance criteria:**

- [ ] R2WP, control schema, CDR, and dynamic type inputs have fuzzing results and retained reproducers.
- [ ] Eight-hour graph, sample, command, and recording workloads keep memory and queues within accepted envelopes.
- [ ] Network shaping covers latency, loss, reordering, bandwidth, roam, sleep/wake, proxy, and path change.
- [ ] Gateway, Worker, identity, policy, audit, schema, storage, and ROS failures have bounded recovery evidence.
- [ ] Stable-ID restart resume, replacement-ID clean session, same-row multi-domain, and cross-row independent-session scenarios have evidence.
- [ ] Comparative performance reports include raw artifacts and environment identity with gateway/support-row/domain provenance.

**Verification:** `just qualify-mainline` validates every required artifact and threshold.

- **Dependencies:** M3-02, M3-03, M3-04, M3-05
- **Likely files:** `conformance/fuzz/`, `conformance/faults/`, `benchmarks/reports/m3/`, `docs/reports/qualification.md`
- **Scope:** L

#### M3-07 — Publish the SDK, examples, migration guides, and operations docs

**Description:** Prepare versioned application and operator deliverables for release consumers.

**Acceptance criteria:**

- [ ] Browser SDK packages have provenance, integrity, API reference, examples, and compatibility metadata.
- [ ] Headless examples cover graph, publish/subscribe, Service, Action, Parameter, Clock, recording, telemetry, and capabilities.
- [ ] Migration guides cover rosbridge, Foxglove-oriented workflows, and direct SDK adoption.
- [ ] Operator documentation covers deployment, identity, SROS2, policy, observability, upgrade, rollback, and incidents.
- [ ] A clean consumer project installs and executes the released package through Bun.

**Verification:** Package smoke tests, documentation checks, examples, and clean-consumer tests pass.

- **Dependencies:** M2-09, M3-04, M3-05
- **Likely files:** `sdk/typescript/`, `examples/`, `docs/sdk/`, `docs/migration/`, `docs/runbooks/`
- **Scope:** L

#### M3-08 — Complete the mainline release gate

**Description:** Consolidate semantic, security, compatibility, performance, operations, licensing, and supply-chain evidence into the release decision.

**Acceptance criteria:**

- [ ] Release checklist links every required raw artifact and reviewed report.
- [ ] Critical findings have closure evidence and named owners.
- [ ] Signed packages, images, checksums, SBOMs, provenance, changelog, and release notes reproduce.
- [ ] Reference install, upgrade, rollback, recovery, and SDK consumer acceptance pass.
- [ ] Product, architecture, security, and operations owners approve the release.

**Verification:** `just release-verify` validates the release candidate and evidence manifest.

- **Dependencies:** M3-02, M3-03, M3-04, M3-05, M3-06, M3-07
- **Likely files:** `docs/releases/`, `docs/reports/release-readiness.md`, `CHANGELOG.md`, release manifests
- **Scope:** L

#### M3 gate

- [ ] Security, compatibility, eight-hour soak, fault, and performance qualification pass.
- [ ] Install, upgrade, rollback, and recovery pass on the reference edge.
- [ ] SDK packages, examples, runbooks, release notes, SBOMs, provenance, and signatures publish.
- [ ] Human review approves the mainline release.
- [ ] U0 and X0 entry gates open.

### U0 — Common Studio prototype, Weeks 19–24

Every U0 task depends directly or transitively on M3-08.

#### U0-01 — Freeze the prototype contract and frontend ADRs

**Description:** Review the released SDK against prototype needs and accept the React, Vite, rendering, media, workspace, and design-system choices.

**Acceptance criteria:**

- [ ] A capability-to-feature matrix maps every panel and command to released SDK APIs.
- [ ] ADRs record React, Vite, state ownership, docking, WebGPU/WebGL2, WebCodecs, and workspace serialization choices.
- [ ] `DESIGN.md` tokens and lint run through the root Bun command surface.
- [ ] Prototype browser, GPU, media, and accessibility profiles are pinned.

**Verification:** Prototype entry review and `just docs-check` pass.

- **Dependencies:** M3-08
- **Likely files:** `docs/adr/0101-*.md`, `studio/package.json`, `studio/vite.config.ts`, `.agents/docs/DESIGN.md`
- **Scope:** M

#### U0-02 — Build the shell, five-region layout, and subscription broker

**Description:** Create the desktop shell, Graph/Canvas/Inspector/Timeline regions, workspace state, and SDK subscription fan-out.

**Acceptance criteria:**

- [ ] The 56/248/flexible/292/104 px region model behaves across the declared desktop range.
- [ ] Broker deduplicates equivalent subscriptions and applies 60/30/10 Hz visibility budgets.
- [ ] Workspace documents serialize with an explicit version and migration hook.
- [ ] Main-thread state receives compact presentation events from Workers.

**Verification:** Vitest state tests and Playwright layout, broker, focus, and resize tests pass.

- **Dependencies:** U0-01
- **Likely files:** `studio/src/app/`, `studio/src/workspace/`, `studio/src/broker/`, `studio/tests/`
- **Scope:** L

#### U0-03 — Build Graph Explorer and Context Inspector

**Description:** Present graph hierarchy, search, types, QoS, telemetry, permissions, and resource state through released SDK events.

**Acceptance criteria:**

- [ ] Graph snapshots and churn preserve selection, expansion, focus, and stable ordering.
- [ ] Search and filters cover names, kinds, types, QoS, and domains.
- [ ] Inspector shows schema identity scheme/value (including `rep2011-rihs` when that scheme is active), type name, QoS, rate, latency, drops, queues, transport, permission, and budget fields.
- [ ] Capability and compatibility explanations use SDK-provided structured data.

**Verification:** Component tests, 1000-endpoint churn tests, keyboard tests, and end-to-end selection tests pass.

- **Dependencies:** U0-02
- **Likely files:** `studio/src/graph/`, `studio/src/inspector/`, `studio/tests/graph/`
- **Scope:** L

#### U0-04 — Build Plot, Raw, Diagnostics, and Log panels

**Description:** Add scalar and structured inspection panels over typed projections and shared retention budgets.

**Acceptance criteria:**

- [ ] Plot supports field selection, rate budgets, retained windows, legends, and clock identity.
- [ ] Raw Inspector handles generated and dynamic schemas with bounded expansion.
- [ ] Diagnostics and Log panels handle bursts, filtering, severity, and trace correlation.
- [ ] Panel suspension and resume preserve broker and buffer budgets.

**Verification:** Fixture, burst, memory, sampling, accessibility, and workspace integration tests pass.

- **Dependencies:** U0-02, U0-03
- **Likely files:** `studio/src/panels/plot/`, `studio/src/panels/raw/`, `studio/src/panels/diagnostics/`, `studio/src/panels/log/`
- **Scope:** L

#### U0-05 — Build 3D, TF, map, and PointCloud2 rendering

**Description:** Implement Worker-based WebGPU rendering with a declared WebGL2 compatibility tier.

**Acceptance criteria:**

- [ ] PointCloud2 typed views enter bounded GPU staging and buffer pools.
- [ ] TF, map, markers, camera pose, scene layers, and coordinate selection have deterministic state.
- [ ] Visibility and quality budgets control upload, draw, memory, and frame time.
- [ ] Context loss, resize, stale transforms, and renderer restart recover visibly.

**Verification:** Visual fixtures, coordinate tests, GPU memory traces, frame tests, and WebGL2 tier tests pass.

- **Dependencies:** U0-02, U0-03
- **Likely files:** `studio/src/render/`, `studio/src/panels/scene/`, `studio/src/panels/tf/`, `studio/src/panels/map/`
- **Scope:** L

#### U0-06 — Build the camera and WebCodecs path

**Description:** Decode H.264 and AV1 chunks in a Worker with keyframe-aware recovery and display telemetry.

**Acceptance criteria:**

- [ ] Codec configuration, stream generation, keyframes, timestamps, and color metadata have explicit state.
- [ ] Queue pressure evicts according to media policy and requests recovery through stable events.
- [ ] Decode and display timing correlate with source and gateway traces.
- [ ] Capability reporting selects qualified codec and browser paths.

**Verification:** Recorded fixtures, loss/reorder cases, keyframe recovery, memory, and 1080p60 latency tests pass.

- **Dependencies:** U0-02, U0-03
- **Likely files:** `studio/src/codec/`, `studio/src/panels/camera/`, `studio/tests/media/`
- **Scope:** L

#### U0-07 — Complete workspace, timeline, commands, sharing, and accessibility

**Description:** Integrate docking, layouts, Live/Replay, command workflows, versioned sharing, and complete interaction semantics.

**Acceptance criteria:**

- [ ] Docking, tabs, panel creation, layout migration, URL/share token, and command palette work end to end.
- [ ] Live and MCAP replay share the panel subscription API with seek, rate, loop, markers, and clock state.
- [ ] Publish, Service, Action, and Parameter commands display target, type, capability, preview, confirmation, audit identity, progress, and result.
- [ ] Keyboard, focus, reading order, status semantics, reduced motion, and contrast pass review.
- [ ] Connection, permission, schema, queue, and renderer failures have visible recovery state.

**Verification:** Playwright workflow, command-safety, accessibility, sharing, reconnect, and replay suites pass.

- **Dependencies:** U0-02, U0-03, U0-04, U0-05, U0-06
- **Likely files:** `studio/src/workspace/`, `studio/src/timeline/`, `studio/src/commands/`, `studio/src/share/`, `studio/tests/e2e/`
- **Scope:** L

#### U0-08 — Qualify and publish the common prototype

**Description:** Run integrated performance, compatibility, accessibility, safety, and SDK adoption evidence.

**Acceptance criteria:**

- [ ] Representative 12-panel workspace, PointCloud2, camera, graph churn, and command workflows meet the documented targets.
- [ ] Browser, GPU, codec, WebGPU/WebGL2, and buffer capability tiers publish.
- [ ] Startup, reconnect, Live/Replay switch, sharing, memory, context loss, and Worker restart reports pass.
- [ ] Accessibility and command-safety reviews have closure evidence.
- [ ] Prototype package, examples, screenshots, usage guide, and evidence manifest reproduce.

**Verification:** `just qualify-studio` validates artifacts and regenerates the prototype report.

- **Dependencies:** U0-03, U0-04, U0-05, U0-06, U0-07
- **Likely files:** `benchmarks/reports/u0/`, `docs/reports/studio-prototype.md`, `studio/`
- **Scope:** L

#### U0 gate

- [ ] Planned panel families and workflows pass end to end.
- [ ] Workspace, PointCloud2, camera, main-thread, and memory targets pass.
- [ ] Browser rendering/media tiers publish.
- [ ] Accessibility and command-safety reviews pass.
- [ ] Human review accepts the common prototype.

### X0 — Post-release N3 experiment

#### X0-01 — Measure an upstream ROS package Wasm sandbox

**Description:** Compile two representative upstream `rcl` or `rclcpp` packages through Emscripten and connect them through shared R2WP and browser host infrastructure.

**Acceptance criteria:**

- [ ] Builds are reproducible with documented patches and toolchains.
- [ ] One custom-message workflow runs through the sandbox and a real ROS graph.
- [ ] The report records supported APIs, package restrictions, Wasm size, startup, memory, runtime behavior, and maintenance cost.
- [ ] Human review records continuation scope.

**Verification:** `just experiment-n3` rebuilds the artifacts and runs the pinned demonstrations.

- **Dependencies:** M3-08
- **Likely files:** `experiments/n3-wasm/`, `docs/reports/n3-sandbox.md`
- **Scope:** L

## 11. Parallel execution plan

### Weeks 1–2

- Shared: M0-01 and M0-02.
- ROS owner: M0-04 environment and fixtures.
- Rust and SDK owners: M0-03 reference framing and control schema.
- Platform owner: M0-05 evidence schema and CI artifacts.

### Weeks 3–6

- MoonBit owner: M1-01, M1-02, and runtime portion of M1-03.
- ROS owner: M1-04 and M1-07 integration.
- Rust owner: M1-05 and gateway portion of M1-06.
- SDK owner: host portion of M1-03, browser portion of M1-06, and headless client.
- Platform owner: M1-08 workload automation and gate evidence.

### Weeks 7–12

- Type and QoS work begins with M2-01 and M2-02.
- Service, Action, and Parameter proceed in dependency order through M2-03, M2-04, and M2-05.
- Clock, recording, and multi-domain DDS work proceed through M2-06, M2-07, and M2-08.
- SDK stabilization and gate reporting close M2 through M2-09 and M2-10.

### Weeks 13–18

- Identity, SROS2, ACL, audit, and resource policy proceed through M3-01, M3-02, and M3-03.
- Compatibility and deployment proceed through M3-04 and M3-05.
- Qualification and consumer deliverables proceed through M3-06 and M3-07.
- M3-08 consolidates the signed release.

### Weeks 19–24

- U0-01 accepts the prototype contracts and frontend ADRs.
- Shell, graph, scalar panels, rendering, and media proceed in parallel after their shared prerequisites.
- U0-07 integrates workflows and accessibility.
- U0-08 qualifies and publishes the common prototype.
- X0-01 can proceed with an independent owner after M3-08.

## 12. Risks and responses

| Risk | Early evidence | Planned response | Decision point |
|---|---|---|---|
| MoonBit/Wasm host maturity | M1-03 batching, clocks, jitter, copies, allocations | Keep a synchronous Wasm state machine with a TypeScript scheduler and bounded ABI | M1 gate |
| CDR/XCDR2 and custom type coverage | M0-04 corpus and M1-01 differential results | Generated codecs plus dynamic projection keyed by schema identity `(scheme, value)` | M1 and M2 gates |
| QoS semantic drift | M1 baseline and M2-02 cross-RMW matrix | Explicit QoS state, stable trace events, per-RMW suites | M1 and M2 gates |
| WebTransport network coverage | M1-06 proxy, handshake, path, and resume data | One R2WP envelope over binary WSS | M1 and M3 gates |
| Large-message memory pressure | M1-08 queue, lease, copy, allocation, and memory traces | Byte budgets, sample streams, latest-wins policy, bounded pools | M1 gate |
| ROS distro evolution | Dual adapter builds and ABI fixtures | Versioned C ABI and shared protocol/runtime contracts | Every release |
| Security-policy complexity | M3 policy matrix and command scenarios | Effective capability schema, generation tracking, audit correlation | M3 gate |
| Compatibility matrix cost | M3-04 runtime and artifact duration | Tiered support profiles and reusable environment images | M3 gate |
| UI coupling to unstable contracts | M2 SDK review and M3 release evidence | Begin integrated Studio work after M3-08 | U0 entry |
| N3 package scope | X0 size, API, startup, and maintenance report | Keep the experiment bounded to two representative packages | X0 review |

## 13. Kickoff decision register

| ID | Decision | Accountable role | Required evidence | Decision deadline | Current state |
|---|---|---|---|---|---|
| D-01 | Reference qualification environment: reference robot, artifact storage, and confirmation of the already pinned ROS image, RMW, browser, CPU, and network profile | Platform/release owner (ROS/middleware owner consulted) | Reviewed environment manifest; device/runtime smoke proof; immutable storage location with access and retention proof | M0-01 exit | Partial; support profile pins ROS/RMW/browser/CPU/network; robot and artifact storage remain open |
| D-02 | Named workstream and review owners | Project lead | Named ownership for five workstreams plus product, architecture, security, and operations reviewers and integration owner coverage | M0-02 entry | Past M0-02 entry deadline (preparatory scaffolding has begun); named owners remain a human input |
| D-03 | Exact Bun version and root workspace/lockfile convention | Browser SDK/performance owner | Official Bun release identity; clean bootstrap and lockfile reproducibility; root command proof | First M0-02 scaffold commit | Resolved 2026-08-11: Bun 1.3.14 (revision `0d9b296af`); durable artifacts `.bun-version`, `package.json` (`packageManager`/`engines`, workspaces `sdk/*` `examples/*`), `bunfig.toml` (isolated linker), `scripts/docs-check.ts`, private `@moonspan/sdk` at `sdk/typescript`, committed `bun.lock` (workspace identity, zero external dependencies); U0 adds exact `studio` workspace |
| D-04 | OIDC provider and SROS2 reference environment | Security owner (Platform/release owner consulted) | Issuer metadata and test tenant; SROS2 enclave/keystore profile; credential rotation and integration smoke proof | M3-01 entry | Open |
| D-05 | Raw benchmark artifact retention and publication | Platform/release owner | Storage class; retention duration; access and redaction rules; integrity hash and retrieval drill | M0-05 report-schema freeze | Open |
| D-06 | Repository license and third-party licensing policy | Repository owner (legal/release review) | Accepted license identifier and text; copyright/NOTICE attribution; dependency and asset inventory; SPDX/SBOM output; compatibility review; CI policy and exception workflow | M0-01 exit | Awaiting human ruling; Apache-2.0 recommended |

D-06 source notes: [ROS 2 Jazzy package creation guidance](https://docs.ros.org/en/jazzy/How-To-Guides/Developing-a-ROS-2-Package.html), [Apache License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0), [Apache License application guidance](https://www.apache.org/legal/apply-license), [SPDX Apache-2.0](https://spdx.org/licenses/Apache-2.0.html).

**Register rules:** Unresolved rows retain their current state. Resolution records the actual decision date and a durable artifact pointer. M0-01 exit requires D-01 and D-06 resolved, and every other open kickoff choice registered with accountable role, required evidence, and decision deadline. `LICENSE` creation follows the recorded D-06 human ruling.

U0-01 handles React, Vite, docking, rendering, media, and prototype browser/GPU decisions after the mainline release.

The immediate execution target is M0-01 through M0-05. M1 implementation begins after the foundation gate approves contracts, fixtures, toolchains, and evidence schemas.
