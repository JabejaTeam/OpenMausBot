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

failed=0
for i in $(seq 1 "$n"); do
  if wait "${pids[$i]}"; then
    echo "shard $i/$n ok"
  else
    echo "shard $i/$n FAILED ($logs/shard$i.log)"
    grep -E "FAIL|✗|×" "$logs/shard$i.log" | head -20
    failed=1
  fi
done
echo "done in $(( $(date +%s) - start ))s, logs in $logs"
exit $failed
