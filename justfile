# Moonspan root command surface (just 1.50.0).
# Fail-fast recipes run from the repository root. Studio workspace enrollment begins at U0.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

root := justfile_directory()

# Invoke scripts/toolchain-check.ts against project pin files and installed tools.
[group('meta')]
toolchain-check:
    cd "{{root}}" && bun run scripts/toolchain-check.ts

# Validate R2WP v0 registry JSON and control CDDL (scripts/protocol-check.ts).
[group('quality')]
protocol-check: toolchain-check
    cd "{{root}}" && bun run protocol-check

# Aggregate write: valid/boundary → malformed → sequences → parity (scripts/protocol-fixtures.ts).
[group('quality')]
protocol-fixtures-write: toolchain-check
    cd "{{root}}" && bun run protocol-fixtures:write

# Aggregate check: valid/boundary → malformed → sequences → parity (exactly once each).
[group('quality')]
protocol-fixtures-check: toolchain-check
    cd "{{root}}" && bun run protocol-fixtures:check

# Standalone write R2WP v0 static malformed fixtures.
protocol-malformed-fixtures-write: toolchain-check
    cd "{{root}}" && bun run protocol-malformed-fixtures:write

# Standalone check R2WP v0 static malformed fixtures.
protocol-malformed-fixtures-check: toolchain-check
    cd "{{root}}" && bun run protocol-malformed-fixtures:check

# Standalone write R2WP v0 state-sequence fixtures.
protocol-sequence-fixtures-write: toolchain-check
    cd "{{root}}" && bun run protocol-sequence-fixtures:write

# Standalone check R2WP v0 state-sequence fixtures.
protocol-sequence-fixtures-check: toolchain-check
    cd "{{root}}" && bun run protocol-sequence-fixtures:check

# Standalone write R2WP v0 dual-transport parity corpus.
protocol-parity-fixtures-write: toolchain-check
    cd "{{root}}" && bun run protocol-parity-fixtures:write

# Standalone check R2WP v0 dual-transport parity corpus.
protocol-parity-fixtures-check: toolchain-check
    cd "{{root}}" && bun run protocol-parity-fixtures:check

# Three-language R2WP agreement gate (scripts/protocol-agree-run.ts --check).
[group('quality')]
protocol-agree: toolchain-check
    cd "{{root}}" && bun run protocol-agree

# Three-language R2WP agreement report write (scripts/protocol-agree-run.ts --write).
[group('quality')]
protocol-agree-write: toolchain-check
    cd "{{root}}" && bun run protocol-agree:write

# ROS CDR corpus check from committed artifacts (scripts/cdr-corpus.ts --check).
[group('quality')]
cdr-corpus-check: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:check

# ROS CDR corpus regenerate against pinned ROS environments (scripts/cdr-corpus.ts --write).
[group('quality')]
cdr-corpus-write: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:write

# Pinned ROS environment reproduce gate (scripts/cdr-corpus.ts --reproduce).
[group('quality')]
cdr-corpus-reproduce: toolchain-check
    cd "{{root}}" && bun run cdr-corpus:reproduce

# CDR top-level tail-slack evidence check (scripts/cdr-tail-slack.ts --check).
[group('quality')]
cdr-tail-slack-check: toolchain-check
    cd "{{root}}" && bun run cdr-tail-slack:check

# Regenerate CDR top-level tail-slack evidence (scripts/cdr-tail-slack.ts --write).
[group('quality')]
cdr-tail-slack-write: toolchain-check
    cd "{{root}}" && bun run cdr-tail-slack:write

# CDR corpus → MoonBit white-box fixture bridge check (scripts/cdr-moonbit-fixtures.ts --check).
[group('quality')]
cdr-moonbit-fixtures-check: toolchain-check
    cd "{{root}}" && bun run cdr-moonbit-fixtures:check

# Regenerate CDR corpus → MoonBit white-box fixture bridge (scripts/cdr-moonbit-fixtures.ts --write).
[group('quality')]
cdr-moonbit-fixtures-write: toolchain-check
    cd "{{root}}" && bun run cdr-moonbit-fixtures:write

# Qualification report v1 contract check (scripts/evidence-check.ts --check).
[group('quality')]
evidence-check: toolchain-check
    cd "{{root}}" && bun run evidence:check

# Regenerate the public JSON Schema from contract constants.
[group('quality')]
evidence-write: toolchain-check
    cd "{{root}}" && bun run evidence:write

# Toolchain identity, Bun docs + protocol validation, Rust fmt/clippy, MoonBit format/check, TypeScript check.
[group('quality')]
check: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun run check
    cargo fmt --all --check
    cargo clippy --locked --workspace --all-targets -- -D warnings
    moon check --frozen --deny-warn --target wasm --fmt
    bun run --filter @moonspan/sdk check

# Root/tooling/SDK Bun tests, Cargo workspace tests, and MoonBit tests once each.
[group('quality')]
test: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    bun test
    cargo test --locked --workspace
    moon test --frozen --target wasm

# Cargo workspace build, MoonBit wasm build, and Bun browser workspace build.
[group('quality')]
build: toolchain-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    cargo build --locked --workspace
    moon build --frozen --target wasm
    bun run --filter @moonspan/sdk build
