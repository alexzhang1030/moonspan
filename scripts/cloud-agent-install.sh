#!/usr/bin/env bash
# Cloud Agent install for Moonspan.
#
# Idempotently installs the pinned Bun, MoonBit, and just toolchains, ensures
# the pinned Rust toolchain, installs the JavaScript workspace, and verifies
# every pin with scripts/toolchain-check.ts. Safe to run repeatedly and on top
# of a snapshot that already contains the toolchains.
#
# Toolchain versions come from the project pin files (.bun-version,
# .moon-version, .just-version, rust-toolchain.toml). The MoonBit installer and
# just archive digests are pinned to the same values verified in
# .github/workflows/ci.yml; recompute them there and here together.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

bun_version="$(tr -d '[:space:]' < .bun-version)"
moon_version="$(tr -d '[:space:]' < .moon-version)"
just_version="$(tr -d '[:space:]' < .just-version)"

# Recompute these together with .github/workflows/ci.yml when the upstream
# installer content or just release archive changes.
moonbit_installer_sha256="46495f8cdc0050f79b6cb195d66478d101cb3601d68506568fbe377fcdf2a9fe"
just_archive_sha256="27e011cd6328fadd632e59233d2cf5f18460b8a8c4269acd324c1a8669f34db0"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export MOON_HOME="${MOON_HOME:-$HOME/.moon}"
export PATH="$HOME/.local/bin:$MOON_HOME/bin:$BUN_INSTALL/bin:$PATH"

bun_matches() {
  command -v bun >/dev/null 2>&1 &&
    [ "$(bun --version 2>/dev/null | head -n1 | tr -d '[:space:]')" = "$bun_version" ]
}

moonc_matches() {
  command -v moonc >/dev/null 2>&1 &&
    moonc -v 2>/dev/null | grep -qF "$moon_version"
}

just_matches() {
  command -v just >/dev/null 2>&1 &&
    [ "$(just --version 2>/dev/null | awk 'NR==1{print $2}')" = "$just_version" ]
}

if bun_matches; then
  echo "bun ${bun_version} already installed"
else
  echo "Installing bun ${bun_version}"
  curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
fi

if moonc_matches; then
  echo "MoonBit ${moon_version} already installed"
else
  echo "Installing MoonBit ${moon_version}"
  installer="$(mktemp)"
  curl -fsSL -o "$installer" https://cli.moonbitlang.com/install/unix.sh
  echo "${moonbit_installer_sha256}  ${installer}" | sha256sum -c -
  mkdir -p "$MOON_HOME"
  bash "$installer" "$moon_version"
  rm -f "$installer"
fi

if just_matches; then
  echo "just ${just_version} already installed"
else
  echo "Installing just ${just_version}"
  asset="just-${just_version}-x86_64-unknown-linux-musl.tar.gz"
  archive="$(mktemp --suffix=.tar.gz)"
  curl -fsSL -L -o "$archive" \
    "https://github.com/casey/just/releases/download/${just_version}/${asset}"
  echo "${just_archive_sha256}  ${archive}" | sha256sum -c -
  mkdir -p "$HOME/.local/bin"
  tar -xzf "$archive" -C "$HOME/.local/bin" just
  chmod +x "$HOME/.local/bin/just"
  rm -f "$archive"
fi

# The default image ships rustup; rust-toolchain.toml pins the exact channel.
# Install it up front so it lands in the snapshot instead of on first cargo use.
if command -v rustup >/dev/null 2>&1; then
  channel="$(awk -F'"' '/^[[:space:]]*channel[[:space:]]*=/{print $2; exit}' rust-toolchain.toml)"
  if [ -n "$channel" ]; then
    echo "Ensuring Rust ${channel}"
    rustup toolchain install "$channel" --profile minimal \
      --component rustfmt --component clippy
  fi
fi

# Guarantee the toolchains resolve in future shells (login, interactive, and
# non-interactive) regardless of how the agent spawns them. Marker-guarded so
# repeated installs never append duplicate blocks.
marker="# >>> moonspan cloud-agent toolchain >>>"
if ! grep -qF "$marker" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ""
    echo "$marker"
    echo 'export BUN_INSTALL="$HOME/.bun"'
    echo 'export MOON_HOME="$HOME/.moon"'
    echo 'export PATH="$HOME/.local/bin:$MOON_HOME/bin:$BUN_INSTALL/bin:$PATH"'
    echo "# <<< moonspan cloud-agent toolchain <<<"
  } >> "$HOME/.bashrc"
fi

echo "Installing JavaScript workspace (frozen lockfile)"
bun install --frozen-lockfile

echo "Verifying pinned toolchain"
bun run scripts/toolchain-check.ts
