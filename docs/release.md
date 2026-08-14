# Release

`rcl-web` publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC). `rclweb` / `rclwebd` publish to crates.io. The six `rclwebd`
runtime images publish to GHCR and prebuilt gateway binaries attach to
the GitHub Release ([ADR 0018](./adr/0018-prebuilt-gateway-distribution.md)).
There is no `NPM_TOKEN` or `CARGO_REGISTRY_TOKEN` in GitHub secrets
after the crates.io bootstrap below; images and binaries use the
workflow `GITHUB_TOKEN` (`packages: write` / `contents: write` on those
jobs only).

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
git tag v0.0.5
git push origin v0.0.5
```

or run **Actions → release → Run workflow** (`npm` / `crates` / `images`
/ `binaries` checkboxes; dispatched image and binary jobs resolve the
version from `Cargo.toml`, and the binary upload requires the matching
`v<version>` tag to exist).

The npm job builds with Bun, then publishes with the official npm CLI
(`npm publish` from `typescript/`). The CLI detects the GitHub OIDC
token; provenance is automatic — do not pass `--provenance`. Do not set
`NODE_AUTH_TOKEN`. The job refuses a version already on the registry.
The crates job stages `LICENSE` / `NOTICE`, publishes `rclweb`, then
retries `rclwebd` until crates.io's index sees the new core crate.

The images job builds the six row images from the committed Dockerfiles
per architecture (amd64 and arm64, each on a native runner) and pushes
`ghcr.io/alexzhang1030/rclwebd:<version>-<row>-<arch>`; the manifests
job then combines them into the user-facing multi-arch tags (table in
[deploy](./deploy.md#prebuilt-artifacts)). The binaries job builds
`rclwebd-<version>-{jazzy,humble}-{amd64,arm64}` (+ `.sha256`) with
`docker build --target builder` and uploads them to the release for the
tag, creating the release with generated notes when it does not exist
yet — so the GitHub Release page is no longer a separate human step,
though editing its notes still is. `scripts/install-rclwebd.sh` is the
consumer of those assets.

This cut: `0.0.5` everywhere — npm and crate versions align from
`v0.0.5` on so the tag-named images and binaries
([ADR 0018](./adr/0018-prebuilt-gateway-distribution.md)) match the
crate version; independent versioning (ADR 0003) still stands as
policy. Earlier cuts: `rcl-web@0.0.4` with crates `0.0.3`. First OIDC
automatic publish landed 2026-08-13 from tag `v0.0.3` on `e8365a8`
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
