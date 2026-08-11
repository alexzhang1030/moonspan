# Validation rationale

Moonspan grants release authority through reproducible evidence. Targets guide engineering; raw measurements establish facts; reviewed gate reports approve progression.

The detailed targets, workloads, artifact schema, qualification scenarios, and gates live in [formal validation](../../docs/validation.md). The [implementation plan](../../tasks/plan.md) owns task order, and the [execution checklist](../../tasks/todo.md) owns current status.

## Mainline evidence order

1. M0 fixes support profiles, toolchains, contract fixtures, CDR corpus, and report schemas. The repository **foundation CI lane** (`.github/workflows/ci.yml`) records generic M0 tooling evidence: pinned Bun/Rust/MoonBit/just identities, frozen/locked root recipes, a combined documentation/protocol/fixture `check.log` from `bun run check` / `just check`, and test/build logs. After checkout, available evidence under `artifacts/ci/` uploads through dual always-on artifacts. Current evidence is local actionlint plus pinned root commands: `bun run check` runs `docs:check`, `protocol-check`, then aggregate `protocol-fixtures:check` (valid_boundary → malformed → sequences → parity once each); matching `just` recipes use the same root commands. M0-03d–e accepted local fixture evidence: commits `3600ff4`, `63f21df`, `154afb1`; `bun run test:protocol-fixtures` 277/277; full `bun test` 584/584; two aggregate writes retain parity SHA-256 `d75d07e46f878be00bb05fd395ccec768ad52950f749cad8b9fcd28a208f80c9`; corpora under [protocol/testdata/README.md](../../protocol/testdata/README.md) (20 valid/boundary entries, 55 malformed fixtures, 13 scenarios / 26 events, 46 shared identities + 20 registry-bound rules). Hosted run evidence remains pending until a reviewed run records artifact URLs. Humble/Jazzy support rows **H-FT**, **H-CY**, **J-FT**, and **J-CY** produce environment evidence through later ROS container qualification workflows and remain **Qualification targets**. Exact first-stage rows live in the [support matrix](../../docs/support-matrix.md). Process topology follows [ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md): one process per support row, provenance trio, and readiness profile validation. Studio remains a post-mainline U0 side project after M3.
2. M1 proves N1 wire agreement with schema identity `(scheme, value)`, graph and publish/subscribe, both transports, both browser buffer paths, and a headless PointCloud2 data path. Evidence carries `gateway_instance_id`, `support_row_id`, and `domain_id` where a gateway process is under test.
3. M2 proves the complete planned N2 runtime surface, dynamic types, QoS, recording, and multi-domain DDS behavior. Each multi-domain run selects one adapter support row (H-FT, H-CY, J-FT, or J-CY) with multiple ROS domain IDs; the matrix repeats per row and CPU variant. Cross-row composition uses independent SDK sessions.
4. M3 proves identity, SROS2, ACLs, audit, resource policy, compatibility with **Qualified** release support rows, deployment, soak, faults, SDK usability, and release reproducibility. Qualification covers `adapter_profile_mismatch` readiness, stable-ID restart resume, and replacement-ID clean sessions.
5. U0 proves the common prototype's panels, rendering, media, accessibility, command presentation, and workspace performance on the released SDK.

## Why the split matters

The mainline first slice terminates at a typed headless SDK consumer with checksums and correlated telemetry. This isolates CDR, host ABI, transport, scheduling, schema, buffer, and memory evidence. The post-release prototype adds GPU upload, media decode, frame pacing, and interaction evidence through stable contracts.

## Evidence authority

Every claim carries environment identity, exact invocation, code revision, fixture hash, raw machine-readable output, derived report, budgets, sample count, duration, variance, reviewer, and gate. Gateway-facing claims also record `gateway_instance_id`, `support_row_id`, exercised `domain_id` values, adapter ABI/artifact identity, and readiness/profile-validation results. A later claim updates the same authoritative report location and keeps historical evolution in version control.

## Review triggers

- CDR differences trigger codec and type-system review.
- Host jitter, copies, allocations, memory growth, or toolchain drift trigger runtime-boundary review.
- Transport, proxy, reconnect, or roaming gaps trigger channel and support-tier review.
- QoS or ROS semantic differences trigger runtime and RMW support review.
- Security, compatibility, deployment, soak, or fault findings trigger the affected release gate.
- Prototype rendering, media, accessibility, or command findings trigger U0 design and implementation review.
