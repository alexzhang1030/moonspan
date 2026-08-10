# 0002: Use Bun for JavaScript tooling

## Status

Accepted

## Date

2026-08-10

## Context

The browser SDK, Worker host, conformance clients, and later Studio prototype need one JavaScript package, workspace, lockfile, script, test, and build command surface.

## Decision

Use Bun for JavaScript dependency installation, workspaces, `bun.lock`, scripts, tests, builds, and repository-scoped one-shot tools. Pin the project Bun version during M0-02.

## Rationale

The human owner selected Bun as a stack constraint. Bun supports root `package.json` workspaces and a repository lockfile. Further owner rationale remains open.

## Consequences

- Root JavaScript commands use `bun` and `bunx`.
- The repository commits `bun.lock` and reviews its changes with dependency updates.
- Vitest, Playwright, Vite, and other JavaScript tools execute through Bun scripts when their phases begin.
- Clean-checkout and CI evidence use the pinned Bun version.

## Revisit triggers

- A required SDK, Worker, test, build, or publishing workflow fails under the pinned Bun version.
- Reproducibility, lockfile, platform, security, or performance evidence falls outside an accepted gate.
- The human owner selects a different JavaScript toolchain.

## Source

Human stack selection recorded in the project conversation on 2026-08-10 and distilled into [technology stack rationale](../../.agents/docs/technology-stack.md).
