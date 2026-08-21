# rclweb root command surface (just 1.50.0).
# Fail-fast recipes run from the repository root.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

root := justfile_directory()

_default:
    @just --list

# Prepare a fresh checkout after `just` itself is installed.
[group('meta')]
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun install --frozen-lockfile
    rustup component add rustfmt clippy
    just doctor

# Verify pinned bun, rustc, and just versions.
[group('meta')]
toolchain-check:
    cd "{{root}}" && bun run scripts/toolchain-check.ts

# Print toolchain identity (pins plus rustfmt/clippy).
[group('meta')]
doctor: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    rustc --version --verbose
    cargo --version
    cargo fmt --version
    cargo clippy --version
    just --version
    bun --version

# Format all Rust sources.
[group('quality')]
fmt:
    cd "{{root}}" && cargo fmt --all

# Verify Rust formatting without changing files.
[group('quality')]
fmt-check:
    cd "{{root}}" && cargo fmt --all --check

# Clippy with the workspace lint policy and no warnings.
[group('quality')]
clippy:
    cd "{{root}}" && cargo clippy --locked --workspace --all-targets -- -D warnings

# Clippy the WebTransport accept loop (off in the default workspace clippy).
[group('quality')]
clippy-webtransport:
    cd "{{root}}" && cargo clippy --locked -p rclwebd --features webtransport --all-targets -- -D warnings

# Rust-only fmt + clippy. The full gate remains `just check`.
[group('quality')]
lint-rust: fmt-check clippy

# Apply rustfmt and Clippy's safe fixes to the working tree.
[group('quality')]
fix-rust:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    cargo fmt --all
    cargo clippy --fix --locked --workspace --all-targets --allow-dirty --allow-staged

# Validate R2WP v0 registry JSON and control CDDL.
[group('quality')]
protocol-check: toolchain-check
    cd "{{root}}" && bun run protocol-check

# Verify protocol fixtures materialize from manifest sources (R2-03).
[group('quality')]
protocol-fixtures-check: toolchain-check
    cd "{{root}}" && cargo run --locked -p protocol-fixtures -- --check

# Regenerate materializable protocol fixtures (malformed + valid bootstraps).
[group('quality')]
protocol-fixtures-write: toolchain-check
    cd "{{root}}" && cargo run --locked -p protocol-fixtures -- --write

# ROS CDR corpus check from committed artifacts.
[group('quality')]
cdr-corpus-check: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:check

# ROS CDR corpus regenerate against pinned ROS environments.
[group('quality')]
cdr-corpus-write: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:write

# Pinned ROS environment reproduce gate.
[group('quality')]
cdr-corpus-reproduce: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:reproduce

# CDR top-level tail-slack evidence check.
[group('quality')]
cdr-tail-slack-check: toolchain-check
    cd "{{root}}" && bun run cdr-tail-slack:check

# Regenerate CDR top-level tail-slack evidence.
[group('quality')]
cdr-tail-slack-write: toolchain-check
    cd "{{root}}" && bun run cdr-tail-slack:write

# Generated-types metadata check (M1-02b descriptors / identities / wire profiles).
[group('quality')]
generated-types-check: toolchain-check
    cd "{{root}}" && bun run generated-types:check

# Regenerate generated-types metadata under rclweb/generated/metadata/.
[group('quality')]
generated-types-write: toolchain-check
    cd "{{root}}" && bun run generated-types:write

# Regenerate docs/third-party.md from lockfiles (D-06).
[group('quality')]
license-inventory: toolchain-check
    cd "{{root}}" && bun run scripts/license-inventory.ts --write

# Verify the committed third-party inventory and license allowlist.
[group('quality')]
license-inventory-check: toolchain-check
    cd "{{root}}" && bun run scripts/license-inventory.ts --check

# Stage repository LICENSE/NOTICE into typescript/ and write the npm tarball.
[group('quality')]
npm-pack: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun run --filter rcl-web build
    bun run scripts/npm-pack.ts --stage
    bun pm pack --cwd typescript

# Verify the npm tarball is rcl-web@0.0.5 with the tsdown dist, LICENSE, NOTICE, and wasm.
[group('quality')]
npm-pack-check: toolchain-check
    cd "{{root}}" && bun run scripts/npm-pack.ts --check

# Stage LICENSE/NOTICE into rclweb/ and rclwebd/ for cargo publish.
[group('quality')]
cargo-publish: toolchain-check
    cd "{{root}}" && bun run scripts/cargo-publish.ts --stage

