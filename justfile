# rclweb root command surface (just 1.50.0).
# Fail-fast recipes run from the repository root.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

root := justfile_directory()

# Verify pinned bun, rustc, and just versions.
[group('meta')]
toolchain-check:
    cd "{{root}}" && bun run scripts/toolchain-check.ts

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

# Deterministic decoder fuzz smoke (stable toolchain; see fuzz/README.md for nightly).
[group('quality')]
fuzz-smoke: toolchain-check
    cd "{{root}}" && cargo test --locked -p rclweb --test decoder_fuzz_smoke

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

# Docs, protocol, and corpus checks; Rust fmt/clippy; SDK typecheck.
[group('quality')]
check: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun run check
    cargo run --locked -p protocol-fixtures -- --check
    cargo fmt --all --check
    cargo clippy --locked --workspace --all-targets -- -D warnings
    bun run --filter @rclweb/sdk check

# Bun tests (root scripts and SDK) and Cargo workspace tests.
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
[group('quality')]
ros-test: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if [ -z "${AMENT_PREFIX_PATH:-}" ]; then
        echo "error: source a ROS 2 environment first (e.g. /opt/ros/jazzy/setup.bash or /opt/ros/humble/setup.bash)" >&2
        exit 1
    fi
    cargo test --locked -p rclwebd --features ros
    cargo clippy --locked -p rclwebd --features ros --all-targets -- -D warnings

# Cargo native build, rclweb wasm32 (fat LTO) staged into the SDK, and SDK build.
[group('quality')]
build: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    cargo build --locked --workspace
    bun run scripts/build-wasm.ts
    bun run --filter @rclweb/sdk build

# Measure wasm poll latency and refresh size evidence (R-D1 reopen inputs).
[group('quality')]
poll-latency: toolchain-check
    cd "{{root}}" && bun run scripts/measure-poll-latency.ts

# R2-02 large-message path evidence (both buffer strategies + encodeHostBatch).
[group('quality')]
large-message: toolchain-check
    cd "{{root}}" && bun run scripts/measure-large-message.ts

# R2-04 performance baseline (host workloads + protocol-cost models).
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
    bun run scripts/measure-perf-baseline.ts

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
