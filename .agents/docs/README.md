# Project context map

Use this map to load the smallest durable context for a task. PCR records capture cross-cutting intent and judgment; `docs/` owns detailed technical specifications. All PCR records listed here are unstamped and remain open to evidence-backed correction.

## Durable records

| Area or question | Read | Gist |
|---|---|---|
| Product purpose, mainline, side-project sequence | [intent.md](./intent.md) | Fixes R2WP, `rclmbt`, `rclwebd`, SDK, conformance, security, and release as the mainline; the common Studio prototype follows the release gate. |
| System boundaries and dependency order | [architecture.md](./architecture.md) | Explains browser runtime, controlled edge, ROS domain, and post-release UI ownership. |
| Languages, transport, platform, tooling | [technology-stack.md](./technology-stack.md) | Records current stack bets, first-stage Humble/Jazzy profile, and Bun as the selected JavaScript workspace tool. |
| Evidence philosophy and gate authority | [validation.md](./validation.md) | Separates mainline qualification from the later prototype qualification. |
| Prototype visual identity and interface rules | [DESIGN.md](./DESIGN.md) | Provides machine-readable tokens and design rationale for the post-mainline common Studio prototype. |

## Formal documentation

| Topic | Read |
|---|---|
| Documentation index and ownership | [docs/README.md](../../docs/README.md) |
| Accepted architecture decisions | [docs/adr/README.md](../../docs/adr/README.md) |
| Product scope | [docs/product-scope.md](../../docs/product-scope.md) |
| Architecture | [docs/architecture.md](../../docs/architecture.md) |
| Existing solution landscape | [docs/landscape.md](../../docs/landscape.md) |
| Technical reference set | [docs/references.md](../../docs/references.md) |
| R2WP | [docs/protocol/r2wp.md](../../docs/protocol/r2wp.md) |
| `rclmbt` | [docs/runtime/rclmbt.md](../../docs/runtime/rclmbt.md) |
| `rclwebd` | [docs/gateway/rclwebd.md](../../docs/gateway/rclwebd.md) |
| Security | [docs/security.md](../../docs/security.md) |
| Compatibility | [docs/compatibility.md](../../docs/compatibility.md) |
| Reference support profile | [docs/support-matrix.md](../../docs/support-matrix.md) |
| Validation | [docs/validation.md](../../docs/validation.md) |
| Common Studio prototype | [docs/prototypes/studio-ui.md](../../docs/prototypes/studio-ui.md) |
| Implementation sequence | [tasks/plan.md](../../tasks/plan.md) |
| Execution state | [tasks/todo.md](../../tasks/todo.md) |

## Planned code routes

| Planned area | Read first |
|---|---|
| `protocol/**` | [architecture record](./architecture.md), [R2WP](../../docs/protocol/r2wp.md), [validation](../../docs/validation.md) |
| `rclmbt/**` | [architecture record](./architecture.md), [stack record](./technology-stack.md), [`rclmbt`](../../docs/runtime/rclmbt.md) |
| `rclwebd/**` | [architecture record](./architecture.md), [`rclwebd`](../../docs/gateway/rclwebd.md), [security](../../docs/security.md) |
| `sdk/**` | [intent](./intent.md), [architecture](../../docs/architecture.md), [compatibility](../../docs/compatibility.md) |
| `conformance/**`, `benchmarks/**` | [validation record](./validation.md), [formal validation](../../docs/validation.md), [support matrix](../../docs/support-matrix.md) |
| `deploy/**` | [security](../../docs/security.md), [support matrix](../../docs/support-matrix.md), [compatibility](../../docs/compatibility.md), [`rclwebd`](../../docs/gateway/rclwebd.md) |
| `studio/**` | [prototype scope](../../docs/prototypes/studio-ui.md), [DESIGN.md](./DESIGN.md) |

## Record checks

Validate the design record through the selected Bun toolchain:

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

M0-02 wires general documentation link checks into the repository command surface and CI. U0-01 wires this design linter when the common prototype starts.
