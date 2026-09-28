#!/usr/bin/env bash
# Jabeja fork only: the full vitest suite, split into shards that run side by
# side. Each shard stays serial inside (fileParallelism:false), so the
# isolation upstream relies on holds; only whole shards overlap.
#   fork/test-fast.sh        6 shards
#   fork/test-fast.sh 8      8 shards
set -uo pipefail
cd "$(dirname "$0")/.."

n=${1:-6}
logs=$(mktemp -d)
start=$(date +%s)
for i in $(seq 1 "$n"); do
  pnpm exec vitest run --shard="$i/$n" >"$logs/shard$i.log" 2>&1 &
  pids[$i]=$!
done

failed=()
for i in $(seq 1 "$n"); do
  if wait "${pids[$i]}"; then
    echo "shard $i/$n ok"
  else
    echo "shard $i/$n FAILED ($logs/shard$i.log)"
    failed+=("$i")
  fi
done
echo "shards done in $(( $(date +%s) - start ))s, logs in $logs"
[ ${#failed[@]} -eq 0 ] && exit 0

# Overlapping shards load the machine, and a few timing-sensitive tests
# flake under that. Rerun only the failed files, alone and serially: a pass
# there is reported as flaky, a second failure is a real failure.
files=$(for i in "${failed[@]}"; do
  sed $'s/\x1b\\[[0-9;]*m//g' "$logs/shard$i.log" | sed -nE 's/^ *FAIL +([^ ]+\.test\.[a-z]+).*/\1/p'
done | sort -u)
# a shard that died without naming a failed file is a real failure
[ -n "$files" ] || exit 1
echo "rerunning serially: $(echo $files)"
if pnpm exec vitest run $files; then
  echo "FLAKY under parallel load (passed alone): $(echo $files)"
  exit 0
fi
exit 1
