#!/usr/bin/env bash
# Install a prebuilt rclwebd gateway binary from GitHub Releases (ADR 0018).
#
#   curl -fsSL https://raw.githubusercontent.com/alexzhang1030/rclweb/main/scripts/install-rclwebd.sh | bash
#
# The binary is built inside the digest-pinned ROS builder images, so it
# expects the matching sourced ROS 2 prefix at runtime (Jazzy on Ubuntu 24.04,
# Humble on Ubuntu 22.04). Typesupport loads via dlopen from that prefix.
#
# Options (also as env vars):
#   --distro jazzy|humble   ROS distro (default: $ROS_DISTRO from the sourced env)
#   --version vX.Y.Z        release tag (default: latest release)
#   --dir PATH              install directory (default: $RCLWEBD_INSTALL_DIR or ~/.local/bin)
#   --dry-run               print what would be downloaded and exit
set -euo pipefail

REPO="${RCLWEBD_REPO:-alexzhang1030/rclweb}"
DISTRO="${ROS_DISTRO:-}"
VERSION=""
INSTALL_DIR="${RCLWEBD_INSTALL_DIR:-${HOME}/.local/bin}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --distro) DISTRO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

case "${DISTRO}" in
  jazzy|humble) ;;
  "")
    echo "error: no ROS distro. Source a ROS 2 environment first" >&2
    echo "  (e.g. source /opt/ros/jazzy/setup.bash) or pass --distro jazzy|humble." >&2
    exit 1
    ;;
  *)
    echo "error: unsupported ROS distro '${DISTRO}'. Prebuilt binaries cover" >&2
    echo "  jazzy and humble. For other distros build from source:" >&2
    echo "  cargo install rclwebd --features ros" >&2
    exit 1
    ;;
esac

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ARCH=amd64 ;;
  Linux-aarch64) ARCH=arm64 ;;
  *)
    echo "error: no prebuilt binary for $(uname -s)/$(uname -m)." >&2
    echo "  Use the container image (docker run --rm --network host" >&2
    echo "  ghcr.io/alexzhang1030/rclwebd:${DISTRO}) or build from source:" >&2
    echo "  cargo install rclwebd --features ros" >&2
    exit 1
    ;;
esac

# GitHub Releases downloads need retries; same flags as
# scripts/github-release-curl.sh (HTTP/1.1 avoids curl 56; --retry-all-errors
# covers 503).
fetch() {
  curl --retry 12 --retry-all-errors --retry-delay 4 --retry-max-time 180 \
    --connect-timeout 20 --http1.1 -fsSL "$@"
}

if [[ -z "${VERSION}" ]]; then
  VERSION="$(fetch "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -o '"tag_name"[^,]*' | head -n1 | cut -d'"' -f4)"
  if [[ -z "${VERSION}" ]]; then
    echo "error: could not resolve the latest release of ${REPO}." >&2
    echo "  Pass --version vX.Y.Z explicitly." >&2
    exit 1
  fi
fi

ASSET="rclwebd-${VERSION#v}-${DISTRO}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "would download: ${URL}"
  echo "would install:  ${INSTALL_DIR}/rclwebd"
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

echo "downloading ${ASSET} (${VERSION})…"
if ! fetch -o "${WORKDIR}/${ASSET}" "${URL}"; then
  echo "error: download failed: ${URL}" >&2
  echo "  That release may predate prebuilt binaries or not cover" >&2
  echo "  ${DISTRO}/${ARCH}. Alternatives:" >&2
  echo "  docker run --rm --network host ghcr.io/alexzhang1030/rclwebd:${DISTRO}" >&2
  echo "  cargo install rclwebd --features ros" >&2
  exit 1
fi
fetch -o "${WORKDIR}/${ASSET}.sha256" "${URL}.sha256"
(cd "${WORKDIR}" && sha256sum -c "${ASSET}.sha256" >/dev/null)

mkdir -p "${INSTALL_DIR}"
install -m 0755 "${WORKDIR}/${ASSET}" "${INSTALL_DIR}/rclwebd"

echo "installed ${INSTALL_DIR}/rclwebd (${VERSION}, ${DISTRO}, ${ARCH})"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "note: ${INSTALL_DIR} is not on PATH; add it to your shell profile." ;;
esac
echo "run it with a sourced ROS 2 environment:"
echo "  source /opt/ros/${DISTRO}/setup.bash && rclwebd"
