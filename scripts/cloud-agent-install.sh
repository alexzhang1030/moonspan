#!/usr/bin/env bash
# Cloud Agent install for rclweb.
#
# Idempotently installs the pinned Bun and just toolchains, ensures the pinned
# Rust toolchain (with the wasm32 target), installs the JavaScript workspace,
# and verifies every pin with scripts/toolchain-check.ts. Safe to run
# repeatedly and on top of a snapshot that already contains the toolchains.
#
# Toolchain versions come from the project pin files (.bun-version,
# .just-version, rust-toolchain.toml). The just archive digest is pinned to
# the same value verified in .github/workflows/ci.yml; bun zip digests live
# in scripts/install-pinned-bun.sh. Recompute them together with the pin files.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

bun_version="$(tr -d '[:space:]' < .bun-version)"
just_version="$(tr -d '[:space:]' < .just-version)"

# Recompute together with .github/workflows/ci.yml when the just release
# archive changes.
just_archive_sha256="27e011cd6328fadd632e59233d2cf5f18460b8a8c4269acd324c1a8669f34db0"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$HOME/.local/bin:$BUN_INSTALL/bin:$PATH"

bun_matches() {
  command -v bun >/dev/null 2>&1 &&
    [ "$(bun --version 2>/dev/null | head -n1 | tr -d '[:space:]')" = "$bun_version" ]
}

just_matches() {
  command -v just >/dev/null 2>&1 &&
    [ "$(just --version 2>/dev/null | awk 'NR==1{print $2}')" = "$just_version" ]
}

if bun_matches; then
  echo "bun ${bun_version} already installed"
else
  echo "Installing bun ${bun_version}"
  bash scripts/install-pinned-bun.sh
fi

if just_matches; then
  echo "just ${just_version} already installed"
else
  echo "Installing just ${just_version}"
  asset="just-${just_version}-x86_64-unknown-linux-musl.tar.gz"
  archive="$(mktemp --suffix=.tar.gz)"
  bash scripts/github-release-curl.sh -o "$archive" \
    "https://github.com/casey/just/releases/download/${just_version}/${asset}"
  echo "${just_archive_sha256}  ${archive}" | sha256sum -c -
  mkdir -p "$HOME/.local/bin"
  tar -xzf "$archive" -C "$HOME/.local/bin" just
  chmod +x "$HOME/.local/bin/just"
  rm -f "$archive"
fi

# The default image ships rustup; rust-toolchain.toml pins the exact channel
# and targets. Install up front so it lands in the snapshot instead of on
# first cargo use.
if command -v rustup >/dev/null 2>&1; then
  channel="$(awk -F'"' '/^[[:space:]]*channel[[:space:]]*=/{print $2; exit}' rust-toolchain.toml)"
  if [ -n "$channel" ]; then
    echo "Ensuring Rust ${channel}"
    rustup toolchain install "$channel" --profile minimal \
      --component rustfmt --component clippy \
      --target wasm32-unknown-unknown
  fi
fi

# Guarantee the toolchains resolve in future shells (login, interactive, and
# non-interactive) regardless of how the agent spawns them. Marker-guarded so
# repeated installs never append duplicate blocks.
marker="# >>> rclweb cloud-agent toolchain >>>"
if ! grep -qF "$marker" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ""
    echo "$marker"
    echo 'export BUN_INSTALL="$HOME/.bun"'
    echo 'export PATH="$HOME/.local/bin:$BUN_INSTALL/bin:$PATH"'
    echo "# <<< rclweb cloud-agent toolchain <<<"
  } >> "$HOME/.bashrc"
fi

echo "Installing JavaScript workspace (frozen lockfile)"
bun install --frozen-lockfile

echo "Verifying pinned toolchain"
bun run scripts/toolchain-check.ts
