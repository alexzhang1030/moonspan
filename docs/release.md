# Release

`rcl-web` publishes to npm, and `rclweb` / `rclwebd` publish to crates.io,
from [`.github/workflows/release.yml`](../.github/workflows/release.yml)
using GitHub OIDC trusted publishing ([ADR 0016](./adr/0016-oidc-trusted-publish.md)).
There is no `NPM_TOKEN` or `CARGO_REGISTRY_TOKEN` in GitHub secrets after
the crates.io bootstrap below.

Do not rename `release.yml` or the GitHub environment `release` without
updating both registries.

## One-time setup (human)

1. In the GitHub repo: **Settings → Environments → New environment → `release`**.
   No secrets. Optional: required reviewers.
2. On [npmjs.com](https://www.npmjs.com/package/rcl-web) → **Settings →
   Trusted Publisher**:
   - Organization or user: `alexzhang1030`
   - Repository: `rclweb`
   - Workflow filename: `release.yml` (filename only)
   - Environment: `release`
   - Allowed action: `npm publish`
3. First crates.io publish (OIDC cannot create a crate that does not exist):

   ```bash
   just build
   bun run scripts/cargo-publish.ts --stage
   cargo login
   cargo publish -p rclweb --locked
   cargo publish -p rclwebd --locked
   ```

4. On [crates.io](https://crates.io) → each of `rclweb` and `rclwebd` →
   **Settings → Trusted Publishing**:
   - Repository: `alexzhang1030/rclweb`
   - Workflow filename: `release.yml`
   - Environment: `release`

## Publish a version

Bump the version in the tree (`typescript/package.json` and/or
`[workspace.package].version` plus the `rclweb` workspace dep version),
merge to `main`, then either:

```bash
git tag v0.0.3
git push origin v0.0.3
```

or run **Actions → release → Run workflow** (`npm` / `crates` checkboxes).

The npm job runs `just build` then `npm publish --access public --provenance`
from `typescript/` with the official npm CLI (not Bun). It refuses a version
already on the registry. The crates job stages `LICENSE` / `NOTICE`, publishes
`rclweb`, then retries `rclwebd` until crates.io's index sees the new core
crate.

`rcl-web@0.0.2` is already on npm. The next npm publish needs a new
version. Crates start at `0.0.1`.

## Local checks

```bash
just npm-pack-check
just cargo-publish-check
```

`just check` runs both. Do not commit the staged `typescript/LICENSE` /
`typescript/NOTICE` copies. `rclweb/LICENSE`, `rclweb/NOTICE`,
`rclwebd/LICENSE`, and `rclwebd/NOTICE` are committed and must match the
root files (`just cargo-publish-check`).
