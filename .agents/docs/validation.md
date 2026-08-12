# Validation rationale

rclweb advances through reproducible evidence and human gate review. Targets guide implementation. Raw measurements and conformance results establish the accepted state.

Detailed workloads and evidence requirements live in [validation](../../docs/validation.md). The [implementation plan](../../tasks/plan.md) owns sequence, and the [execution checklist](../../tasks/todo.md) owns status.

## Evidence order

1. R0 proves the shrunk repository stays green on the root command surface.
2. R1 proves the walking skeleton: corpus-passing Rust CDR port, live end-to-end subscribe in CI, wasm artifact size and poll latency, copy counters.
3. R2 proves the hardened data plane: publish, QoS subset, budgets, reconnect ([R2-01](../../docs/milestones/r2-01-data-plane-hardening.md)), large-message path on both buffer strategies ([R2-02](../../docs/milestones/r2-02-large-message-path.md)), adversarial fixtures + fuzzing ([R2-03](../../docs/milestones/r2-03-fixtures-fuzzing.md)), and the performance baseline against Foxglove bridge and rosbridge ([R2-04](../../docs/milestones/r2-04-perf-baseline.md)).
4. R3 proves ROS semantics, generated types, the second row, and the second transport.
5. R4 proves identity, policy, security, compatibility, deployment, operations, and release reproducibility. R4-01 is Authenticate off-by-default / opt-in `oidc`. R4-02 is operations endpoints plus J-FT / H-FT runtime images ([deploy](../../docs/deploy.md)). R4-03 is the support matrix against live gates ([R4-03](../../docs/milestones/r4-03-evidence-harness.md)); there is no evidence-check CI job and no committed measurement JSON. Remaining-row live e2e is still open.
6. U0 proves the Studio integration on the released SDK.

Phase 1 gates row J-FT. Breadth returns through the support matrix (H-FT in R3, remaining rows in R4). Studio begins after R4.

## Single oracle

Fixtures are the single conformance oracle: the frozen R2WP fixtures under `protocol/testdata/` and the ROS CDR corpus under `conformance/cdr/` are consumed directly by the one implementation (the `rclweb` core). There is no cross-implementation agreement gate; ADR 0010 removed the multi-implementation delivery model. CDR layout and codec acceptance follow the [CDR core contract](../../docs/runtime/cdr.md).

## Evidence contract

Each accepted claim records:

- environment, support row, gateway, domain, and adapter identity;
- code and fixture revision;
- invocation, workload, budgets, duration, and sample count;
- raw machine-readable output and derived report;
- errors, variance, reviewer, and gate disposition.

Historical evidence stays in git history. Promotion to **Qualified** is a human edit of the [support matrix](../../docs/support-matrix.md), not a CI stamp and not a committed JSON pile.

## Review triggers

- CDR differences reopen codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review; the copy budget (two controllable payload copies) is a standing contract from R1.
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen the affected release gate.
- Rendering, media, accessibility, or command findings reopen U0 review.
- Rust wasm artifact size or poll latency outside an accepted envelope reopens ruling R-D1 (the only reopen path for the language decision).
