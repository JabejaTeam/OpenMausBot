#!/usr/bin/env bash
# Jabeja fork only: what fork/test-beast.sh runs inside the test container.
set -euo pipefail
source "$(dirname "$0")/beast-prepare.sh"
# Electron downloads its runtime on first import (kept in /store/electron);
# do it before the suite
node --input-type=commonjs -e "require('electron')"
exec node fork/test-run.mjs "$@"
