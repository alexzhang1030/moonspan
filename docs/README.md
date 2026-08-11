# Moonspan documentation

This directory contains the technical documentation for Moonspan. Each document has a clear subject: product scope, architecture, protocol, runtime, gateway, validation, or delivery.

## Delivery order

1. Define contracts, fixtures, support profiles, and repository tooling.
2. Deliver R2WP, `rclmbt`, `rclwebd`, and the browser SDK data path.
3. Complete ROS 2 semantics, type handling, recording, and topology support.
4. Qualify identity, policy, compatibility, operations, and release artifacts.
5. Build the common Studio prototype on the released SDK.

## Document map

| Question | Authoritative document |
|---|---|
| Product purpose and delivery sequence | [Product scope](./product-scope.md) |
| System boundaries and data paths | [Architecture](./architecture.md) |
| Related projects and source material | [Landscape](./landscape.md), [references](./references.md) |
| Protocol contract and implementations | [R2WP](./protocol/r2wp.md) |
| Runtime and gateway | [`rclmbt`](./runtime/rclmbt.md), [CDR core](./runtime/cdr.md), [`rclwebd`](./gateway/rclwebd.md) |
| Security and compatibility | [Security](./security.md), [compatibility](./compatibility.md) |
| Supported ROS profiles | [Support matrix](./support-matrix.md) |
| Evidence and release gates | [Validation](./validation.md), [evidence contracts](../evidence/README.md) |
| Architecture decisions | [ADR register](./adr/README.md) |
| M0-03 outcome | [Completion note](./milestones/m0-03-r2wp-foundation.md) |
| Plan and current work | [Implementation plan](../tasks/plan.md), [execution checklist](../tasks/todo.md) |
| Post-mainline Studio work | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Workspace routes

| Area | Read first |
|---|---|
| Root tooling | [Technology stack](../.agents/docs/technology-stack.md), [repository README](../README.md) |
| `protocol/**` | [R2WP](./protocol/r2wp.md), [normative contract](../protocol/r2wp-v0.md), [fixtures](../protocol/testdata/README.md) |
| `rclmbt/**` | [`rclmbt`](./runtime/rclmbt.md), [CDR core](./runtime/cdr.md), [architecture](./architecture.md) |
| `rclwebd/**` | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md) |
| `sdk/**` | [Architecture](./architecture.md), [R2WP](./protocol/r2wp.md) |
| `conformance/**`, `benchmarks/**`, `evidence/**` | [Validation](./validation.md), [support matrix](./support-matrix.md), [evidence contracts](../evidence/README.md) |
| `deploy/**` | [Security](./security.md), [compatibility](./compatibility.md) |
| `studio/**` | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Change discipline

- Shared contract changes update their normative document, machine-readable fixtures, and every consuming implementation in one review unit.
- Measured claims link to reproducible evidence carrying environment, commands, raw data, and revision identity.
- Durable decisions live in the [ADR register](./adr/README.md). Open choices stay in the [kickoff decision register](../tasks/plan.md#13-kickoff-decision-register).
- The [PCR map](../.agents/docs/README.md) routes contributors to the relevant context.
- Run `just check`, `just test`, and `just build` before submitting changes.
