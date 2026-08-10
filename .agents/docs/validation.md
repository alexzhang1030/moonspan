# Validation rationale

Moonspan grants release authority through reproducible evidence. Targets guide engineering; raw measurements establish facts; reviewed gate reports approve progression.

The detailed targets, workloads, artifact schema, qualification scenarios, and gates live in [formal validation](../../docs/validation.md). The [implementation plan](../../tasks/plan.md) owns task order, and the [execution checklist](../../tasks/todo.md) owns current status.

## Mainline evidence order

1. M0 fixes support profiles, toolchains, contract fixtures, CDR corpus, and report schemas. Exact first-stage rows and **Qualification target** status live in the [support matrix](../../docs/support-matrix.md).
2. M1 proves N1 wire agreement with schema identity `(scheme, value)`, graph and publish/subscribe, both transports, both browser buffer paths, and a headless PointCloud2 data path.
3. M2 proves the complete planned N2 runtime surface, dynamic types, QoS, recording, and multi-domain DDS behavior. Each multi-domain run selects one adapter support row (H-FT, H-CY, J-FT, or J-CY) with multiple ROS domain IDs; the matrix repeats per row and CPU variant.
4. M3 proves identity, SROS2, ACLs, audit, resource policy, compatibility with **Qualified** release support rows, deployment, soak, faults, SDK usability, and release reproducibility.
5. U0 proves the common prototype's panels, rendering, media, accessibility, command presentation, and workspace performance on the released SDK.

## Why the split matters

The mainline first slice terminates at a typed headless SDK consumer with checksums and correlated telemetry. This isolates CDR, host ABI, transport, scheduling, schema, buffer, and memory evidence. The post-release prototype adds GPU upload, media decode, frame pacing, and interaction evidence through stable contracts.

## Evidence authority

Every claim carries environment identity, exact invocation, code revision, fixture hash, raw machine-readable output, derived report, budgets, sample count, duration, variance, reviewer, and gate. A later claim updates the same authoritative report location and keeps historical evolution in version control.

## Review triggers

- CDR differences trigger codec and type-system review.
- Host jitter, copies, allocations, memory growth, or toolchain drift trigger runtime-boundary review.
- Transport, proxy, reconnect, or roaming gaps trigger channel and support-tier review.
- QoS or ROS semantic differences trigger runtime and RMW support review.
- Security, compatibility, deployment, soak, or fault findings trigger the affected release gate.
- Prototype rendering, media, accessibility, or command findings trigger U0 design and implementation review.
