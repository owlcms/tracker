#!/usr/bin/env bash
REVISION="${1:-3.0.0-beta01}"
# Usage: ./release.sh [tracker-version] [tracker-core-version] [tracker-core-branch] [--submodules]
# If the tracker-core tag does not exist, the tracker release calls ../tracker-core/release.sh
# with TRACKER_CORE and TRACKER_CORE_BRANCH before pinning the resulting tag.
TRACKER_CORE="${2:-2.0.0-beta01}"
EXPECTED_BRANCH="${RELEASE_BRANCH:-dev69}"
TRACKER_CORE_BRANCH="${3:-${EXPECTED_BRANCH}}"
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

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "${CURRENT_BRANCH}" != "${EXPECTED_BRANCH}" ]]; then
  echo "Error: tracker ${REVISION} must be released from ${EXPECTED_BRANCH}; current branch is ${CURRENT_BRANCH:-detached HEAD}." >&2
  exit 1
fi

echo "Revision:  ${REVISION}"
echo "tracker-core: ${TRACKER_CORE}"
echo "core branch: ${TRACKER_CORE_BRANCH}"
echo "Branch:    ${CURRENT_BRANCH}"

TRACKER_CORE_BRANCH="${TRACKER_CORE_BRANCH}" npm run release -- "${REVISION}" "${TRACKER_CORE}" "${@:4}"
