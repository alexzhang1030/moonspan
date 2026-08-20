# Contributing to rclweb

Customer docs (install, `Node`, topics, services, actions) live in
[`docs/typescript.md`](docs/typescript.md) and
[`docs/api.md`](docs/api.md). This page is the repository command
surface.

After cloning:

```bash
just setup
just check
just test
just build
```

`just check` is the foundation gate (docs, protocol, corpus, license
inventory, npm/crate pack members, `cargo fmt`, Clippy with `-D warnings`,
tsdown ship bundle).

| Command | Purpose |
|---|---|
| `just setup` | Frozen Bun install + `just doctor` |
| `just toolchain-check` | Verify pinned bun / rustc / just |
| `just doctor` | Pins plus rustc/rustfmt/clippy identity |
| `just fmt` / `just fmt-check` / `just clippy` / `just lint-rust` | Rust format and Clippy |
| `just check` | Full foundation gate |
| `just test` | Bun and Cargo tests |
| `just build` | Native build, fat-LTO wasm, tsdown bundle |
| `just npm-pack` / `just npm-pack-check` | npm tarball for `rcl-web` |
| `just cargo-publish` / `just cargo-publish-check` | crates.io pack for `rclweb` / `rclwebd` |
| `just e2e` / `just e2e-h-ft` | Live talker → gateway → `rcl-web` |
| `just gateway` / `just gateway-h-ft` | Packaged gateway on the host network |
| `just gateway-wt` / `just gateway-wt-h-ft` | Same + intranet WebTransport (`RCLWEBD_OFFER_WEBTRANSPORT=1`) |
| `just ros-check` / `just ros-check-docker` | Compile `rclwebd --features ros --tests` (no `cargo test`) |
| `just ros-test` / `just ros-test-pixi` | Gateway tests against real rcl |
| `just protocol-check` / `just cdr-corpus-check` | Registry, CDDL, CDR corpus |
| `just license-inventory` / `just license-inventory-check` | Third-party allowlist |

Pins: Bun `.bun-version`, Rust `rust-toolchain.toml` (1.97.1 +
`wasm32-unknown-unknown`), just `.just-version`.

## Rust workspace

Workspace crates inherit `edition`, `rust-version`, and `license` from
the root `Cargo.toml`.

| File | Role |
|---|---|
| `rustfmt.toml` | rustfmt 2024, max heuristics, 2-space indent |
| `clippy.toml` | line-count threshold 200; Clippy may suggest breaking changes |
| `[workspace.lints]` | `unsafe_code = "deny"`, rustc/clippy `all` denied |
| `[workspace.dependencies]` | shared crate versions; members use `*.workspace = true` |

Unsafe Rust is allowed only in the host poll ABI and the rcl FFI modules
(`#![allow(unsafe_code)]` there). Lint level is **deny**, not forbid.

```bash
just fmt
just lint-rust
just fix-rust
```

## Records

Read the [PCR map](.agents/docs/README.md) before changing an enrolled
area. The application API is [`docs/api.md`](docs/api.md); the how-to is
[`docs/typescript.md`](docs/typescript.md). Durable decisions live under
[`docs/adr/`](docs/adr/README.md).

## License

Apache-2.0 ([LICENSE](./LICENSE), [NOTICE](./NOTICE),
[licensing](./docs/licensing.md)). Third-party crates and npm packages
on the published surface must stay OSI-permissive. After changing Cargo
or Bun dependencies, run `just license-inventory`.

Do not commit staged `typescript/LICENSE` / `typescript/NOTICE`. Crate
`LICENSE` / `NOTICE` copies are committed and must match the root files.
Do not retry unscoped `rclweb` on npm (blocked as too similar to `rrweb`).
