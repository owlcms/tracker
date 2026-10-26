#!/usr/bin/env bash
REVISION="${1:-3.0.0-beta01}"
# Usage: ./release.sh [tracker-version] [tracker-core-version] [--submodules]
# tracker-core must be released first (../tracker-core/release.sh); its tag is pinned in package.json.
TRACKER_CORE="${2:-2.0.0-beta01}"
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
echo "tracker-core: ${TRACKER_CORE}"

npm run release -- "${REVISION}" "${TRACKER_CORE}" "${@:3}"
