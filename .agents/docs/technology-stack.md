# Technology stack rationale

Moonspan's stack supports browser-native ROS semantics, a binary hot path, bounded resource use, a controlled edge boundary, and reproducible release evidence. Detailed component behavior lives in the [formal documentation map](../../docs/README.md).

## Mainline stack

### MoonBit and WebAssembly

`rclmbt` uses MoonBit compiled to Wasm for CDR, generated and dynamic types, graph state, QoS, executor state, Service, Action, Parameter, and Clock semantics.

The initial boundary uses a synchronous Wasm state machine and an asynchronous JavaScript Worker host. Batched `poll` calls reduce boundary overhead and keep browser APIs in their native execution model. [Runtime documentation](../../docs/runtime/rclmbt.md) owns the contract and evidence requirements.

### Rust and a narrow ROS C ABI

`rclwebd` uses Rust for WebTransport, WSS, sessions, scheduling, schemas, metrics, policy, and audit. A versioned C ABI adapter uses generic serialized `rcl` and `rmw` operations and concentrates ROS distro variation.

The first measured path uses explicit one-copy ownership through bounded rings. Later buffer-sharing work follows allocator and lifetime evidence. [Gateway documentation](../../docs/gateway/rclwebd.md) owns this boundary.

### R2WP, WebTransport, and WSS

R2WP wire version 0 freezes a 12-byte bootstrap prefix plus deterministic CBOR hello payloads, then a fixed 32-byte selected-version frame header with network-byte-order integers, extension TLVs, and CDR or media payloads. Control maps use RFC 8949 core deterministic encoding with unsigned integer keys under [protocol/schema/control-v0.cddl](../../protocol/schema/control-v0.cddl). Numeric registries live in [protocol/registry/r2wp-v0.json](../../protocol/registry/r2wp-v0.json). Normative prose is [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md); encoding decision is [ADR 0009](../../docs/adr/0009-r2wp-v0-wire-encoding.md). Machine contract validation is [scripts/protocol-check.ts](../../scripts/protocol-check.ts). Browser-internal TypeScript modules under `sdk/typescript/src/protocol/` implement deterministic CBOR (`cbor.ts`), bootstrap (`bootstrap.ts`), extension TLVs (`extension.ts`), all 15 CONTROL kinds (`control.ts`), and selected-frame steps 1–16 (`frame.ts`); package root exports remain `src/index.ts`. The Rust reference parser under [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) implements the same bootstrap steps 1–9 and selected-frame steps 1–16 surfaces (`parse_bootstrap`, `parse_frame`) against the committed fixtures (M0-03f review Accept; commits `9c07b4a`, `cca270c`). The MoonBit reference parser under [`rclmbt/protocol/`](../../rclmbt/protocol/) implements the same bootstrap and selected-frame surfaces with borrowed `BytesView` payloads (M0-03g review Accept; commits `2f7352f`, `1157138`, `0c5e4d2`, `133fd9f`; focused `moon test --frozen --target wasm rclmbt/protocol` 69 of 69). Fixture corpora (valid/boundary 20 entries, malformed 55 fixtures, sequences 13 scenarios / 26 events, parity 46 shared identities + 20 registry-bound rules) and aggregate Bun tooling live under [protocol/testdata/](../../protocol/testdata/README.md) and [scripts/protocol-fixtures.ts](../../scripts/protocol-fixtures.ts). Cross-language agreement (M0-03h review Accept) lives under [protocol/testdata/agreement/](../../protocol/testdata/agreement/) with orchestrator [scripts/protocol-agree-run.ts](../../scripts/protocol-agree-run.ts); implementation order typescript → rust → moonbit; root commands `bun run protocol-agree`, `bun run protocol-agree:write`, `just protocol-agree`, `just protocol-agree-write`. Design overview remains [docs/protocol/r2wp.md](../../docs/protocol/r2wp.md).

WebTransport supplies independent streams and datagrams under the HTTP/3 profile; as of 2026-08-11 the W3C API and IETF HTTP/3 mapping remain work-in-progress sources. Binary WSS (RFC 6455) carries one complete bootstrap record or selected-version frame per message. Both transports share one semantic fixture set through the committed parity corpus.

### TypeScript SDK and Bun

TypeScript defines the public browser SDK, Worker host, generated bindings, session lifecycle, typed operations, telemetry, and headless examples.

