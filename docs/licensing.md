# Licensing

The repository is licensed under the [Apache License, Version 2.0](../LICENSE).
Copyright 2026 Alex. See [NOTICE](../NOTICE).

This is the license closure: license text, notice, dependency inventory,
and third-party compliance policy.
The copyright line uses the repository owner's git display name. Correct
[NOTICE](../NOTICE) if a different legal name should appear.

## Third-party policy

Dependencies on the **published surface** must be OSI-permissive. Allowed
SPDX identifiers are the allowlist in
[`scripts/license-inventory.ts`](../scripts/license-inventory.ts)
(`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, and the other
permissive identifiers listed there). Dual-licensed crates are allowed when
at least one alternative is on that list. `AND` expressions are allowed only
when every conjunct is.

The published surface is:

- the `rclweb` crate (native and `wasm32-unknown-unknown`)
- the `rclwebd` binary, including optional `ros` and `webtransport`
- the TypeScript package `rcl-web` at `typescript/` (no runtime npm dependencies; tsdown + TypeScript are ship-bundle `devDependencies`)

Do not add GPL, AGPL, LGPL, or other copyleft licenses to that graph. The
same allowlist applies to workspace `dev-dependency` crates so a test-only
copyleft crate cannot leak into a later release.

## Inventory

[`docs/third-party.md`](./third-party.md) is generated from `Cargo.lock` and
the Bun workspace manifests. Declared npm packages are read from the
declaring workspace `node_modules/` first, then the root hoist:

```bash
just license-inventory
just license-inventory-check
```

`just check` runs the check. Do not hand-edit the inventory.

Outside this inventory (they are not crate/npm release units):

- ROS distro libraries loaded from `ROS_PREFIX` at runtime (typically Apache-2.0)
- Docker base images and OS packages in the runtime images
- optional local pixi / RoboStack prefixes
- `fuzz/` (cargo-fuzz; `libfuzzer-sys` is Apache-2.0 WITH LLVM-exception; not shipped)

## Manifests and publish

Workspace Cargo members inherit `license = "Apache-2.0"`. Bun workspace
packages declare `"license": "Apache-2.0"`.

The current TypeScript package is `rcl-web@0.0.5` (`"private": false`).
`0.0.1` on npm shipped TypeScript source.
An npm tarball must include the repository `LICENSE` and `NOTICE`.
`just npm-pack` / the package `prepack` script copies those files into
`typescript/` (gitignored). `just npm-pack-check` is part of `just check`.
Unscoped `rclweb` is blocked on npm as too similar to `rrweb`; the
publish name is `rcl-web` ([ADR 0014](./adr/0014-typescript-package-rcl-web.md)).
Publish is GitHub OIDC from
[`.github/workflows/release.yml`](../.github/workflows/release.yml)
([release](./release.md), [ADR 0016](./adr/0016-oidc-trusted-publish.md)).
`rclweb` and `rclwebd` publish to crates.io. Fixture crates stay
`publish = false`.

Per-file SPDX headers are not required. The root `LICENSE` / `NOTICE` and
the manifest fields are the project convention.

## Contributions

Contributions submitted for inclusion are licensed under Apache License 2.0
unless the contributor states otherwise in writing (Apache License §5).
See [CONTRIBUTING.md](../CONTRIBUTING.md).
