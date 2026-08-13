# 0016: Publish via OIDC trusted publishing; crates go to crates.io

## Status

Accepted

## Date

2026-08-13

## Context

`rcl-web` is on npm (`0.0.1` source, `0.0.2` tsdown). Publish was a human
`npm publish` with a logged-in token. Rust crates were `publish = false`.
The owner asked for npm OIDC publish of the TypeScript package, and for
the crates to be published as well.

npm and crates.io both accept GitHub Actions as a trusted publisher
([npm trusted publishers](https://docs.npmjs.com/trusted-publishers),
[crates.io trusted publishing](https://crates.io/docs/trusted-publishing)).
Neither uses a long-lived `NPM_TOKEN` / `CARGO_REGISTRY_TOKEN` in GitHub
secrets after bootstrap.

## Decision

- `rcl-web` publishes from [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
  with GitHub OIDC (`id-token: write`). No `NODE_AUTH_TOKEN`.
- `rclweb` and `rclwebd` publish to crates.io. Fixture crates
  (`protocol-fixtures`, `r1_04_fixture_gen`) and `fuzz/` stay
  `publish = false`.
- The workflow filename `release.yml` and the GitHub environment
  `release` are the trusted-publisher identity. Renaming either
  requires updating npm and crates.io.
- crates.io requires a one-time human `cargo publish` before OIDC can
  be configured. After that, the same workflow publishes both crates
  (`rclweb` first).
- This supersedes “a human runs `npm publish`” and “crates stay
  `publish = false`” in ADR 0013 / the 0.0.1 prep docs. Independent
  versioning (ADR 0003) stands: npm is `0.0.2`, crates start at `0.0.1`.

## Rationale

Owner ruling (2026-08-13): use npm OIDC to publish the package; crates
are also published.

## Consequences

- [docs/release.md](../release.md) is the runbook (npm trusted publisher,
  crates.io bootstrap, environment `release`).
- `just cargo-publish-check` is part of `just check`.
- `rclwebd` depends on `rclweb` with a path + version so the crates.io
  tarball can resolve the core crate.

## Revisit triggers

- npm or crates.io reject the OIDC publisher (filename, environment, or
  runner class).
- A required crate cannot ship because of path-only deps or ROS-link
  requirements.

## Source

Owner direction 2026-08-13 after `rcl-web@0.0.2` landed on npm.
