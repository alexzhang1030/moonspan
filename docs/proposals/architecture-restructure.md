# Architecture restructure proposal

Status: R-D1 is ruled (option A, single Rust core — owner, 2026-08-12, this document's history is the pointer). R-D2/R-D3 recommendations stand unless overruled. R-D4 (project and component naming) is open and gates R0, because crate and directory names flow from it. Baseline commit for all counts: `d6dd478`.

Moonspan's product direction stays unchanged: typed, secure, CDR-native browser access to ROS 2 through a browser runtime, an edge gateway, and a TypeScript SDK. This proposal restructures **how** the mainline is built. The audit finding: at baseline, product code is ~15k lines, verification/tooling/process code is ~53k lines, and no end-to-end path exists (`sdk/typescript/src/index.ts` exports nothing; `rclwebd` has no server; no transport; no ROS attachment). The cost driver is structural: three protocol implementations plus a three-language agreement apparatus, a frozen v0 wire contract far wider than M1 needs, six first-class support rows, and an evidence harness with no real reports to check.

## Principles

1. **Walking skeleton first.** One live end-to-end sample gates all further breadth. Contracts harden after they carry traffic, not before.
2. **One implementation per side.** Fixtures are the single conformance oracle. No cross-implementation agreement gate.
3. **Freeze only what runs.** The wire contract version covers the subset the current phase exercises. Media, recording, resume, and Action streaming freeze when their phases implement them.
4. **Breadth follows proof.** One support row and one transport until the data plane is hardened; expansion re-enters through the existing support-matrix process.
5. **Process proportional to product.** Evidence harnesses, meta-tooling, and multi-level task registers return when they have real subjects.

## Rulings

### Decided

**R-D1 — Core language.** Ruling: single Rust core (option A), compiled native for the gateway and to wasm32 for the browser. MoonBit and the TypeScript protocol implementation are removed in R0.

Why (owner, 2026-08-12): MoonBit was chosen for Wasm convenience. Accepted counter-argument: the ADR 0004 poll boundary is a narrow buffer interface where Wasm authoring ergonomics matter least, while the gateway/browser split forces the protocol+CDR+state logic to exist on both sides — a single Rust crate makes that one codebase, whereas MoonBit structurally commits the project to two implementations plus permanent cross-implementation verification (the ~9,900-line agreement apparatus at baseline was the bill for that). R2-phase work (fuzzing, performance evidence, zero-copy views) also lands on mature Rust tooling.

Limits: reopens only if R1 evidence shows the Rust wasm artifact size or poll latency is unacceptable for a required deployment profile.

**Owner constraint on rcl bindings (2026-08-12):** the owner will neither reinvent an rclrs nor depend on someone else's rclrs (or equivalent third-party binding such as `r2r`). This proposal satisfies the constraint structurally: the browser core is an R2WP protocol client with rcl-shaped semantics, not an rcl binding — rclrs cannot serve there because it links the native rcl/rmw C libraries; and the gateway needs only the narrow serialized-only rcl surface already chosen by ADR 0006 (init, node, serialized publish/take, graph, wait sets — on the order of fifteen functions via bindgen), not a client library. The hard parts that justify rclrs's existence (typed message generation, typed executor API) are exactly what this architecture never needs at the gateway, because types live in the browser core. The r2r/rclrs stopgap in an earlier draft of R1 is withdrawn.

### Open

| ID | Question | Recommendation |
|---|---|---|
| R-D2 | Phase 1 support row | **J-FT** (Jazzy + Fast DDS: current distro, reference RMW). Corpus data for all six rows stays committed; gates run one row until R3. |
| R-D3 | Protocol v0.1 subset | Bootstrap, session ready, channel open/ready/close, data frame, error, heartbeat. Deterministic-CBOR control plane and framing layout survive from v0; media/recording/resume/operation sections move to a non-normative appendix until their phase. |
| R-D4 | Project and component naming | Component pair: browser client library `rclweb`, gateway daemon `rclwebd` (unchanged) — the `ssh`/`sshd` pattern, aligned with the `rcl<target>` convention (`rclnodejs` is third-party precedent). Project name: the owner noted the MoonBit-derived name likely changes; candidates are `rclweb` as the umbrella name, `webspan`/`wirespan` (keeps the bridge-span metaphor), or keeping `moonspan` and letting etymology fade. Owner's call; R0 renames crates and directories once ruled. |

## Target shape

Directory and crate names below are placeholders until R-D4 lands.

```text
core/            Rust: R2WP framing + control, CDR codecs, session/channel
                 state machines. Compiles native (gateway) and wasm32 (browser).
gateway/         Rust binary (rclwebd): transport endpoints, ROS attachment,
                 identity/policy/audit. Thin over core.
sdk/typescript/  Worker host + public typed API. Owns browser async, buffers,
                 reconnect. Wraps the core wasm artifact. No protocol parsing.
protocol/        Normative v0.1 spec + registry + fixtures (single oracle).
conformance/     ROS CDR corpus (all six rows of data kept; one row gated).
examples/        Demo app exercised by the walking skeleton and CI.
scripts/         Thin: fixture check, toolchain check (<100 lines each).
```

The ADR 0004 host boundary (synchronous Wasm state machine, async TypeScript Worker host, bounded poll batches) is unchanged; Rust/wasm-bindgen implements it the same way MoonBit would have.

## Phases

### R0 — Rulings and stop-loss

No new features. Tag current `main` as `pre-restructure`.

- Human rules R-D2..R-D4 (R-D1 is ruled).
- Delete: three-language agreement apparatus (`scripts/protocol-agree*`, `rclmbt/cmd/agree/`, `rclwebd/tests/protocol_agreement.rs`, `scripts/protocol-moonbit-agree*`, agreement fixtures); parity/sequence fixture generators; the MoonBit fixture bridges; the evidence harness (`scripts/evidence-*`, `evidence/`) parked in git history until R4.
- Shrink: `protocol/r2wp-v0.md` to the v0.1 subset (parked sections move to an appendix); `toolchain-check` and `docs-check` to minimal scripts; task IDs to two levels; milestone completion notes replaced by git tags plus short notes.
- Rewrite `tasks/plan.md` around R1..R4; add ADR 0010 (this restructure and the R-D1 ruling); amend `docs/architecture.md`, `docs/runtime/*`, `docs/protocol/r2wp.md`, and the PCR records in the same change.
- Gate: `just check`, `just test`, `just build` green on the shrunk repository.

### R1 — Walking skeleton

A browser page subscribes to a live ROS 2 topic end-to-end on one row (R-D2) and one transport (binary WebSocket).

- Gateway: tokio/axum WebSocket endpoint; ROS attachment through the narrow serialized-only rcl FFI surface (the ADR 0006 direction, pulled forward from R3): init, node, serialized publish/take, wait set, graph queries. The demo types' generated C typesupport links statically; dynamic (dlopen) typesupport resolution waits for R3. No third-party rcl binding, per the owner constraint under R-D1.
- Core: v0.1 bootstrap + channel + data path; CDR decode for `std_msgs/String`, then `sensor_msgs/PointCloud2` with borrowed views.
- SDK: `connect(url)` → `session.subscribe(topic, type)` → typed events; Worker host with transferable `ArrayBuffer`.
- Evidence: docker-compose integration test against a real ROS 2 talker in CI; committed demo under `examples/`.
- Gate: live sample flows in CI; demo recording reviewed.

### R2 — Data-plane hardening

- Publish direction; QoS subset (reliability, depth); explicit queue/byte budgets with stable dispositions; reconnect; large-message path measured on both buffer strategies.
- Adversarial and malformed fixtures return, targeted at the single parser; fuzzing on frame/control/CDR decoders.
- Performance baseline versus Foxglove bridge and rosbridge on the same workload; numbers recorded with environment identity.
- Gate: PointCloud2 at target rate with recorded evidence; adversarial suite green.

### R3 — Semantics and breadth

- Services, actions, parameters, graph events; generated types for the nine corpus roots plus the dual-scheme schema registry (recycles the frozen M1-02a contract).
- Second support row (H-FT) gated; WebTransport as second transport; the serialized adapter ABI is versioned and extracted per ADR 0006, and dynamic typesupport resolution (dlopen of a row's typesupport libraries) replaces the R1 static links.
- Gate: N2 subset demonstrated; conformance green on two rows and two transports.

### R4 — Productionization

- OIDC identity, SROS2/ACL, audit; deployment packaging and observability.
- Evidence harness returns (recycling the M0-05a report contract) now validating real gate reports.
- Support matrix expansion to remaining rows; SDK stabilization; release.
- Gate: release review.

## Cut list (R0)

| Asset | Size at baseline | Action |
|---|---|---|
| Three-language agreement apparatus | ~9,900 lines | Delete; fixtures become the only oracle |
| `scripts/protocol-{parity,sequence,malformed}-fixtures*` generators | ~12,800 lines | Delete; v0.1 fixtures regenerated by one small script in R2 |
| TypeScript protocol implementation (`sdk/typescript/src/protocol/`) | ~9,700 lines | Delete; SDK stops parsing R2WP |
| MoonBit protocol + CDR (`rclmbt/`) | ~20,400 lines | Delete once the Rust core passes the corpus gate (R-D1 ruled) |
| Evidence harness (`scripts/evidence-*`, `evidence/`) | ~2,400 lines | Park until R4 |
| `toolchain-check` / `docs-check` + their test suites | ~1,800 lines | Replace with minimal scripts |
| Six-row conformance gates | — | Gate one row; keep all corpus data committed |

## Keep list

- R2WP design: CDR-native sample path, deterministic-CBOR control plane, dual-transport equivalence, bounded budgets, provenance triple (`gateway_instance_id`, `support_row_id`, `domain_id`).
- The ROS CDR corpus and its pinned generator containers (`conformance/cdr/generate/`), tail-slack evidence, and the CDR core contract (`docs/runtime/cdr.md`) — these become the oracle the ported core must pass.
- The Rust protocol implementation (`rclwebd/src/protocol/`) as the seed of `core/`.
- ADR 0004 host boundary, ADR 0006 C ABI direction (deferred to R3), ADR 0007 schema identity, the M1-02a generated-types contract.
- PCR and ADR discipline; docs discipline with a smaller surface (`docs/` authoritative; `.agents/docs/` holds map, intent, and gotchas).

## Risks

| Risk | Response |
|---|---|
| Rust wasm artifact size or poll latency regresses versus MoonBit | R1 records size and latency; R-D1 reopens only on that evidence |
| Serialized rcl FFI in R1 is unsafe-heavy | The surface is ~15 functions confined to one module; sanitizer tests in CI; typed message generation never enters the gateway |
| Deleting the MoonBit stack discards sunk work | The CDR contract, corpus, and tail-slack survive as the oracle; git keeps the source |
| v0.1 subset later conflicts with parked v0 sections | Parked sections are non-normative until their phase re-freezes them against a running implementation |
