#!/usr/bin/env bash
REVISION="${1:-2.22.5}"
set -euo pipefail

# TEMPORARY (Node.js CVE, Oct 2026): .github/workflows/release.yaml sets `pull: true`
# on the Docker build so the node:22-alpine base is refreshed instead of cached.
# Keep it for a couple of releases, then remove it to go back to cached base layers
# (re-add it when the next Node.js security release comes out).
# NOTE: scripts/release.js requires a clean working tree except for ReleaseNotes.md,
# package.json, package-lock.json and release.sh, so commit release.yaml before running.

# Wrapper for the npm-based release flow.
# Keeps the same shell entry point style as owlcms4/release.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "Revision:  ${REVISION}"

if [[ $# -eq 0 ]]; then
  npm run release -- "${REVISION}"
else
  npm run release -- "${REVISION}" "${@:2}"
fi
