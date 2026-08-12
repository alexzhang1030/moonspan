#!/usr/bin/env bash
# Install the repo-pinned Bun from GitHub Releases (not bun.sh/install).
#
# Used by scripts/cloud-agent-install.sh (no GitHub Actions). CI uses
# oven-sh/setup-bun; e2e images copy bun from digest-pinned oven/bun.
# Digests are from bun-v1.3.14 SHASUMS256.txt; recompute together with
# .bun-version.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -d '[:space:]' < "${root}/.bun-version")"
if [[ "${version}" != "1.3.14" ]]; then
  echo "error: .bun-version is ${version}; this script pins 1.3.14 assets" >&2
  exit 1
fi

arch="$(uname -m)"
case "${arch}" in
  x86_64)
    asset="bun-linux-x64.zip"
    sha256="951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f"
    ;;
  aarch64 | arm64)
    asset="bun-linux-aarch64.zip"
    sha256="a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b"
    ;;
  *)
    echo "error: unsupported arch ${arch} for pinned bun" >&2
    exit 1
    ;;
esac

export BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"
if command -v bun >/dev/null 2>&1; then
  if [[ "$(bun --version 2>/dev/null | head -n1 | tr -d '[:space:]')" == "${version}" ]]; then
    echo "bun ${version} already installed"
    exit 0
  fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
zip="${tmp}/${asset}"
bash "${root}/scripts/github-release-curl.sh" -o "${zip}" \
  "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}"
echo "${sha256}  ${zip}" | sha256sum -c -
unzip -q -o "${zip}" -d "${tmp}"
dir="${asset%.zip}"
install -D -m 0755 "${tmp}/${dir}/bun" "${BUN_INSTALL}/bin/bun"
ln -sfn bun "${BUN_INSTALL}/bin/bunx"
"${BUN_INSTALL}/bin/bun" --version
