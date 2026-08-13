# 0013: TypeScript package is `rclweb` at `typescript/`

## Status

Accepted

## Date

2026-08-13

## Context

ADR 0010 named the browser package `@rclweb/sdk` and ADR 0003 enrolled it at
`sdk/typescript/`. The scoped name and the `sdk` directory read as a separate
product from the project. Applications already treat this package as rclweb:
`init` / `Node` around the wasm core. The Rust crate already occupies
`rclweb/`; the TypeScript package cannot share that directory.

## Decision

- The Bun workspace package is unscoped `rclweb`, imported as `rclweb` and
  `rclweb/internal`.
- It lives at `typescript/` (language workspace). There is no `sdk/` tree.
- The application contract is [`docs/typescript.md`](../typescript.md).
- The repository root Bun package is `rclweb-workspace` so it does not collide
  with the publishable `rclweb` name.
- This supersedes the `@rclweb/sdk` / `sdk/typescript/` naming in
  [ADR 0010](./0010-restructure-single-rust-core.md) and
  [ADR 0003](./0003-monorepo-ownership.md). The single Rust core, the poll
  host boundary, and per-language workspace ownership stand.

## Rationale

Owner ruling (2026-08-13): call the package `rclweb`; do not publish it as
`@rclweb/sdk`; do not keep it under `sdk/`.

## Consequences

- Examples and scripts depended on `"rclweb": "workspace:*"` until
  [ADR 0014](./0014-typescript-package-rcl-web.md) (`"rcl-web": "workspace:*"`).
- `just build` stages `typescript/wasm/rclweb.wasm` and `typescript/dist/`.
- Historical task IDs that contain `sdk` are not the package name.
- The first published version is `0.0.1`. The package is public. An npm
  tarball must include the repository `LICENSE` and `NOTICE` (copied into
  `typescript/` at pack time). The repository is Apache-2.0. Rust crates
  stay `publish = false`. A human still runs `npm publish`.
- **Revisit trigger fired (2026-08-13):** npm rejects unscoped `rclweb` as
  too similar to existing package `rrweb` (403). The exact name is
  unpublished. Evidence: owner `npm publish` from `typescript/` after
  login; `GET https://registry.npmjs.org/rclweb` is 404. The publish and
  import name is now `rcl-web` ([ADR 0014](./0014-typescript-package-rcl-web.md)).

## Revisit triggers

- The unscoped `rclweb` name is unavailable on the chosen registry. **Fired:** npm 403 vs `rrweb`.
- A language-workspace split requires the TypeScript package to leave this
  repository (ADR 0003 revisit).

## Source

Owner direction 2026-08-13.
