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

npm trusted publishing is [documented](https://docs.npmjs.com/trusted-publishers):
the CLI detects a GitHub Actions OIDC environment and exchanges the ID
token. Provenance is automatic. A GitHub environment is optional and
must stay blank unless the job sets `environment:`. crates.io has its
own trusted-publishing flow
([docs](https://crates.io/docs/trusted-publishing)).

## Decision

- `rcl-web` publishes from [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
  with `id-token: write` and `npm publish`. No `NODE_AUTH_TOKEN`. No
  `--provenance`. No GitHub `environment:` on the npm job.
- npm's trusted-publisher identity is owner + repo + workflow filename
  `release.yml`. Environment on npmjs.com stays blank.
- `rclweb` and `rclwebd` publish to crates.io. Fixture crates
  (`protocol-fixtures`, `r1_04_fixture_gen`) and `fuzz/` stay
  `publish = false`.
- crates.io requires a one-time human `cargo publish` before OIDC can
  be configured. After that, the same workflow publishes both crates
  (`rclweb` first).
- This supersedes “a human runs `npm publish`” and “crates stay
  `publish = false`” in ADR 0013 / the 0.0.1 prep docs. Independent
  versioning (ADR 0003) stands: npm is `0.0.2`, crates start at `0.0.1`.

## Rationale

Owner ruling (2026-08-13): use npm OIDC to publish the package; crates
are also published. A first draft treated npm like a deploy environment
(`environment: release` + `--provenance`). That is not npm trusted
publishing. Official publish is `id-token: write` + `actions/setup-node@v6`
+ `npm publish`.

## Consequences

- [docs/release.md](../release.md) is the runbook (npm trusted publisher
  with blank environment, `npm trust github`, crates.io bootstrap).
- `just cargo-publish-check` is part of `just check`.
- `rclwebd` depends on `rclweb` with a path + version so the crates.io
  tarball can resolve the core crate.
- `actions/setup-node` `registry-url` writes `_authToken=${NODE_AUTH_TOKEN}`.
  An empty token line skips OIDC; the job deletes that line.

## Revisit triggers

- npm or crates.io reject the OIDC publisher (filename or runner class).
- A required crate cannot ship because of path-only deps or ROS-link
  requirements.

## Source

Owner direction 2026-08-13 after `rcl-web@0.0.2` landed on npm. Owner
correction the same day: npm OIDC is the trusted-publisher flow, not a
GitHub environment plus `--provenance`.
