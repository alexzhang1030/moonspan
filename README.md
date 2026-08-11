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

`scripts/toolchain-check.ts` reads these pin files and verifies exact installed `bun`, `rustc`, `cargo`, `moon` (via `moon version --all`), `moonc`, and `just` identities. The root `justfile` and the foundation CI workflow (`.github/workflows/ci.yml`) both invoke that checker. Hosted run evidence remains pending until a reviewed run records artifact URLs. `.moon-version` and `.just-version` are Moonspan contracts consumed by those entrypoints. `rust-toolchain.toml` is consumed by rustup. Bun pin fields follow the repository `packageManager` / `.bun-version` convention.

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
just protocol-check
just protocol-fixtures-check
just check
just test
just build
```

| Recipe | Covers |
|---|---|
| `just toolchain-check` | Exact bun / rustc / cargo / moon bundle / moonc / just identities vs pin files |
| `just protocol-check` | Toolchain identity, then R2WP v0 contract validation (`bun run protocol-check`) |
| `just protocol-fixtures-check` | Toolchain identity, then aggregate fixture check (`bun run protocol-fixtures:check`; valid_boundary → malformed → sequences → parity) |
| `just protocol-fixtures-write` | Toolchain identity, then aggregate regenerate of all four fixture corpora (`bun run protocol-fixtures:write`) |
| `just protocol-malformed-fixtures-check` / `-write` | Standalone malformed corpus |
| `just protocol-sequence-fixtures-check` / `-write` | Standalone state-sequence corpus |
| `just protocol-parity-fixtures-check` / `-write` | Standalone transport parity corpus |
| `just check` | Toolchain identity, `bun run check` (docs, protocol contract, then aggregate fixtures), `cargo fmt` + locked `clippy -D warnings`, frozen `moon check --fmt`, `@moonspan/sdk` browser build check |
| `just test` | Root/tooling/SDK `bun test` once, locked `cargo test --workspace`, frozen `moon test --target wasm` |
| `just build` | Locked `cargo build --workspace`, frozen `moon build --target wasm`, `@moonspan/sdk` browser build |

Bun script meanings:

| Script | Meaning |
|---|---|
| `bun run check` | `docs:check`, then `protocol-check`, then aggregate `protocol-fixtures:check` (deterministic order) |
| `bun run protocol-check` | R2WP v0 registry + control CDDL contract validator (`scripts/protocol-check.ts`) |
| `bun run protocol-fixtures:check` | Aggregate reconstruct/verify: valid_boundary → malformed → sequences → parity (`scripts/protocol-fixtures.ts --check`) |
| `bun run protocol-fixtures:write` | Aggregate regenerate of all four corpora (`scripts/protocol-fixtures.ts --write`) |
| `bun run protocol-malformed-fixtures:write` / `:check` | Standalone malformed corpus regenerate / reconstruct-verify |
| `bun run protocol-sequence-fixtures:write` / `:check` | Standalone state-sequence corpus regenerate / reconstruct-verify |
| `bun run protocol-parity-fixtures:write` / `:check` | Standalone transport parity corpus regenerate / reconstruct-verify |
| `bun run toolchain-check` | Installed-tool probe against project pins |
| `bun test` | All Bun tests (docs, toolchain, protocol-check, four fixture suites, SDK codecs) |
| `bun run test:docs` / `test:protocol` / `test:protocol-fixtures` / `test:toolchain` | Focused root Bun test entrypoints (`test:protocol-fixtures` runs four files once each) |
| `bun run --filter @moonspan/sdk test:cbor` | Focused R2WP v0 deterministic CBOR encode/decode tests |
| `bun run --filter @moonspan/sdk test:bootstrap` | Focused bootstrap codec tests |
| `bun run --filter @moonspan/sdk test:extension` | Focused extension TLV codec tests |
| `bun run --filter @moonspan/sdk test:control` | Focused CONTROL_CBOR codec tests |
| `bun run --filter @moonspan/sdk test:frame` | Focused selected-frame codec tests |
| `cargo test --locked -p rclwebd` | Focused R2WP Rust reference parser tests (bootstrap, frame, fixture oracles; 55 tests) |

Current R2WP foundation progress: M0-03a–f are verified. Normative freeze and contract validator stand; TypeScript codecs cover CBOR, bootstrap, extension TLVs, all 15 CONTROL kinds, and selected-frame steps 1–16 at `sdk/typescript/src/protocol/{cbor,bootstrap,extension,control,frame}.ts` (package root continues to export `src/index.ts`). Rust reference parser at `rclwebd/src/protocol/` covers bootstrap steps 1–9 and selected-frame steps 1–16 against the same fixtures (`cargo test --locked -p rclwebd` 55 of 55; commits `9c07b4a`, `cca270c`). Fixture corpora: [protocol/testdata/README.md](./protocol/testdata/README.md) — valid/boundary (20 entries), malformed (55 fixtures: 14 bootstrap / 41 frame), sequences (13 scenarios / 26 events), parity (46 shared identities + 20 registry-bound rules); aggregate check via `bun run protocol-fixtures:check`. Fixture commits `3600ff4`, `63f21df`, `154afb1`. M0-03 remains active for M0-03g MoonBit and M0-03h agreement. Phase 1 support rows remain H-FT, H-CY, J-FT, and J-CY; Jazzy+ is later expansion; Studio is a U0 side project after M3.

Bun carries workspace identity only. The `rclwebd` normal tree is std only. The `serde_json` dev dependency serves fixture tests. Workspace members stay private at version `0.0.0`. Repository `LICENSE` / `NOTICE` wait on the [D-06](./tasks/plan.md#13-kickoff-decision-register) human ruling.

## Workspace ownership

| Path | Role |
|---|---|
| `rclwebd/` | Rust edge gateway crate (Cargo workspace member; R2WP reference parser under `src/protocol/`) |
| `rclmbt/` | MoonBit/Wasm runtime module (`moon.work` member) |
| `sdk/typescript/` | Private `@moonspan/sdk` Bun workspace package |
| `examples/*` | Reserved mainline examples glob (empty until examples land) |
| `studio/` | Studio workspace enrollment begins at U0 |

Lockfiles: commit `Cargo.lock` and `bun.lock`. Generated outputs stay ignored (`target/`, `_build/`, `node_modules/`, `dist/`, `.mooncakes/`, `artifacts/`, caches).

## Continuous integration (foundation lane)

The repository workflow [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) is the **M0 foundation tooling lane**. It runs on `push` to `main`, `pull_request`, and `workflow_dispatch` on `ubuntu-24.04` with `contents: read` permissions and concurrency cancellation.

Pinned GitHub Actions are referenced by full 40-character commit SHA (tag noted in comments):

| Action | Tag | Commit SHA |
|---|---|---|
| `actions/checkout` | v7 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/cache` | v6 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | v7 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `oven-sh/setup-bun` | v2.2.0 | `0c5077e51419868618aeaa5fe8019c62421857d6` |

The job installs Bun from `.bun-version`, Rust via `rust-toolchain.toml` (`1.97.1` with `rustfmt`/`clippy`), MoonBit from `.moon-version` into a runner-temp `MOON_HOME` using the official installer after SHA256 verification, and just `1.50.0` from the official `x86_64-unknown-linux-musl` asset after official SHA256 verification (`27e011cd6328fadd632e59233d2cf5f18460b8a8c4269acd324c1a8669f34db0`) into `RUNNER_TEMP/moonspan-bin`.

Dependency cache paths are install material only: `~/.bun/install/cache`, Cargo `registry/index`, `registry/cache`, and `git/db`, plus workspace `.mooncakes/`. Cache keys include runner OS/arch, pin files, and lockfiles. Toolchain homes and `target/` stay outside the cache.

MoonBit installer pin (recompute when the official script changes):

| Item | Value |
|---|---|
| URL | https://cli.moonbitlang.com/install/unix.sh |
| SHA256 | `46495f8cdc0050f79b6cb195d66478d101cb3601d68506568fbe377fcdf2a9fe` |
| Update owner | Platform/release owner when installer content or pin procedure changes |

Execution uses frozen/locked install and root recipes:

```text
bun install --frozen-lockfile
just toolchain-check
just check
just test
just build
```

After checkout, the workflow initializes `artifacts/ci/` placeholders (`environment.txt` and recipe logs with `status=not-started`). Tool setup appends recorded versions; each recipe tees over its log. When checkout succeeds, available evidence under `artifacts/ci/` uploads through `if: always()` dual artifacts (14-day retention), including setup or recipe failures:

- `moonspan-documentation-evidence-<run_id>-<attempt>` — README, docs, `.agents/docs`, tasks, workflow, pin/lock manifests, and check/environment logs (hidden paths included).
- `moonspan-test-build-evidence-<run_id>-<attempt>` — environment, toolchain-check, test, and build logs.

**Evidence scope:** this foundation lane records generic M0 tooling proof. Phase 1 Humble/Jazzy support rows **H-FT**, **H-CY**, **J-FT**, and **J-CY** land in later ROS container qualification workflows. Studio is a U0 side project after M3. Jazzy+ expansion remains a later matrix step.

Current CI evidence is local `actionlint` plus pinned root commands on this machine. The first hosted run will record artifact URLs for review. M0-02 CI acceptance stays open until that hosted evidence is reviewed.

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
