#!/usr/bin/env bash
# Fetch a GitHub Releases URL with retries.
#
# Used by scripts/cloud-agent-install.sh (no GitHub Actions). CI installs
# just via extractions/setup-just. HTTP/1.1 avoids curl (56) "Connection
# died, tried 5 times"; --retry-all-errors covers 503.
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "usage: github-release-curl.sh [curl args…] URL" >&2
  exit 2
fi
exec curl \
  --retry 12 \
  --retry-all-errors \
  --retry-delay 4 \
  --retry-max-time 180 \
  --connect-timeout 20 \
  --http1.1 \
  -fsSL \
  -L \
  "$@"
