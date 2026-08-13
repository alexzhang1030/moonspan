# rclweb

rclweb connects browser applications to ROS 2 through a versioned wire protocol (R2WP), a single Rust core compiled natively for the edge gateway and to Wasm for the browser, and a TypeScript package (`rcl-web`).

## Scope

| Path | Role |
|---|---|
| `rclweb/` | Rust core: R2WP protocol, CDR codecs, session/channel state, client engine + poll ABI (native + wasm32) |
| `rclwebd/` | Rust edge gateway: transport endpoints, serialized rcl attachment, policy |
| `typescript/` | TypeScript package `rcl-web`: Worker host, buffers, public typed API around the core wasm artifact |
| `protocol/` | Normative R2WP contract, registry, schema, and frozen fixtures |
| `conformance/` | Authoritative ROS CDR corpus (six support rows; live talker e2e covers each) |
| `examples/` | Demo applications |

## Requirements

| Tool | Pin | Project file |
|---|---|---|
| Bun | 1.3.14 | `.bun-version`, `package.json` (`packageManager` / `engines`) |
| Rust | 1.97.1 (+ `wasm32-unknown-unknown`) | `rust-toolchain.toml`, workspace `rust-version` |
| just | 1.50.0 | `.just-version` |

`just toolchain-check` verifies the local toolchain before running repository checks.

## Quick start

```bash
just setup
just check
just test
just build
```

## Commands

| Command | Purpose |
|---|---|
| `just setup` | Frozen Bun install + `just doctor` |
| `just toolchain-check` | Verify pinned tools |
| `just doctor` | Pins plus rustc/rustfmt/clippy identity |
| `just fmt` / `just fmt-check` / `just clippy` / `just lint-rust` | Rust format and Clippy (subset of `just check`) |
| `just check` | Docs, protocol, corpus, license inventory, and npm pack members; Rust fmt/clippy; TypeScript package typecheck |
| `just test` | Bun and Cargo test suites |
| `just build` | Native build, fat-LTO `rclweb` wasm staged into the TypeScript package, and package build |
| `just npm-pack` | Copy `LICENSE`/`NOTICE` into `typescript/` and write the npm tarball |
| `just npm-pack-check` | Verify the tarball is `rcl-web@0.0.2` with the tsdown `dist/`, `LICENSE`, `NOTICE`, and wasm |
| `just poll-latency` | Print wasm poll latency + size |
| `just e2e` | Docker compose: Jazzy talker → rclwebd (J-FT) → SDK subscribe |
| `just e2e-h-ft` | Docker compose: Humble talker → rclwebd (H-FT) → SDK subscribe |
| `just image-rclwebd` | Docker: J-FT runtime image (`rclwebd:j-ft`) |
| `just gateway` | Docker compose: packaged J-FT gateway (host network) |
| `just image-rclwebd-h-ft` | Docker: H-FT runtime image (`rclwebd:h-ft`; regenerates FFI) |
| `just gateway-h-ft` | Docker compose: packaged H-FT gateway (host network) |
| `just ros-test` | Gateway tests against real rcl (sourced Jazzy env) |
| `just ros-test-pixi` | Same, using optional RoboStack Jazzy via pixi (not CI evidence) |
| `just protocol-check` | Validate the R2WP registry JSON and control CDDL |
| `just cdr-corpus-check` | Verify the committed ROS CDR corpus |
| `just license-inventory` | Regenerate `docs/third-party.md` from lockfiles |
| `just license-inventory-check` | Verify the inventory and OSI-permissive allowlist |

## Status

A browser page can subscribe to a live ROS 2 talker in CI (`just e2e`,
`just e2e-h-ft`, and the Cyclone/Zenoh row lanes). The TypeScript package
is `rcl-web@0.0.2` (npm rejected unscoped `rclweb` as too similar to
`rrweb`; `0.0.1` on the registry shipped TypeScript source). A human
publishes it from `typescript/` after `just build` (`npm publish`).
Support-matrix **Qualified** remains a human matrix edit.
Open work lives in [tasks/plan.md](./tasks/plan.md).

## Start here

| Need | Document |
|---|---|
| How to contribute | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Full documentation map | [docs/README.md](./docs/README.md) |
| TypeScript package | [docs/typescript.md](./docs/typescript.md) |
| Product scope | [docs/product-scope.md](./docs/product-scope.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Open work | [tasks/plan.md](./tasks/plan.md), [tasks/todo.md](./tasks/todo.md) |

## Documentation discipline

- Read the [PCR map](./.agents/docs/README.md) before changing an enrolled area.
- Update the authoritative document with every contract, scope, architecture, stack, or validation change.
- Pair shared contract changes with versioned fixtures and evidence.
- Record durable decisions under [`docs/adr/`](./docs/adr/README.md).

Lockfiles: commit `Cargo.lock` and `bun.lock`. Generated outputs stay ignored (`target/`, `node_modules/`, `dist/`, caches).

## Licensing

rclweb is licensed under the [Apache License, Version 2.0](./LICENSE).
Copyright 2026 Alex. See [NOTICE](./NOTICE).

Third-party crates on the published surface must be OSI-permissive. Policy
and inventory: [licensing](./docs/licensing.md),
[third-party](./docs/third-party.md).
