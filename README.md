# Moonspan

Moonspan is a browser-native ROS 2 connectivity and runtime platform built around R2WP, `rclmbt`, `rclwebd`, and a typed TypeScript browser SDK.

The repository is in its design and implementation-planning stage. M0 establishes executable workspaces, versioned contracts, conformance fixtures, and CI.

## Delivery boundary

The mainline delivers the protocol, browser runtime, edge gateway, SDK, ROS 2 semantics, security, compatibility, deployment, and release evidence through M3.

The common Studio UI is a side project that starts in U0 after the M3 mainline release gate. It consumes the released SDK as a reusable robotics application prototype.

## Start here

| Need | Document |
|---|---|
| Full documentation map | [docs/README.md](./docs/README.md) |
| Product scope and sequence | [docs/product-scope.md](./docs/product-scope.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Accepted decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Detailed implementation plan | [tasks/plan.md](./tasks/plan.md) |
| Execution checklist | [tasks/todo.md](./tasks/todo.md) |
| Agent context map | [.agents/docs/README.md](./.agents/docs/README.md) |

## Current validation

The current executable check validates the post-mainline prototype design record:

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

M0-02 creates the root `just check`, `just test`, `just build`, and documentation checks described in the implementation plan.

## Planned repository shape

```text
protocol/          R2WP contracts and fixtures
rclmbt/            MoonBit/Wasm ROS 2 runtime
rclwebd/           Rust gateway and ROS C ABI adapter
sdk/typescript/    Browser SDK and Worker host
conformance/       ROS and protocol conformance suites
benchmarks/        Reproducible workloads and reports
deploy/            Edge deployment and operations assets
studio/            Post-mainline common UI prototype
```

## Documentation discipline

- Read the [PCR map](./.agents/docs/README.md) before changing an enrolled area.
- Update the authoritative topic document with every contract, scope, architecture, stack, or validation change.
- Give shared-contract changes versioned fixtures and evidence.
- Record expensive decisions under [`docs/adr/`](./docs/adr/README.md).

## Licensing

M0-01 assigns the repository license and third-party licensing policy before package publication.
