# Validation rationale

rclweb advances through reproducible evidence and human gate review. Targets guide implementation. Raw measurements and conformance results establish the accepted state.

Detailed workloads and evidence requirements live in [validation](../../docs/validation.md). The [implementation plan](../../tasks/plan.md) owns sequence, and the [execution checklist](../../tasks/todo.md) owns status.

## Evidence order

1. R0 proves the shrunk repository stays green on the root command surface.
2. R1 proves the walking skeleton: corpus-passing Rust CDR port, live end-to-end subscribe in CI, wasm artifact size and poll latency, copy counters.
3. R2 proves the hardened data plane: publish, QoS subset, budgets, reconnect, adversarial fixtures, fuzzing, and the performance baseline against Foxglove bridge and rosbridge.
4. R3 proves ROS semantics, generated types, the second row, and the second transport.
5. R4 proves identity, policy, security, compatibility, deployment, operations, and release reproducibility; the evidence harness returns here with real reports to validate.
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

Historical evidence stays in version control. A newer accepted run updates the authoritative report location. The machine-readable report contract from the pre-restructure harness is parked at tag `pre-restructure` until R4.

## Review triggers

- CDR differences reopen codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review; the copy budget (two controllable payload copies) is a standing contract from R1.
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen the affected release gate.
- Rendering, media, accessibility, or command findings reopen U0 review.
- Rust wasm artifact size or poll latency outside an accepted envelope reopens ruling R-D1 (the only reopen path for the language decision).
