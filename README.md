# rclweb

rclweb connects browser applications to ROS 2 through a versioned wire protocol (R2WP), a single Rust core compiled natively for the edge gateway and to Wasm for the browser, and a TypeScript SDK.

The project was restructured from the earlier three-language architecture (tag `pre-restructure`, formerly named moonspan). [ADR 0010](./docs/adr/0010-restructure-single-rust-core.md) records the decision; the [restructure proposal](./docs/proposals/architecture-restructure.md) carries the plan and rulings.

## Scope

| Path | Role |
|---|---|
| `rclweb/` | Rust core: R2WP protocol, CDR codecs, session/channel state, client engine + poll ABI (native + wasm32) |
| `rclwebd/` | Rust edge gateway: transport endpoints, serialized rcl attachment, policy |
| `sdk/typescript/` | Browser SDK: Worker host, buffers, public typed API around the core wasm artifact |
| `protocol/` | Normative R2WP contract, registry, schema, and frozen fixtures |
| `conformance/` | Authoritative ROS CDR corpus (six rows of data; one row gated in Phase 1) |
| `examples/` | Demo applications (from R1) |

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
| `just check` | Docs, protocol, corpus, and evidence checks; Rust fmt/clippy; SDK typecheck |
| `just test` | Bun and Cargo test suites |
| `just build` | Native build, fat-LTO `rclweb` wasm staged into the SDK, and SDK build |
| `just poll-latency` | Record wasm poll latency + size evidence (R-D1) |
| `just e2e` | Docker compose: Jazzy talker → rclwebd (J-FT) → SDK subscribe |
| `just e2e-h-ft` | Docker compose: Humble talker → rclwebd (H-FT) → SDK subscribe |
| `just image-rclwebd` | Docker: J-FT runtime image (`rclwebd:j-ft`) |
| `just gateway` | Docker compose: packaged J-FT gateway (host network) |
| `just image-rclwebd-h-ft` | Docker: H-FT runtime image (`rclwebd:h-ft`; regenerates FFI) |
| `just gateway-h-ft` | Docker compose: packaged H-FT gateway (host network) |
| `just ros-test` | Gateway tests against real rcl (sourced Jazzy env) |
| `just ros-test-pixi` | Same, using optional RoboStack Jazzy via pixi (not CI evidence) |
| `just protocol-check` | Validate the R2WP registry JSON and control CDDL |
| `just evidence-check` | Validate qualification-report schema, fixtures, and gate-report integrity |
| `just cdr-corpus-check` | Verify the committed ROS CDR corpus |

## Status

R0–R3 are complete through R3-04. R4-01 first slice (Authenticate off by
default, opt-in `oidc`), R4-02 first slice (operations endpoints + J-FT /
H-FT runtime images), and R4-03 first slice (qualification-report harness
against committed measurements) are in progress. The walking skeleton
reaches a live ROS talker in CI (`just e2e` / `e2e-ros-talker`, and Humble
via `just e2e-h-ft` / `e2e-ros-talker-h-ft`) with a committed demo under
`examples/subscribe-chatter`. Phases and gates live in the
[plan](./tasks/plan.md); current state lives in the
[checklist](./tasks/todo.md).

## Start here

| Need | Document |
|---|---|
| How to contribute | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Full documentation map | [docs/README.md](./docs/README.md) |
| Product scope | [docs/product-scope.md](./docs/product-scope.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Restructure plan and rulings | [docs/proposals/architecture-restructure.md](./docs/proposals/architecture-restructure.md) |
| Decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Plan and checklist | [tasks/plan.md](./tasks/plan.md), [tasks/todo.md](./tasks/todo.md) |

## Documentation discipline

- Read the [PCR map](./.agents/docs/README.md) before changing an enrolled area.
- Update the authoritative document with every contract, scope, architecture, stack, or validation change.
- Pair shared contract changes with versioned fixtures and evidence.
- Record durable decisions under [`docs/adr/`](./docs/adr/README.md).

Lockfiles: commit `Cargo.lock` and `bun.lock`. Generated outputs stay ignored (`target/`, `node_modules/`, `dist/`, caches).

## Licensing

Repository license and third-party compliance follow the recorded human ruling for [D-06](./tasks/plan.md#kickoff-decision-register) in the kickoff decision register. That ruling governs repository `LICENSE`/`NOTICE` text and third-party compliance artifacts.
