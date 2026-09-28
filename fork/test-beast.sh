#!/usr/bin/env bash
# Jabeja fork only: run the full vitest suite on THE BEAST (32 cores) instead
# of this machine. Copies the working tree (tracked + untracked, not ignored)
# over SSH and runs fork/test-fast.sh there. No GitHub runner on the beast on
# purpose: this fork is public, so workflow code from PRs must never reach it.
#   fork/test-beast.sh       12 shards
#   fork/test-beast.sh 16    16 shards
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=beast
DIR=omb-fork/repo
n=${1:-12}

rsync -a --delete --filter=':- .gitignore' --exclude .git --exclude node_modules \
  ./ "$HOST:$DIR/"

# Runs in a detached container (fork/test.Dockerfile) so nothing on the
# beast itself changes and a dropped SSH connection or a sleeping laptop does
# not stop the run; this side only polls. Non-root, like CI, with the pnpm
# store kept between runs.
ssh "$HOST" "cd \$HOME/$DIR && docker build -q -t omb-fork-test -f fork/test.Dockerfile fork >/dev/null \
  && mkdir -p \$HOME/omb-fork/pnpm-store && docker rm -f omb-fork-test-run >/dev/null 2>&1; \
  docker run -d --name omb-fork-test-run --user \$(id -u):\$(id -g) -e HOME=/tmp/home -e CI=true \
     -e COREPACK_HOME=/store/corepack -e npm_config_store_dir=/store/pnpm \
     -v \$HOME/$DIR:/repo -v \$HOME/omb-fork/pnpm-store:/store -w /repo omb-fork-test \
     bash fork/test-container.sh $n >/dev/null"
echo "running on $HOST (docker logs -f omb-fork-test-run to follow)"

while [ "$(ssh -o ConnectTimeout=10 "$HOST" 'docker inspect -f {{.State.Running}} omb-fork-test-run' 2>/dev/null || echo true)" = true ]; do
  sleep 10
done
ssh "$HOST" 'docker logs omb-fork-test-run 2>&1 | tail -60'
exit "$(ssh "$HOST" 'docker inspect -f {{.State.ExitCode}} omb-fork-test-run')"
