# Release

`rcl-web` publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC). `rclweb` / `rclwebd` publish to crates.io. There is no `NPM_TOKEN`
or `CARGO_REGISTRY_TOKEN` in GitHub secrets after the crates.io bootstrap
below.

npm's trusted-publisher identity is the workflow **filename**
`release.yml` (not the path). Do not put a GitHub `environment:` on the
npm job, and leave **Environment** blank on npmjs.com. Do not rename
`release.yml` without updating npm and crates.io.

## One-time setup (human)

`rcl-web` already exists on npm, so the trusted publisher can be saved
as soon as this workflow is on the default branch.

1. On [npmjs.com/package/rcl-web](https://www.npmjs.com/package/rcl-web)
   → **Settings → Trusted Publisher** → GitHub Actions:
   - Organization or user: `alexzhang1030`
   - Repository: `rclweb`
   - Workflow filename: `release.yml` (filename only)
   - Environment: *leave blank*
   - Allowed action: `npm publish`
2. Or from a logged-in npm CLI (2FA):

   ```bash
   npm trust github rcl-web --file release.yml --repo alexzhang1030/rclweb --allow-publish
   ```

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
   - Environment: *leave blank*

## Publish a version

Bump the version in the tree (`typescript/package.json` and/or
`[workspace.package].version` plus the `rclweb` workspace dep version),
merge to `main`, then either:

```bash
git tag v0.0.3
git push origin v0.0.3
```

or run **Actions → release → Run workflow** (`npm` / `crates` checkboxes).

The npm job builds with Bun, then publishes with the official npm CLI
(`npm publish` from `typescript/`). The CLI detects the GitHub OIDC
token; provenance is automatic — do not pass `--provenance`. Do not set
`NODE_AUTH_TOKEN`. The job refuses a version already on the registry.
The crates job stages `LICENSE` / `NOTICE`, publishes `rclweb`, then
retries `rclwebd` until crates.io's index sees the new core crate.

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
