#!/usr/bin/env bash
# Jabeja fork only: what fork/test-beast.sh runs inside the test container.
set -euo pipefail
cd "$(dirname "$0")/.."
# the copy has no .git; tests that ask git about .gitattributes need a repository
[ -d .git ] || git init -q
pnpm install --frozen-lockfile --reporter=silent
# Electron downloads its runtime on first import; do it before the suite
node --input-type=commonjs -e "require('electron')"
export OMB_TEST_DURATIONS=/store/test-durations.json
exec node fork/test-run.mjs "$@"
