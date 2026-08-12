#!/usr/bin/env bash
# Fetch a GitHub Releases URL with retries.
#
# GitHub HTTP/2 plus a 503/empty reply is a paid CI flake (e2e Bun zip,
# foundation `just` archive). HTTP/1.1 avoids curl (56) "Connection died,
# tried 5 times"; --retry-all-errors covers 503.
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "usage: github-release-curl.sh [curl args…] URL" >&2
  exit 2
fi
exec curl \
  --retry 8 \
  --retry-all-errors \
  --retry-delay 2 \
  --connect-timeout 20 \
  --http1.1 \
  -fsSL \
  -L \
  "$@"
