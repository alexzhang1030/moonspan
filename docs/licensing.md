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
- the TypeScript package `rclweb` at `typescript/` (no external npm dependencies)

Do not add GPL, AGPL, LGPL, or other copyleft licenses to that graph. The
same allowlist applies to workspace `dev-dependency` crates so a test-only
copyleft crate cannot leak into a later release.

## Inventory

[`docs/third-party.md`](./third-party.md) is generated from `Cargo.lock` and
the Bun workspace manifests:

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

The first published TypeScript package is `rclweb@0.0.1` (`"private": false`).
An npm tarball must include the repository `LICENSE` and `NOTICE`.
`just npm-pack` / the package `prepack` script copies those files into
`typescript/` (gitignored). `just npm-pack-check` is part of `just check`.
A human still runs `npm publish` from `typescript/`. Rust crates stay
`publish = false` (not crates.io).

Per-file SPDX headers are not required. The root `LICENSE` / `NOTICE` and
the manifest fields are the project convention.

## Contributions

Contributions submitted for inclusion are licensed under Apache License 2.0
unless the contributor states otherwise in writing (Apache License §5).
See [CONTRIBUTING.md](../CONTRIBUTING.md).
