#!/usr/bin/env bash
REVISION="${1:-2.22.4}"
set -euo pipefail

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
