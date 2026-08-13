# 0008: Bind each gateway process to one ROS adapter support row

## Status

Accepted

## Date

2026-08-10

## Context

First-stage support rows H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN differ by ROS distro, RMW implementation, adapter binary, and image profile. rclweb treats one adapter support row per gateway process as a deployment policy grounded in ROS runtime selection through `RMW_IMPLEMENTATION` and the usual process-local graph-cache model. Multi-domain gateway aggregation still needs clear provenance for evidence, audit, and SDK sessions.

## Decision

Bind each `rclwebd` process to exactly one ROS adapter support row.

- One `rclwebd` process binds to exactly one distro/RMW adapter support row: H-FT, H-CY, H-ZN, J-FT, J-CY, or J-ZN.
- That process may create multiple ROS contexts and domain IDs under the same selected row.
- Each row ships as an independently qualified deployment artifact and image variant with its distro adapter, RMW selection, adapter ABI version, and support-row identity.
- `support_row_id` is immutable for the running artifact and profile.
- `gateway_instance_id` is a deployment-provided stable identifier for one logical gateway instance. It persists across ordinary process restart and in-place upgrade when resumable state is preserved. A replacement deployment or intentionally fresh instance receives a new identifier. Matching `gateway_instance_id` supports restart resume; a replacement instance drives a clean session.
- Startup validates configured row ID, ROS distro, selected RMW implementation identifier, adapter ABI version, and artifact profile. A mismatch yields stable readiness and startup status `adapter_profile_mismatch` on the readiness endpoint and in logs. A profile mismatch keeps the gateway outside the ready state.
- Graph, schema, channel, policy, metrics, logs, audit, and evidence records carry `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable.
- One R2WP session terminates at one gateway instance and one support row. The session may expose multiple domain IDs under that row.
- Cross-row fleet views use multiple independent SDK sessions and retain gateway, support-row, and domain provenance through application aggregation.
- M2-08 repeats multi-domain tests independently per support row and CPU variant.
- A future in-process multi-row design requires a new ADR and measured evidence.

## Rationale

- `RMW_IMPLEMENTATION` selects the runtime implementation; rclweb holds the selected support-row profile constant for the gateway process lifetime.
- Process-local graph and type caches stay coherent under that constant distro/RMW profile.
- Independent image variants give each support row its own qualification artifact and promotion path.
- A stable `gateway_instance_id` distinguishes restart resume from replacement-instance clean sessions while `support_row_id` remains fixed for the running profile.
- Provenance fields keep multi-domain sessions and multi-row fleet views auditable and comparable in evidence reports.
- Application aggregation of independent SDK sessions preserves cross-row fleet composition while each gateway process stays single-row.

## Consequences

- Deployment ships six first-stage process and image variants for H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN.
- Readiness endpoints surface `adapter_profile_mismatch` when configuration and artifact identity diverge; the process stays outside ready until the profile matches.
- R2WP `SessionReady` is emitted by a ready gateway and carries the validated profile, including `gateway_instance_id` and `support_row_id`.
- R2WP resume matching includes gateway instance and support row; M0-03 freezes the exact resume-mismatch code.
- This decision is reflected in [R2WP](../protocol/r2wp.md), [`rclwebd`](../gateway/rclwebd.md), [the core runtime](../runtime/core.md), [architecture](../architecture.md), [architecture rationale](../../.agents/docs/architecture.md), [compatibility](../compatibility.md), [support matrix](../support-matrix.md), [security](../security.md), [validation](../validation.md), and the [implementation plan](../../tasks/plan.md).

## Revisit triggers

- Multiple ROS domain contexts within one support row fail isolation, performance, or recovery evidence.
- A proven safe multi-row in-process model appears with measured evidence that justifies a new ADR.
- Deployment evidence favors a process-per-domain topology over multi-domain contexts within one row.

## Source

- [Working with multiple RMW implementations (Humble)](https://docs.ros.org/en/humble/How-To-Guides/Working-with-multiple-RMW-implementations.html), including process-scoped `RMW_IMPLEMENTATION` selection
- [Creating an RMW implementation (Jazzy)](https://docs.ros.org/en/ros2_documentation/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html)
- [ADR 0006: edge ROS C ABI boundary](./0006-edge-ros-c-abi-boundary.md)
- [ADR 0007: Humble/Jazzy schema identity](./0007-humble-jazzy-schema-identity.md)
- [Reference support profile](../support-matrix.md)
