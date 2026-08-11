# Moonspan

Moonspan connects browser applications to ROS 2 through a versioned wire protocol, a MoonBit/Wasm runtime, a Rust gateway, and a TypeScript SDK.

The project is in its M0 foundation phase. R2WP v0 is complete, while the remaining M0 work covers support decisions, hosted CI evidence, the ROS CDR corpus, and the evidence schema.

## Scope

The mainline runs through M3 and covers the protocol, runtime, gateway, SDK, ROS semantics, security, deployment, and release work. The common Studio UI starts at U0 after the mainline release. It is a consumer of the released SDK.

## Requirements

| Tool | Pin | Project file |
|---|---|---|
| Bun | 1.3.14 | `.bun-version`, `package.json` (`packageManager` / `engines`) |
| Rust | 1.97.1 | `rust-toolchain.toml`, workspace `rust-version` |
| MoonBit (`moonc`) | `0.10.6+80dc50f24` | `.moon-version` |
| just | 1.50.0 | `.just-version` |

Install the versions recorded in the project files. `just toolchain-check` verifies the local toolchain before running repository checks.

## Quick start

```bash
bun install --frozen-lockfile
just toolchain-check
just protocol-check
just protocol-fixtures-check
just protocol-agree
just check
just test
just build
```

## Commands

| Command | Purpose |
|---|---|
| `just toolchain-check` | Verify pinned tools |
| `just check` | Run static checks and protocol agreement |
| `just test` | Run the Bun, Rust, and MoonBit test suites |
| `just build` | Build all workspaces |
| `just protocol-fixtures-check` | Verify committed protocol fixtures |
| `just protocol-agree` | Compare TypeScript, Rust, and MoonBit protocol outcomes |

Protocol-specific commands are documented with the [R2WP fixtures](./protocol/testdata/README.md) and [agreement runner](./protocol/testdata/agreement/README.md).

## Status

M0-03 is complete. The [completion note](./docs/milestones/m0-03-r2wp-foundation.md) records its scope, while the [execution checklist](./tasks/todo.md) tracks the rest of M0.

## Workspace ownership

| Path | Role |
|---|---|
| `rclwebd/` | Rust edge gateway |
| `rclmbt/` | MoonBit/Wasm runtime |
| `sdk/typescript/` | TypeScript browser SDK |
| `examples/*` | Mainline examples |
| `studio/` | Studio workspace enrollment begins at U0 |

Lockfiles: commit `Cargo.lock` and `bun.lock`. Generated outputs stay ignored (`target/`, `_build/`, `node_modules/`, `dist/`, `.mooncakes/`, `artifacts/`, caches).

## Continuous integration

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the pinned toolchain checks on pushes, pull requests, and manual runs. M0-02 closes after the hosted artifacts receive review. ROS qualification and Studio follow their own phase gates.

## Start here

| Need | Document |
|---|---|
| Full documentation map | [docs/README.md](./docs/README.md) |
| Product scope and sequence | [docs/product-scope.md](./docs/product-scope.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Implementation plan | [tasks/plan.md](./tasks/plan.md) |
| Execution checklist | [tasks/todo.md](./tasks/todo.md) |

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
- Update the authoritative document with every contract, scope, architecture, stack, or validation change.
- Pair shared contract changes with versioned fixtures and evidence.
- Record durable decisions under [`docs/adr/`](./docs/adr/README.md).

## Licensing

Repository license and third-party compliance follow the recorded human ruling for [D-06](./tasks/plan.md#13-kickoff-decision-register) in the kickoff decision register. That ruling governs repository `LICENSE`/`NOTICE` text and third-party compliance artifacts.