# Verify published crates pack with LICENSE/NOTICE; fixture crates stay private.
[group('quality')]
cargo-publish-check: toolchain-check
    cd "{{root}}" && bun run scripts/cargo-publish.ts --check

# Docs, protocol, corpus, and license inventory; npm/crate pack members; Rust fmt/clippy; tsdown ship bundle.
[group('quality')]
check: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun run check
    cargo run --locked -p protocol-fixtures -- --check
    bun run scripts/license-inventory.ts --check
    bun run scripts/npm-pack.ts --check
    bun run scripts/cargo-publish.ts --check
    just fmt-check
    just clippy
    just clippy-webtransport
    bun run --filter rcl-web check

# Bun tests (root scripts and TypeScript package) and Cargo workspace tests.
[group('quality')]
test: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun test
    cargo test --locked --workspace

# Gateway tests against real rcl (requires a sourced ROS 2 env matching the row).
# Default committed bindings target J-FT (`/opt/ros/jazzy`). For H-FT, use
# `just e2e-h-ft` (regenerates FFI against Humble inside the digest-pinned image)
# or `ROS_PREFIX=/opt/ros/humble bash scripts/generate-rcl-bindings.sh` then link.
# Local alternative without apt ROS or Docker: `just ros-test-pixi` (RoboStack).
[group('quality')]
ros-test: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if [ -z "${AMENT_PREFIX_PATH:-}" ]; then
        echo "error: source a ROS 2 environment first (e.g. /opt/ros/jazzy/setup.bash, /opt/ros/humble/setup.bash, or just ros-test-pixi)" >&2
        exit 1
    fi
    cargo test --locked -p rclwebd --features ros
    cargo clippy --locked -p rclwebd --features ros --all-targets -- -D warnings

# Compile rclwebd --features ros --tests (sourced Jazzy). Does not run tests.
# CI equivalent: `just ros-check-docker`.
[group('quality')]
ros-check: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if [ -z "${AMENT_PREFIX_PATH:-}" ]; then
        echo "error: source a ROS 2 environment first (e.g. /opt/ros/jazzy/setup.bash) or use just ros-check-docker" >&2
        exit 1
    fi
    cargo check --locked -p rclwebd --features ros --tests
    cargo clippy --locked -p rclwebd --features ros --all-targets -- -D warnings

# Compile-only ros-feature gate in the digest-pinned Jazzy image. Does not run cargo test.
[group('quality')]
ros-check-docker: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just ros-check-docker" >&2
        exit 1
    fi
    docker compose -f docker/compose.ros-feature-check.yml build

# Same as ros-test, using the optional RoboStack Jazzy prefix (pixi).
# Not a toolchain pin and not a substitute for digest-pinned Docker e2e evidence.
[group('quality')]
ros-test-pixi: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    export PATH="${HOME}/.pixi/bin:${PATH}"
    if ! command -v pixi >/dev/null 2>&1; then
        echo "error: pixi is required for just ros-test-pixi (https://pixi.sh)" >&2
        exit 1
    fi
    pixi install --locked
    pixi run just ros-test

# Cargo native build, rclweb wasm32 (fat LTO) staged into typescript/, and package build.
[group('quality')]
build: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    cargo build --locked --workspace
    bun run scripts/build-wasm.ts
    bun run --filter rcl-web build

# Measure wasm poll latency (R-D1). Prints to stdout; does not write into the repo.
[group('quality')]
poll-latency: toolchain-check
    cd "{{root}}" && bun run scripts/measure-poll-latency.ts

# R2-02 large-message path (both buffer strategies + encodeHostBatch). Prints to stdout.
[group('quality')]
large-message: toolchain-check
    cd "{{root}}" && bun run scripts/measure-large-message.ts

# R2-04 performance baseline (latency / CPU / mem primary; copy-path and wire secondary). Prints to stdout.
[group('quality')]
perf-baseline: toolchain-check
    cd "{{root}}" && bun run scripts/measure-perf-baseline.ts

# R2-04 live three-way bridge comparison (requires Docker + heavy image build).
[group('quality')]
perf-baseline-live: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just perf-baseline-live" >&2
        exit 1
    fi
    docker compose -f docker/compose.r2-04-perf.yml build
    docker compose -f docker/compose.r2-04-perf.yml run --rm perf

