# Contributing to rclweb

The root command surface is `just`. After cloning:

```bash
just setup
just check
just test
just build
```

`just check` is the foundation gate (docs, protocol, corpus, `cargo fmt`, Clippy with `-D warnings`, SDK typecheck). Do not treat a rust-only loop as a substitute.

## Rust workspace

The compiler pin is `rust-toolchain.toml` (**1.97.1** plus `wasm32-unknown-unknown`). Workspace crates inherit `edition` and `rust-version` from the root `Cargo.toml`.

| File | Role |
|---|---|
| `rustfmt.toml` | rustfmt 2024, max heuristics, 2-space indent |
| `clippy.toml` | line-count threshold 200; Clippy may suggest breaking changes |
| `[workspace.lints]` | `unsafe_code = "deny"`, rustc/clippy `all` denied |
| `[workspace.dependencies]` | shared crate versions; members use `*.workspace = true` |

Unsafe Rust is allowed only in the host poll ABI and the rcl FFI modules (`#![allow(unsafe_code)]` there). Workspace lint level is **deny**, not forbid: forbid cannot be overridden in those modules.

Clippy `pedantic` / `nursery` / restriction groups (unwrap, panic, indexing, print_*) stay off until a dedicated pass. Do not add a lint exception without a narrow reason.

Format and lint without the rest of the gate:

```bash
just fmt
just lint-rust
just fix-rust
```

## Records

Read the [PCR map](.agents/docs/README.md) before changing an enrolled area. Update the authoritative document with the code. Durable decisions live under [`docs/adr/`](docs/adr/README.md). The browser SDK application contract is [`docs/sdk.md`](docs/sdk.md).
