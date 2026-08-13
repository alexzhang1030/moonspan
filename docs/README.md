# rclweb documentation

This directory contains the technical documentation for rclweb. Each document has a clear subject: product scope, architecture, protocol, core, gateway, validation, or delivery.

## Delivery order

R0–R3 are complete. R4 (identity, deployment, support-matrix qualification, SDK release) is in progress, then the U0 Studio prototype. Details live in the [plan](../tasks/plan.md).

## Document map

| Question | Authoritative document |
|---|---|
| Product purpose and delivery sequence | [Product scope](./product-scope.md) |
| System boundaries, data paths, and performance contracts | [Architecture](./architecture.md) |
| Related projects and source material | [Landscape](./landscape.md), [references](./references.md) |
| Protocol contract and implementation | [R2WP](./protocol/r2wp.md) |
| Core and gateway | [`rclweb` core](./runtime/core.md), [CDR contract](./runtime/cdr.md), [generated types](./runtime/generated-types.md), [`rclwebd`](./gateway/rclwebd.md) |
| Security and compatibility | [Security](./security.md), [compatibility](./compatibility.md) |
| Supported ROS profiles | [Support matrix](./support-matrix.md) |
| Evidence and release gates | [Validation](./validation.md), [support matrix](./support-matrix.md) |
| Architecture decisions | [ADR register](./adr/README.md) |
| R1-01 Rust CDR | [Completion note](./milestones/r1-01-cdr-rust-port.md) |
| R1-02 session/channel state machine | [Completion note](./milestones/r1-02-session-channel-state.md) |
| R1-03 gateway WebSocket + rcl attachment | [Completion note](./milestones/r1-03-gateway-ws-rcl.md) |
| R1-04 Wasm host boundary + SDK subscribe | [Completion note](./milestones/r1-04-wasm-host-sdk.md) |
| R1-05 e2e CI evidence + demo | [Completion note](./milestones/r1-05-e2e-evidence.md) |
| R2-01 data-plane hardening | [Completion note](./milestones/r2-01-data-plane-hardening.md) |
| R2-02 large-message path | [Completion note](./milestones/r2-02-large-message-path.md) |
| R2-03 fixtures + fuzzing | [Completion note](./milestones/r2-03-fixtures-fuzzing.md) |
| R2-04 performance baseline | [Completion note](./milestones/r2-04-perf-baseline.md) |
| R3-01 services, actions, parameters, graph | [Completion note](./milestones/r3-01-services-actions-graph.md) |
| R3-02 generated types + dual-scheme registry | [Completion note](./milestones/r3-02-generated-types.md) |
| R3-03 H-FT row + WebTransport | [Completion note](./milestones/r3-03-h-ft-webtransport.md) |
| R3-04 adapter ABI + dynamic typesupport | [Completion note](./milestones/r3-04-adapter-abi-typesupport.md) |
| R4-01 OIDC / SROS2 / audit (in progress) | [Milestone note](./milestones/r4-01-oidc-sros2-audit.md) |
| R4-02 deployment + observability (in progress) | [Milestone note](./milestones/r4-02-deployment-observability.md), [deploy](./deploy.md) |
| R4-03 support matrix vs live gates (in progress) | [Milestone note](./milestones/r4-03-support-matrix.md) |
| Plan and current work | [Implementation plan](../tasks/plan.md), [execution checklist](../tasks/todo.md) |
| Post-mainline Studio work | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Workspace routes

| Area | Read first |
|---|---|
| Root tooling | [Technology stack](../.agents/docs/technology-stack.md), [repository README](../README.md), [CONTRIBUTING.md](../CONTRIBUTING.md) |
| `protocol/**` | [R2WP](./protocol/r2wp.md), [normative contract](../protocol/r2wp-v0.md), [fixtures](../protocol/testdata/README.md) |
| `rclweb/**` | [`rclweb` core](./runtime/core.md), [CDR contract](./runtime/cdr.md), [architecture](./architecture.md) |
| `rclwebd/**` | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md), [deploy](./deploy.md) |
| `sdk/**` | [Architecture](./architecture.md), [R2WP](./protocol/r2wp.md) |
| `conformance/**` | [Validation](./validation.md), [support matrix](./support-matrix.md), [corpus README](../conformance/cdr/README.md) |
| `studio/` (reserved until U0; not in the tree) | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Change discipline

- Shared contract changes update their normative document, machine-readable fixtures, and the consuming implementation in one review unit.
- Measured claims name the reproducing command (`just e2e`, `just poll-latency`). Do not commit a JSON pile under `docs/evidence`.
- Durable decisions live in the [ADR register](./adr/README.md). Open choices stay in the [kickoff decision register](../tasks/plan.md#kickoff-decision-register).
- The [PCR map](../.agents/docs/README.md) routes contributors to the relevant context.
- Run `just check`, `just test`, and `just build` before submitting changes.
