# rclweb documentation

These documents describe the product as it is: protocol, core, gateway, TypeScript package, support rows, and how to verify a change. They are not a delivery-phase ledger. Historical task IDs (M0, R1, U0, and the rest) stay in git and in ADR Decision text; they are not how you navigate this tree.

## Document map

| Question | Document |
|---|---|
| What this is, for whom, and what it is not | [Product scope](./product-scope.md) |
| Units, data paths, and copy/drop contracts | [Architecture](./architecture.md) |
| Related projects | [Landscape](./landscape.md), [references](./references.md) |
| Wire protocol | [R2WP](./protocol/r2wp.md) |
| Core, CDR, generated types | [`rclweb` core](./runtime/core.md), [CDR](./runtime/cdr.md), [generated types](./runtime/generated-types.md) |
| Gateway | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md), [deploy](./deploy.md) |
| TypeScript package | [`rcl-web`](./typescript.md) |
| Supported ROS profiles | [Support matrix](./support-matrix.md), [compatibility](./compatibility.md) |
| How claims are proven | [Validation](./validation.md) |
| License | [Licensing](./licensing.md), [third-party inventory](./third-party.md) |
| Why a choice was made | [ADR register](./adr/README.md) |
| What is still open | [Open work](../tasks/plan.md) |
| Studio (post-release UI) | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Workspace routes

| Area | Read first |
|---|---|
| Root tooling | [Technology stack](../.agents/docs/technology-stack.md), [repository README](../README.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [licensing](./licensing.md) |
| `protocol/**` | [R2WP](./protocol/r2wp.md), [normative contract](../protocol/r2wp-v0.md), [fixtures](../protocol/testdata/README.md) |
| `rclweb/**` | [`rclweb` core](./runtime/core.md), [CDR](./runtime/cdr.md), [architecture](./architecture.md) |
| `rclwebd/**` | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md), [deploy](./deploy.md) |
| `typescript/**` | [`rcl-web`](./typescript.md), [architecture](./architecture.md), [R2WP](./protocol/r2wp.md), [ADR 0014](./adr/0014-typescript-package-rcl-web.md) |
| `examples/**` | [`rcl-web`](./typescript.md), [examples README](../examples/README.md) |
| `conformance/**` | [Validation](./validation.md), [support matrix](./support-matrix.md), [corpus README](../conformance/cdr/README.md) |
| `studio/` (not in the tree) | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

## Change discipline

- Shared contract changes update their normative document, machine-readable fixtures, and the consuming implementation in one review unit.
- Measured claims name the reproducing command (`just e2e`, `just poll-latency`). Do not commit a JSON pile under `docs/evidence`.
- Durable decisions live in the [ADR register](./adr/README.md). Open product questions live in [open work](../tasks/plan.md).
- The [PCR map](../.agents/docs/README.md) routes contributors to the relevant context.
- Run `just check`, `just test`, and `just build` before submitting changes.
