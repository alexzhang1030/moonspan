# Moonspan

Moonspan is a browser-native ROS 2 connectivity and runtime platform built around R2WP, `rclmbt`, `rclwebd`, and a typed TypeScript browser SDK.

The repository is in M0 foundation work: polyglot workspaces, version pins, root commands, contracts, fixtures, and CI.

## Delivery boundary

The mainline delivers the protocol, browser runtime, edge gateway, SDK, ROS 2 semantics, security, compatibility, deployment, and release evidence through M3.

The common Studio UI is a side project that starts in U0 after the M3 mainline release gate. It consumes the released SDK as a reusable robotics application prototype. Studio workspace enrollment begins at U0.

## Toolchain pins

| Tool | Pin | Project file |
|---|---|---|
| Bun | 1.3.14 | `.bun-version`, `package.json` (`packageManager` / `engines`) |
| Rust | 1.97.1 | `rust-toolchain.toml`, workspace `rust-version` |
| MoonBit (`moonc`) | `0.10.6+80dc50f24` | `.moon-version` |
| just | 1.50.0 | `.just-version` |

`scripts/toolchain-check.ts` reads these pin files and verifies exact installed `bun`, `rustc`, `cargo`, `moon` (via `moon version --all`), `moonc`, and `just` identities. The root `justfile` invokes that checker. The future CI workflow will invoke it after the workflow lands. `.moon-version` and `.just-version` are Moonspan contracts consumed by those entrypoints. `rust-toolchain.toml` is consumed by rustup. Bun pin fields follow the repository `packageManager` / `.bun-version` convention.

### Pinned install (tested)

```bash
# Rust 1.97.1 with rustfmt and clippy (rustup)
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy
# Repository rust-toolchain.toml selects 1.97.1 automatically inside the checkout.

# MoonBit full compiler build 0.10.6+80dc50f24 (official installer; isolate with MOON_HOME)
export MOON_HOME="${MOON_HOME:-$HOME/.moon}"
curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash -s -- '0.10.6+80dc50f24'
export PATH="$MOON_HOME/bin:$PATH"
moon version --all
moonc -v
# Reproducible archive (darwin-aarch64 example):
# https://cli.moonbitlang.com/binaries/0.10.6%2B80dc50f24/moonbit-darwin-aarch64.tar.gz
# sha256 (archive): a70bd7a92c97b29125c4cb9a647a390bd850b10161191b61e9b7c9b2dd482ddb
# https://cli.moonbitlang.com/binaries/0.10.6%2B80dc50f24/moonbit-darwin-aarch64.tar.gz.sha256

# just 1.50.0 (official release asset; darwin-aarch64 example)
curl -fsSL -L -o just-1.50.0-aarch64-apple-darwin.tar.gz \
  https://github.com/casey/just/releases/download/1.50.0/just-1.50.0-aarch64-apple-darwin.tar.gz
tar -xzf just-1.50.0-aarch64-apple-darwin.tar.gz just
mkdir -p "${HOME}/.local/bin"
install -m 755 just "${HOME}/.local/bin/just"   # or another directory on PATH
export PATH="${HOME}/.local/bin:${PATH}"
just --version

# Bun 1.3.14
curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.14
# or: bun upgrade --version 1.3.14 when bun is already installed
bun --version
```

Installer version selectors use the exact tested pin arguments above: `0.10.6+80dc50f24`, `1.50.0`, `1.3.14`, and `1.97.1`. Those exact values are the project pins recorded in the pin files.

### Bootstrap and root commands

```bash
bun install --frozen-lockfile
just toolchain-check
just check
just test
just build
```

| Recipe | Covers |
|---|---|
| `just toolchain-check` | Exact bun / rustc / cargo / moon bundle / moonc / just identities vs pin files |
| `just check` | Toolchain identity, `bun run check` (docs static check), `cargo fmt` + locked `clippy -D warnings`, frozen `moon check --fmt`, `@moonspan/sdk` browser build check |
| `just test` | Root/tooling/SDK `bun test` once, locked `cargo test --workspace`, frozen `moon test --target wasm` |
| `just build` | Locked `cargo build --workspace`, frozen `moon build --target wasm`, `@moonspan/sdk` browser build |

Bun script meanings:

| Script | Meaning |
|---|---|
| `bun run check` | Documentation static check only (`docs:check`) |
| `bun run toolchain-check` | Installed-tool probe against project pins |
| `bun test` | All Bun tests (docs, toolchain unit tests, SDK) |
| `bun run test:docs` / `test:toolchain` | Focused Bun test entrypoints |

The repository currently carries **zero external package dependencies**. Workspace members stay private at version `0.0.0`. Repository `LICENSE` / `NOTICE` wait on the [D-06](./tasks/plan.md#13-kickoff-decision-register) human ruling.

## Workspace ownership

| Path | Role |
|---|---|
| `rclwebd/` | Rust edge gateway crate (Cargo workspace member) |
| `rclmbt/` | MoonBit/Wasm runtime module (`moon.work` member) |
| `sdk/typescript/` | Private `@moonspan/sdk` Bun workspace package |
| `examples/*` | Reserved mainline examples glob (empty until examples land) |
| `studio/` | Studio workspace enrollment begins at U0 |

Lockfiles: commit `Cargo.lock` and `bun.lock`. Generated outputs stay ignored (`target/`, `_build/`, `node_modules/`, `dist/`, `.mooncakes/`, caches).

## Start here

| Need | Document |
|---|---|
| Full documentation map | [docs/README.md](./docs/README.md) |
| Product scope and sequence | [docs/product-scope.md](./docs/product-scope.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Accepted decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Detailed implementation plan and kickoff decisions | [tasks/plan.md](./tasks/plan.md) |
| Execution checklist | [tasks/todo.md](./tasks/todo.md) |
| Agent context map | [.agents/docs/README.md](./.agents/docs/README.md) |
| Toolchain and workspace rationale | [.agents/docs/technology-stack.md](./.agents/docs/technology-stack.md) |

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

Repository license and third-party compliance follow the recorded human ruling for [D-06](./tasks/plan.md#13-kickoff-decision-register) in the kickoff decision register. That ruling governs repository `LICENSE`/`NOTICE` text and third-party compliance artifacts.
