# Project context map

PCR records preserve the durable reasoning that contributors need across tasks. Formal requirements live under [`docs/`](../../docs/README.md). These records remain open to evidence-backed updates.

The project was restructured and renamed from moonspan to rclweb ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md), tag `pre-restructure`); the [restructure proposal](../../docs/proposals/architecture-restructure.md) carries the rulings, cut/keep lists, and performance plan.

## Context records

| Topic | Record |
|---|---|
| Product direction and phase boundary | [Intent](./intent.md) |
| System boundaries and the single-core decision | [Architecture](./architecture.md) |
| Languages, platforms, transport, and tooling | [Technology stack](./technology-stack.md) |
| Traps already paid for | [Gotchas](./gotchas.md) |
| Evidence, single oracle, and gate authority | [Validation](./validation.md) |
| Studio visual system | [DESIGN.md](./DESIGN.md) |

## Project records

| Need | Read |
|---|---|
| Formal documentation | [Documentation index](../../docs/README.md) |
| Architecture decisions | [ADR register](../../docs/adr/README.md) |
| Local WebTransport TLS (cert-hash, 14-day rotate) | [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md) |
| Restructure rulings and plan | [Restructure proposal](../../docs/proposals/architecture-restructure.md) |
| Delivery sequence | [Implementation plan](../../tasks/plan.md) |
| Current execution state | [Execution checklist](../../tasks/todo.md) |

## Code routes

| Area | Context |
|---|---|
| `protocol/**` | [Architecture](./architecture.md), [R2WP](../../docs/protocol/r2wp.md), [normative subset](../../protocol/r2wp-v0.md#normative-scope-after-the-restructure-v01-subset) |
| `rclweb/**` | [Architecture](./architecture.md), [technology stack](./technology-stack.md), [`rclweb` core](../../docs/runtime/core.md), [CDR contract](../../docs/runtime/cdr.md), [R1-02 session SM](../../docs/milestones/r1-02-session-channel-state.md), [R1-04 poll ABI](../../docs/milestones/r1-04-wasm-host-sdk.md), [R2-01 publish/QoS](../../docs/milestones/r2-01-data-plane-hardening.md), [R2-02 large-message / PointCloud2](../../docs/milestones/r2-02-large-message-path.md), [generated types](../../docs/runtime/generated-types.md) |
| `rclwebd/**` | [Architecture](./architecture.md), [`rclwebd`](../../docs/gateway/rclwebd.md), [R1-03 WS + rcl](../../docs/milestones/r1-03-gateway-ws-rcl.md), [R2-01 budgets/dispositions](../../docs/milestones/r2-01-data-plane-hardening.md), [security](../../docs/security.md) |
| `rclwebd/src/ros/**` | Vendored bindings + `ros` feature gating: [technology stack](./technology-stack.md), [R1-03 notes](../../docs/milestones/r1-03-gateway-ws-rcl.md#behavioral-notes) |
| `sdk/**` | [Intent](./intent.md), [architecture](../../docs/architecture.md), [R1-04 SDK host](../../docs/milestones/r1-04-wasm-host-sdk.md), [R1-05 e2e](../../docs/milestones/r1-05-e2e-evidence.md), [R2-01 publish/reconnect](../../docs/milestones/r2-01-data-plane-hardening.md), [R2-02 buffer strategies + large batch](../../docs/milestones/r2-02-large-message-path.md) |
| `examples/**` | [R1-05 e2e + demo](../../docs/milestones/r1-05-e2e-evidence.md) |
| `docker/**` | [R1-05 compose lane](../../docs/milestones/r1-05-e2e-evidence.md) |
| `conformance/**` | [Validation](./validation.md), [corpus README](../../conformance/cdr/README.md), [support matrix](../../docs/support-matrix.md) |
| `studio/**` | [Prototype scope](../../docs/prototypes/studio-ui.md), [DESIGN.md](./DESIGN.md) |

## Design record check

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

Studio adds this check to the root command surface at U0.
