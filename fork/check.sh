#!/usr/bin/env bash
# Jabeja fork only: the quick gate for a change, on THE BEAST, in one
# container: typecheck (incremental), lint of the changed files, and the
# tests that belong to them. The full suite (fork/test-beast.sh) is for
# upstream merges and the nightly run, not for every change.
#   fork/check.sh            what changed since fork/main, committed or not
#   fork/check.sh --base X   what changed since X
# Tests that belong to a change: every changed test file, plus for each
# changed source file the tests named after it (foo.ts → foo.test.ts,
# foo.*.test.ts, also .tsx).
set -euo pipefail
cd "$(dirname "$0")/.."
source fork/beast.sh

base=${2:-}
[ "${1:-}" = "--base" ] || base=$(git merge-base fork/main HEAD 2>/dev/null || git rev-parse HEAD)
changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done)

tests=$(for f in $changed; do
  case "$f" in
    (*.test.ts|*.test.tsx) echo "$f" ;;
    (*.ts|*.tsx)
      stem=${f%.*}
      git ls-files "$stem.test.ts" "$stem.test.tsx" "$stem.*.test.ts" "$stem.*.test.tsx"
      ;;
  esac
done | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done)
lint=$(for f in $changed; do case "$f" in (*.ts|*.tsx|*.js|*.mjs) echo "$f" ;; esac; done)

echo "changed: $(echo "$changed" | grep -c . || true) files, tests: $(echo "$tests" | grep -c . || true) files"
beast_sync
# quoted for the container's shell; nothing at all for an empty list
q() { [ $# -eq 0 ] || printf '%q ' "$@"; }
# shellcheck disable=SC2086
beast_container "source fork/beast-prepare.sh
set +e
status=0
tsc=node_modules/.bin/tsc
mkdir -p node_modules/.cache
( \$tsc -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.cache/tsc-web.tsbuildinfo \
  && \$tsc -p tsconfig.server.json --incremental --tsBuildInfoFile node_modules/.cache/tsc-server.tsbuildinfo ) > /tmp/tsc.log 2>&1 &
tsc_pid=\$!
lint_files=( $(q $lint) )
if [ \${#lint_files[@]} -gt 0 ]; then node_modules/.bin/oxlint --deny-warnings \"\${lint_files[@]}\" || status=1; fi
test_files=( $(q $tests) )
if [ \${#test_files[@]} -gt 0 ]; then
  node --input-type=commonjs -e \"require('electron')\" >/dev/null
  node fork/test-run.mjs --files \"\${test_files[@]}\" || status=1
fi
if wait \$tsc_pid; then echo 'typecheck: ok'; else cat /tmp/tsc.log; echo 'typecheck: FAILED'; status=1; fi
[ \$status = 0 ] && echo CHECK_OK || echo CHECK_FAILED
exit \$status"
