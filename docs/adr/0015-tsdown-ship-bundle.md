# 0015: TypeScript npm ship bundle is tsdown

## Status

Accepted

## Date

2026-08-13

## Context

[ADR 0002](./0002-use-bun-for-javascript-tooling.md) uses Bun for JavaScript
workspaces, lockfile, scripts, tests, and builds. The first npm pack of
`rcl-web@0.0.1` shipped TypeScript source (`exports` → `src/index.ts`,
`files` included `src/`). The owner rejected that: the published package
must be a bundle, and the bundler is tsdown.

## Decision

- The npm tarball for `rcl-web` is the tsdown ESM + `.d.ts` output under
  `typescript/dist/`, plus `wasm/rclweb.wasm`, `LICENSE`, and `NOTICE`.
- It must not include `src/`.
- Entries are `index`, `internal`, and `worker/io-worker`.
- Bun remains the workspace, lockfile, script, and test runner.
  `just build` / `prepack` invoke tsdown through Bun (`bun --bun tsdown`).
- This supersedes “Bun is the ship bundler” inside ADR 0002. Workspaces,
  `bun.lock`, scripts, and tests stand.

## Rationale

Owner ruling (2026-08-13): do not publish TypeScript source; use tsdown
as the bundler.

## Consequences

- `typescript/package.json` `exports` point at `dist/`.
- `just npm-pack-check` requires the dist ship set and fails if the
  tarball contains `package/src/`.
- tsdown and TypeScript are workspace `devDependencies` (OSI-permissive).
  They are not runtime dependencies of the published package.
- Live e2e/perf images run tsdown after staging wasm so
  `import from "rcl-web"` resolves to `dist/`.
- The tsdown ship is `rcl-web@0.0.2`. `0.0.1` is already on the registry
  as TypeScript source and cannot be overwritten.

## Revisit triggers

- tsdown cannot emit a working Worker + wasm URL layout.
- A required consumer (browser, Bun, Node) cannot load the dist graph.

## Source

Owner direction 2026-08-13 after the first `rcl-web` pack shipped `.ts`.
