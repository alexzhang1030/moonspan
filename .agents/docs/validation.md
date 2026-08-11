# Validation rationale

Moonspan advances through reproducible evidence and human gate review. Targets guide implementation. Raw measurements and conformance results establish the accepted state.

Detailed workloads and evidence requirements live in [validation](../../docs/validation.md). The [implementation plan](../../tasks/plan.md) owns sequence, and the [execution checklist](../../tasks/todo.md) owns status.

## Evidence order

1. M0 proves contracts, fixtures, toolchains, support profiles, and report schemas.
2. M1 proves CDR, the host boundary, both transports, graph, publish/subscribe, and the headless PointCloud2 path.
3. M2 proves ROS semantics, dynamic types, QoS, recording, and multi-domain behavior.
4. M3 proves identity, policy, security, compatibility, deployment, operations, faults, performance, and release reproducibility.
5. U0 proves the Studio integration, rendering, media, accessibility, command presentation, and workspace performance on the released SDK.

Phase 1 qualification covers H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN. Studio begins after M3.

## Evidence contract

Each accepted claim records:

- environment, support row, gateway, domain, and adapter identity;
- code and fixture revision;
- invocation, workload, budgets, duration, and sample count;
- raw machine-readable output and derived report;
- errors, variance, reviewer, and gate disposition.

Historical evidence stays in version control. A newer accepted run updates the authoritative report location.

## Review triggers

- CDR differences reopen codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review.
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen the affected release gate.
- Rendering, media, accessibility, or command findings reopen U0 review.
