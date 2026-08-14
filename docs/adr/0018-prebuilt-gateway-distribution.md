# 0018: Prebuilt gateway distribution and support-row auto-detection

## Status

Proposed

## Date

2026-08-14

## Context

Getting a running `rclwebd` today is hard in three independent ways:

- `cargo install rclwebd --features ros` needs a Rust toolchain **and** a
  full ROS 2 prefix with rcl/rmw development libraries at link time, then
  compiles the whole gateway from source. Someone who only wants to point
  a browser at a robot pays a robotics-plus-Rust setup cost.
- The runtime images ([deploy](../deploy.md)) exist only as local builds
  (`just image-rclwebd`, `just gateway-row …`). No registry publishes
  them, so even the container path starts with cloning this repository.
- Runtime configuration requires manually pairing `RCLWEBD_SUPPORT_ROW`,
  the sourced prefix, and `RMW_IMPLEMENTATION`
  ([ADR 0008](./0008-one-adapter-row-per-gateway-process.md)). The
  default row is J-FT, so `rclwebd` under a sourced Humble environment
  fails the adapter probe unless the user already knows the six-row
  taxonomy. `rclwebd/src/main.rs` currently warns on a `ROS_DISTRO`
  mismatch but keeps the wrong default.

The owner asked for an easier install and usage path (2026-08-14).

## Decision

Staged delivery; each stage is independently shippable, in this order.

1. **Publish the runtime images to GHCR from `release.yml`.**
   Per released version, push the six row images built from the existing
   Dockerfiles as `ghcr.io/alexzhang1030/rclwebd:<version>-<row>`
   (row in `j-ft`, `j-cy`, `j-zn`, `h-ft`, `h-cy`, `h-zn`), plus rolling
   aliases `:jazzy` (J-FT), `:humble` (H-FT), and `:latest` (J-FT).
   Authentication is the workflow `GITHUB_TOKEN` with `packages: write` —
   no new long-lived secrets, consistent with the
   [ADR 0016](./0016-oidc-trusted-publish.md) direction. Start with
   `linux/amd64`; add `linux/arm64` on native arm runners
   (`ubuntu-24.04-arm`) because robot compute is commonly arm64. The
   quickstart becomes one line with zero repository access:

   ```bash
   docker run --rm --network host ghcr.io/alexzhang1030/rclwebd:jazzy
   ```

2. **Auto-detect the support row from the sourced environment.**
   When `RCLWEBD_SUPPORT_ROW` is unset, derive the row from `ROS_DISTRO`
   (`jazzy` / `humble`) plus `RMW_IMPLEMENTATION` (default
   `rmw_fastrtps_cpp`) instead of hard-defaulting to J-FT. An explicit
   `RCLWEBD_SUPPORT_ROW` still wins; an unknown combination fails
   startup naming the six rows. This changes only how the one row per
   process is chosen — [ADR 0008](./0008-one-adapter-row-per-gateway-process.md)
   stands, and the adapter probe remains the consistency authority.
   `source /opt/ros/humble/setup.bash && rclwebd` then does the right
   thing with zero configuration.

3. **Lead the docs with the zero-clone path.**
   Root `README.md` and [deploy](../deploy.md) open with the
   `docker run` one-liner per distro; `cargo install rclwebd --features
   ros` moves to a build-from-source section. Keep one copy-paste
   "gateway in one minute" block per distro.

4. **Prebuilt binaries on GitHub Releases with an install script.**
   Build `rclwebd-<version>-{jazzy,humble}-{amd64,arm64}` inside the
   same digest-pinned ROS builder stages the images use, so the glibc
   floor matches each distro's Ubuntu base (22.04 Humble, 24.04 Jazzy)
   and the Humble binaries get the regenerated bindings. Runtime still
   needs a matching sourced prefix — typesupport stays dlopen, which is
   the environment a ROS user already has. An `install.sh` detects
   `ROS_DISTRO` and architecture, downloads with retries
   ([gotcha](../../.agents/docs/gotchas.md#github-releases-downloads-need-retries)),
   and installs to `~/.local/bin`. This removes the Rust toolchain and
   the compile from host installs; `cargo install` remains for people
   who want to build.

**Evaluated and deferred:** a bloom / ROS buildfarm release
(`apt install ros-jazzy-rclwebd`). It is the most familiar channel for
ROS users, but it requires ament/colcon packaging of a Cargo workspace
and buildfarm acceptance — a large, externally gated effort. Revisit
after stages 1–4 land if users ask for apt.

## Rationale

- The GHCR images remove all three install obstacles at once (Rust
  toolchain, dev prefix, compile time) and reuse Dockerfiles the repo
  already maintains for e2e and deploy. Publishing is the smallest
  possible delta: a push job on artifacts CI already knows how to build.
- Row auto-detection removes the most common usage failure: a sourced
  environment that disagrees with the J-FT default. The code already
  detects the mismatch and warns; deriving the default turns the warning
  case into correct behavior without weakening the probe.
- Prebuilt binaries serve hosts where Docker (or host networking) is
  unavailable or unwanted — common on robot compute — at the cost of a
  release matrix. Building them inside the digest-pinned builder images
  keeps one build environment per distro instead of a new toolchain
  story.
- Ordering: images first because they help every audience and carry the
  least risk; auto-detection second because it is a small code change
  with the largest usage-error payoff; binaries last because they add a
  release matrix that images already cover for most users.

## Consequences

- `release.yml` grows an images job (and later a binaries job). Image
  names and tags become public contract; renames need the same care as
  crate names.
- Per-release CI time grows (six rows, later two architectures).
  Mitigate with a build matrix and registry layer caching; arm64 waits
  for native arm runners rather than QEMU-emulated cargo builds.
- Stage 2 changes default behavior: a sourced Humble environment that
  previously selected J-FT (and failed the probe) now selects H-FT and
  starts. That is the intended fix; no working configuration changes
  meaning.
- `README.md`, [deploy](../deploy.md), and
  [gateway/rclwebd](../gateway/rclwebd.md) change in the same reviews
  that land each stage.

## Revisit triggers

- GHCR is unreachable for target users (air-gapped robots) — raises the
  priority of the binaries and apt paths.
- Cargo-in-colcon packaging matures, or users ask for apt — reopens the
  deferred buildfarm release.
- A new support row or a distro EOL changes the tag matrix.

## Source

Owner request 2026-08-14 (task): "rclwebd 的安装方式和使用方式现在还是太难了。
考虑使用更好的方式" — installation and usage of `rclwebd` are still too
hard; propose a better way. This record is the proposal; it is not
accepted until the owner rules on it.
