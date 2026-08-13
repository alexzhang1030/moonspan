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

- Examples and scripts depend on `"rclweb": "workspace:*"`.
- `just build` stages `typescript/wasm/rclweb.wasm` and `typescript/dist/`.
- Historical milestone filenames that contain `sdk` (R1-04, R4-04) stay; they
  are task IDs, not the package name.
- npm publish still waits on a human-chosen version. D-06 is Apache-2.0.

## Revisit triggers

- The unscoped `rclweb` name is unavailable on the chosen registry.
- A language-workspace split requires the TypeScript package to leave this
  repository (ADR 0003 revisit).

## Source

Owner direction 2026-08-13, updating ruling R-D4 in
[tasks/plan.md](../../tasks/plan.md).
