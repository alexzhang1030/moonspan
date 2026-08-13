# Validation rationale

rclweb advances through reproducible evidence and human review. Targets guide implementation. Raw measurements and conformance results establish the accepted state.

Detailed workloads live in [validation](../../docs/validation.md). What is still open lives in [open work](../../tasks/plan.md).

## Single oracle

Fixtures are the single conformance oracle: the frozen R2WP fixtures under `protocol/testdata/` and the ROS CDR corpus under `conformance/cdr/` are consumed directly by the one implementation (the `rclweb` core). There is no cross-implementation agreement gate; ADR 0010 removed the multi-implementation delivery model. CDR layout and codec acceptance follow the [CDR core contract](../../docs/runtime/cdr.md).

## Evidence contract

Each accepted claim records:

- environment, support row, gateway, domain, and adapter identity;
- code and fixture revision;
- invocation, workload, budgets, duration, and sample count;
- stdout from the reproducing command (not committed);
- errors, variance, reviewer, and gate disposition.

Historical evidence stays in git history. Promotion to **Qualified** is a human edit of the [support matrix](../../docs/support-matrix.md), not a CI stamp and not a committed JSON pile. The current TypeScript package is `rcl-web@0.0.3` (`0.0.1` on npm shipped source). Publish is GitHub OIDC ([release](../../docs/release.md)).

## Review triggers

- CDR differences reopen codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review; the copy budget (one controllable payload copy: the RMW take) is a standing contract. The published baseline's primary metrics are ingest latency, CPU, and RSS ([performance](../../docs/performance.md)).
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen release review.
- Rendering, media, accessibility, or command findings reopen Studio review.
- Rust wasm artifact size or poll latency outside an accepted envelope reopens the single-core language decision ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)).