# Live ROS talker → rclwebd → SDK subscribe via docker compose (R1-05 / J-FT).
[group('quality')]
e2e: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just e2e" >&2
        exit 1
    fi
    docker compose -f docker/compose.r1-e2e.yml build
    docker compose -f docker/compose.r1-e2e.yml run --rm e2e

# Live Humble talker → H-FT rclwebd → SDK subscribe (R3-03).
[group('quality')]
e2e-h-ft: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just e2e-h-ft" >&2
        exit 1
    fi
    docker compose -f docker/compose.r3-03-h-ft-e2e.yml build
    docker compose -f docker/compose.r3-03-h-ft-e2e.yml run --rm e2e-h-ft

# Live remaining-row lane (R4-03): row is j-cy, j-zn, h-cy, or h-zn.
[group('quality')]
e2e-row row: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just e2e-row" >&2
        exit 1
    fi
    case "{{row}}" in
        j-cy|j-zn|h-cy|h-zn) ;;
        *) echo "error: unknown row '{{row}}' (expected j-cy, j-zn, h-cy, or h-zn)" >&2; exit 1 ;;
    esac
    docker compose -f docker/compose.r4-03-remaining-rows-e2e.yml build "e2e-{{row}}"
    docker compose -f docker/compose.r4-03-remaining-rows-e2e.yml run --rm "e2e-{{row}}"

# All four remaining-row live lanes (R4-03): J-CY, J-ZN, H-CY, H-ZN.
[group('quality')]
e2e-remaining-rows: (e2e-row "j-cy") (e2e-row "j-zn") (e2e-row "h-cy") (e2e-row "h-zn")

# J-FT runtime image for rclwebd (R4-02). Requires Docker; not a CI foundation job.
[group('quality')]
image-rclwebd: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just image-rclwebd" >&2
        exit 1
    fi
    docker build -f docker/Dockerfile.rclwebd -t rclwebd:j-ft .

# Run the packaged J-FT gateway (host network). Requires Docker.
[group('quality')]
gateway: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just gateway" >&2
        exit 1
    fi
    docker compose -f docker/compose.r4-02-gateway.yml up --build

# Packaged J-FT gateway with intranet WebTransport (host network). Rebuilds.
[group('quality')]
gateway-wt: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just gateway-wt" >&2
        exit 1
    fi
    docker compose -f docker/compose.r4-02-gateway.yml -f docker/compose.webtransport.yml up --build

# H-FT runtime image for rclwebd (R4-02). Regenerates FFI against Humble.
[group('quality')]
image-rclwebd-h-ft: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just image-rclwebd-h-ft" >&2
        exit 1
    fi
    docker build -f docker/Dockerfile.rclwebd-h-ft -t rclwebd:h-ft .

# Run the packaged H-FT gateway (host network). Requires Docker.
[group('quality')]
gateway-h-ft: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just gateway-h-ft" >&2
        exit 1
    fi
    docker compose -f docker/compose.r4-02-gateway-h-ft.yml up --build

# Packaged H-FT gateway with intranet WebTransport (host network). Rebuilds.
[group('quality')]
gateway-wt-h-ft: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just gateway-wt-h-ft" >&2
        exit 1
    fi
    docker compose -f docker/compose.r4-02-gateway-h-ft.yml -f docker/compose.webtransport.yml up --build

# Remaining-row runtime image (R4-02): row is j-cy, j-zn, h-cy, or h-zn.
[group('quality')]
image-rclwebd-row row: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just image-rclwebd-row" >&2
        exit 1
    fi
    case "{{row}}" in
        j-cy|j-zn|h-cy|h-zn) ;;
        *) echo "error: unknown row '{{row}}' (expected j-cy, j-zn, h-cy, or h-zn)" >&2; exit 1 ;;
    esac
    docker compose -f docker/compose.r4-02-gateway-rmw.yml build "rclwebd-{{row}}"

# Run a packaged remaining-row gateway (host network; zn rows start rmw_zenohd).
[group('quality')]
gateway-row row: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if ! command -v docker >/dev/null 2>&1; then
        echo "error: docker is required for just gateway-row" >&2
        exit 1
    fi
    case "{{row}}" in
        j-cy|j-zn|h-cy|h-zn) ;;
        *) echo "error: unknown row '{{row}}' (expected j-cy, j-zn, h-cy, or h-zn)" >&2; exit 1 ;;
    esac
    docker compose -f docker/compose.r4-02-gateway-rmw.yml up --build "rclwebd-{{row}}"
