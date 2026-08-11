# Project context map

PCR records preserve the durable reasoning that contributors need across tasks. Formal requirements live under [`docs/`](../../docs/README.md). These records remain open to evidence-backed updates.

## Context records

| Topic | Record |
|---|---|
| Product direction and phase boundary | [Intent](./intent.md) |
| System boundaries and dependency order | [Architecture](./architecture.md) |
| Languages, platforms, transport, and tooling | [Technology stack](./technology-stack.md) |
| Evidence and gate authority | [Validation](./validation.md) |
| Studio visual system | [DESIGN.md](./DESIGN.md) |

## Project records

| Need | Read |
|---|---|
| Formal documentation | [Documentation index](../../docs/README.md) |
| Architecture decisions | [ADR register](../../docs/adr/README.md) |
| Delivery sequence | [Implementation plan](../../tasks/plan.md) |
| Current execution state | [Execution checklist](../../tasks/todo.md) |

## Code routes

| Area | Context |
|---|---|
| `protocol/**` | [Architecture](./architecture.md), [R2WP](../../docs/protocol/r2wp.md) |
| `rclmbt/**` | [Architecture](./architecture.md), [technology stack](./technology-stack.md), [`rclmbt`](../../docs/runtime/rclmbt.md), [CDR core](../../docs/runtime/cdr.md), [generated types](../../docs/runtime/generated-types.md) |
| `rclwebd/**` | [Architecture](./architecture.md), [`rclwebd`](../../docs/gateway/rclwebd.md), [security](../../docs/security.md) |
| `sdk/**` | [Intent](./intent.md), [architecture](../../docs/architecture.md) |
| `conformance/**`, `benchmarks/**`, `evidence/**` | [Validation](./validation.md), [CDR core](../../docs/runtime/cdr.md), [support matrix](../../docs/support-matrix.md), [evidence contracts](../../evidence/README.md) |
| `deploy/**` | [Security](../../docs/security.md), [compatibility](../../docs/compatibility.md) |
| `studio/**` | [Prototype scope](../../docs/prototypes/studio-ui.md), [DESIGN.md](./DESIGN.md) |

## Design record check

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

Studio adds this check to the root command surface at U0.