Bun is the human-selected JavaScript stack tool recorded on 2026-08-10. On 2026-08-11 the repository pinned **Bun 1.3.14** (revision `0d9b296af`) under [D-03](../../tasks/plan.md#13-kickoff-decision-register). Bun owns package installation, workspaces, the root `package.json`, `bun.lock`, script execution, tests, builds, and repository-scoped one-shot tools.

Pin and workspace contract:

- `.bun-version` records `1.3.14`.
- Root `package.json` sets `packageManager: bun@1.3.14` and `engines.bun: 1.3.14`, `private: true`, workspace version `0.0.0`.
- Workspaces declare active mainline package globs: `sdk/*` and `examples/*` (unmatched globs are accepted by Bun 1.3.14). Bun 1.3.14 rejects an unmatched exact workspace entry `studio`; U0 adds the exact `"studio"` workspace when `studio/package.json` lands.
- Private package `@moonspan/sdk` lives at `sdk/typescript` (version `0.0.0`, ESM). Package root `exports["."]` points at `src/index.ts` with an empty public surface. R2WP protocol modules under `src/protocol/` (`cbor`, `bootstrap`, `extension`, `control`, `frame`) stay browser-internal until M1 owns public SDK exports.
- SDK `check`/`build` compile `src/index.ts` and the internal protocol modules as browser entrypoints into `dist/`; package root exports `src/index.ts`. Focused package tests: `bun run --filter @moonspan/sdk test:cbor`, `test:bootstrap`, `test:extension`, `test:control`, and `test:frame`.
- `bunfig.toml` sets the install linker to `isolated`.
- With `@moonspan/sdk` present, Bun materializes root `bun.lock` as workspace-identity only. The repository commits that lockfile. `bun install --frozen-lockfile` is the clean-checkout install path.
- Official sources: [Bun v1.3.14 release](https://bun.com/blog/bun-v1.3.14), [installation](https://bun.com/docs/installation), [workspaces](https://bun.com/docs/install/workspaces), [install / linker](https://bun.com/docs/install).

SDK unit, package-contract, and protocol codec tests run through Bun. Playwright covers browser behavior, Worker integration, transport sessions, and later prototype accessibility when those phases begin. `bunx` runs tools such as the DESIGN.md linter.

### Rust gateway workspace

`rclwebd` is the Cargo workspace member at repository root (`Cargo.toml` virtual workspace, resolver 3). Shared package metadata: version `0.0.0`, edition 2024, `rust-version` 1.97.1. `rust-toolchain.toml` pins channel `1.97.1` with the minimal profile plus `rustfmt` and `clippy`. The crate stays private (`publish = false`) and forbids `unsafe`. License metadata awaits the D-06 human ruling. The `rclwebd` normal tree is std only. The `serde_json` dev dependency serves fixture tests under `rclwebd/src/protocol/tests.rs`. R2WP protocol modules live at [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) (`error`, `cbor`, `bootstrap`, `extension`, `control`, `frame`). `Cargo.lock` is committed.

### MoonBit runtime workspace

`rclmbt` is the `moon.work` member using current `moon.mod` / `moon.pkg` DSL formats (JSON manifests deprecated from MoonBit 0.10.4 onward). Module version `0.0.0`, `preferred_target` / `supported_targets` wasm, no license field, no external mooncakes. The repository pin is the full reproducible compiler build **`0.10.6+80dc50f24`** in `.moon-version` (install via the official installer with that exact argument, optionally isolating with `MOON_HOME`). That full build ID installs successfully. A probe of the short ID `0.10.4` returned HTTP 403 on the current CDN; the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) remain historical language context. R2WP protocol modules live at [`rclmbt/protocol/`](../../rclmbt/protocol/) (`error`, `cbor`, `bootstrap`, `extension`, `control`, `frame`, plus the white-box fixture bridge). Focused package tests: `moon test --frozen --target wasm rclmbt/protocol` (69 of 69 after M0-03g review Accept).

### ROS platform

First-stage ROS platforms are Humble Hawksbill and Jazzy Jalisco. Fast DDS (`rmw_fastrtps_cpp`) is the reference and default row on each distro; Cyclone DDS (`rmw_cyclonedds_cpp`) is the second qualification row. Humble uses the `moonspan-schema-v1` recursive deployment-bundle identity; Jazzy uses `rep2011-rihs` with native `GetTypeDescription`. Kilted, Lyrical, Rolling, `rmw_zenoh`, and Zenoh router topologies are later expansion candidates.

Exact image digests, CPU variants, browser pins, and row status live in the [reference support profile](../../docs/support-matrix.md). [Compatibility](../../docs/compatibility.md) owns strategy and tier language. [ADR 0007](../../docs/adr/0007-humble-jazzy-schema-identity.md) owns schema identity.

### Repository and evidence tooling

- **just 1.50.0** (`.just-version`) provides root `toolchain-check`, `protocol-check`, aggregate `protocol-fixtures-check` / `protocol-fixtures-write`, standalone malformed/sequence/parity recipes, `protocol-agree` / `protocol-agree-write`, `check`, `test`, and `build`. Studio workspace enrollment begins at U0, so those recipes cover currently enrolled mainline workspaces.
- **`scripts/toolchain-check.ts`** reads project pins and verifies exact installed `bun`, `rustc`, `cargo`, `moon` (bundle via `moon version --all`), `moonc`, and `just` identities, plus pin consistency across `.bun-version`/`package.json` and `rust-toolchain.toml`/`Cargo.toml`. The root `justfile` and the foundation CI workflow both invoke this checker. Hosted run evidence remains pending until a reviewed run records artifact URLs. `.moon-version` and `.just-version` are Moonspan contracts consumed by those entrypoints.
- **`scripts/protocol-check.ts`** validates the frozen R2WP v0 registry and control CDDL. Root entrypoints: `bun run protocol-check`, `just protocol-check`, and focused `bun run test:protocol`.
- **`scripts/protocol-fixtures.ts`** aggregates write/check for four corpora under `protocol/testdata/` in order `valid_boundary → malformed → sequences → parity` once each. Standalone scripts own malformed (`protocol-malformed-fixtures.ts`), sequences (`protocol-sequence-fixtures.ts`), and parity (`protocol-parity-fixtures.ts`). Root entrypoints: `bun run protocol-fixtures:check` / `protocol-fixtures:write`, matching `just` recipes, and focused `bun run test:protocol-fixtures` (four files once each).
- **`scripts/protocol-moonbit-fixtures.ts`** regenerates and checks the MoonBit white-box fixture bridge at `rclmbt/protocol/fixture_data_wbtest.mbt`. Root entrypoints: `bun run protocol-moonbit-fixtures:check` / `protocol-moonbit-fixtures:write` and focused `bun run test:protocol-moonbit-fixtures`; root `bun run check` runs the bridge check after aggregate `protocol-fixtures:check`.
- **`scripts/protocol-agree-run.ts`** orchestrates three-language agreement (TypeScript expected projection, Rust emitter, MoonBit emitter) and writes/checks [protocol/testdata/agreement/report.json](../../protocol/testdata/agreement/report.json). Root entrypoints: `bun run protocol-agree` / `protocol-agree:write`, `just protocol-agree` / `protocol-agree-write`, and focused `bun run test:protocol-agree`. Root `bun run check` runs `protocol-agree:check` exactly once after `protocol-moonbit-fixtures:check`.
- Root `bun run check` runs `docs:check`, then `protocol-check`, then aggregate `protocol-fixtures:check`, then `protocol-moonbit-fixtures:check`, then `protocol-agree:check`.
- Cargo builds and tests the Rust workspace (`cargo fmt`, locked `clippy -D warnings`, locked `test`, locked `build`). Focused R2WP crate tests: `cargo test --locked -p rclwebd` (56 passed across 3 suites after M0-03h).
- MoonBit tooling checks, tests, and builds Wasm with `--frozen` (`moon check --deny-warn --target wasm --fmt`, `moon test --target wasm`, `moon build --target wasm`). Focused R2WP package tests use `moon test --frozen --target wasm rclmbt/protocol`. Generated `_build/` stays gitignored.
- Bun manages TypeScript workspaces and scripts; root `bun run check` is docs static check, protocol contract check, aggregate fixture check, MoonBit fixture bridge check, then three-language agreement check; `bun run toolchain-check` is the installed-tool probe; `bun.lock` is tracked.
- Versioned fixtures and machine-readable artifacts travel with the repository.
- **Foundation CI** (`.github/workflows/ci.yml`) is the M0 tooling evidence lane on `ubuntu-24.04`. It pins Actions by full commit SHA (`actions/checkout` v7, `actions/cache` v6, `actions/upload-artifact` v7, `oven-sh/setup-bun` v2.2.0), installs Bun/Rust/MoonBit/just from project pins (official MoonBit installer SHA256-verified before execution; just linux musl SHA256-verified into `RUNNER_TEMP/moonspan-bin`), caches dependency material only (`~/.bun/install/cache`, Cargo registry index/cache and git db, `.mooncakes/`) with OS/arch + pin + lockfile keys, initializes `artifacts/ci/` placeholders after checkout, runs frozen/locked `just toolchain-check` / `check` / `test` / `build` with tee logs, and uploads available documentation and test-build evidence through `if: always()` after a successful checkout (14-day retention). Current evidence is local actionlint plus pinned root commands; the first hosted run will record artifact URLs. The foundation lane is separate from later Humble/Jazzy ROS container qualification workflows and from U0 Studio.

## Post-mainline prototype stack

The common Studio prototype uses TypeScript, React, Vite, Workers, OffscreenCanvas, WebGPU with a WebGL2 compatibility tier, and WebCodecs. It consumes the released SDK and begins after the M3 mainline release gate. [Prototype scope](../../docs/prototypes/studio-ui.md) and [DESIGN.md](./DESIGN.md) own the UI choices.

React and Vite receive a U0 entry review against the released SDK and prototype goals. Their accepted rationale belongs in a prototype ADR.

## Decision lifecycle

- Bun is a human-selected stack constraint.
- Remaining kickoff choices route through the [kickoff decision register](../../tasks/plan.md#13-kickoff-decision-register) with accountable role, required evidence, decision deadline, and current state.
- Mainline architecture bets gain authority through M0 ADR review and the evidence gates in [validation](../../docs/validation.md).
- Prototype technology choices gain authority at U0 entry and through prototype qualification.
- Findings outside accepted envelopes reopen the affected choice through an ADR update and new evidence.
