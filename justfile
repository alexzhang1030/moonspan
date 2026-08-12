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

# Docs, protocol, and corpus checks; Rust fmt/clippy; SDK typecheck.
[group('quality')]
check: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun run check
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

# Gateway tests against real rcl (requires a sourced ROS 2 Jazzy env, row J-FT).
[group('quality')]
ros-test: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    if [ -z "${AMENT_PREFIX_PATH:-}" ]; then
        echo "error: source a ROS 2 Jazzy environment first (e.g. /opt/ros/jazzy/setup.bash)" >&2
        exit 1
    fi
    cargo test --locked -p rclwebd --features ros
    cargo clippy --locked -p rclwebd --features ros --all-targets -- -D warnings

# Cargo native build, rclweb wasm32 build, and SDK build.
[group('quality')]
build: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    cargo build --locked --workspace
    cargo build --locked -p rclweb --target wasm32-unknown-unknown
    bun run --filter @rclweb/sdk build
