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

3. First crates.io publish (OIDC cannot create a crate that does not exist).
   If cargo says `crates-io is replaced with remote registry`, pass
   `--registry crates-io` (a local `[source.crates-io] replace-with`
   mirror). `rclwebd` cannot pack until the **sparse index** lists
   `rclweb` — cargo's “waiting for … to be available” after the first
   upload is not enough.

   ```bash
   just build
   bun run scripts/cargo-publish.ts --stage
   cargo login --registry crates-io
   cargo publish -p rclweb --locked --registry crates-io
   until curl -fsS https://index.crates.io/rc/lw/rclweb | grep -q '"vers":"0.0.1"'; do sleep 10; done
   cargo publish -p rclwebd --locked --registry crates-io
   ```

   If `rclwebd` still says `no matching package named rclweb`, the
   replace-with mirror does not have the new crate yet. Comment out
   `[source.crates-io] replace-with` in `~/.cargo/config.toml` for that
   one command, then put it back.

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
git tag v0.0.4
git push origin v0.0.4
```

or run **Actions → release → Run workflow** (`npm` / `crates` checkboxes).

The npm job builds with Bun, then publishes with the official npm CLI
(`npm publish` from `typescript/`). The CLI detects the GitHub OIDC
token; provenance is automatic — do not pass `--provenance`. Do not set
`NODE_AUTH_TOKEN`. The job refuses a version already on the registry.
The crates job stages `LICENSE` / `NOTICE`, publishes `rclweb`, then
retries `rclwebd` until crates.io's index sees the new core crate.

This cut: `rcl-web@0.0.4` and crates `0.0.3`. First OIDC automatic
publish landed 2026-08-13 from tag `v0.0.3` on `e8365a8`
([release run](https://github.com/alexzhang1030/rclweb/actions/runs/31713576156)).
The GitHub Release is a separate step from the tag
([v0.0.4](https://github.com/alexzhang1030/rclweb/releases/tag/v0.0.4);
first page was [v0.0.3](https://github.com/alexzhang1030/rclweb/releases/tag/v0.0.3)).
Do not retag a version already on the registry.

## Local checks

```bash
just npm-pack-check
just cargo-publish-check
```

`just check` runs both. Do not commit the staged `typescript/LICENSE` /
`typescript/NOTICE` copies. `rclweb/LICENSE`, `rclweb/NOTICE`,
`rclwebd/LICENSE`, and `rclwebd/NOTICE` are committed and must match the
root files (`just cargo-publish-check`).
