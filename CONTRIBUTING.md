# Contributing to rclweb

The root command surface is `just`. After cloning:

```bash
just setup
just check
just test
just build
```

`just check` is the foundation gate (docs, protocol, corpus, license inventory, npm pack members, `cargo fmt`, Clippy with `-D warnings`, TypeScript package typecheck). Do not treat a rust-only loop as a substitute.

## Rust workspace

The compiler pin is `rust-toolchain.toml` (**1.97.1** plus `wasm32-unknown-unknown`). Workspace crates inherit `edition`, `rust-version`, and `license` from the root `Cargo.toml`.

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

Read the [PCR map](.agents/docs/README.md) before changing an enrolled area. Update the authoritative document with the code. Durable decisions live under [`docs/adr/`](docs/adr/README.md). The TypeScript application contract is [`docs/typescript.md`](docs/typescript.md).

## License

The repository is Apache License 2.0 ([LICENSE](./LICENSE), [NOTICE](./NOTICE),
[licensing](./docs/licensing.md)). Contributions submitted for inclusion are
under that license unless you state otherwise in writing.

Third-party crates and npm packages on the published surface must stay
OSI-permissive. After changing Cargo or Bun dependencies, run
`just license-inventory` and keep `just license-inventory-check` green.

The first published TypeScript package is `rclweb@0.0.1`. Publish is a
human step from `typescript/` after `just build` (`npm publish`). Do not
commit the staged `typescript/LICENSE` / `typescript/NOTICE` copies.
