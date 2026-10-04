#!/usr/bin/env bash
# Jabeja fork only: run the vitest suite on THE BEAST (32 cores) instead of
# this machine. Copies the working tree (tracked + untracked, not ignored)
# over SSH and runs fork/test-run.mjs there. No GitHub runner on the beast on
# purpose: this fork is public, so workflow code from PRs must never reach it.
#   fork/test-beast.sh                          the whole suite
#   fork/test-beast.sh --files server/a.test.ts just these files, sliced and in parallel
#   fork/test-beast.sh --workers 32             override the worker count
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=beast
DIR=omb-fork/repo
run_args=$(printf '%q ' "$@")

rsync -a --delete --filter=':- .gitignore' --exclude .git --exclude node_modules \
  ./ "$HOST:$DIR/"

# Runs in a detached container (fork/test.Dockerfile) so nothing on the
# beast itself changes and a dropped SSH connection or a sleeping laptop does
# not stop the run; this side only follows its log. Non-root, like CI, with
# the pnpm store and the measured test durations kept between runs. --init
# reaps orphaned grandchildren: the process-tree tests count zombies as alive.
ssh "$HOST" "cd \$HOME/$DIR && docker build -q -t omb-fork-test -f fork/test.Dockerfile fork >/dev/null \
  && mkdir -p \$HOME/omb-fork/pnpm-store && docker rm -f omb-fork-test-run >/dev/null 2>&1; \
  docker run -d --init --name omb-fork-test-run --user \$(id -u):\$(id -g) -e HOME=/tmp/home -e CI=true \
     -e COREPACK_HOME=/store/corepack -e npm_config_store_dir=/store/pnpm \
     -v \$HOME/$DIR:/repo -v \$HOME/omb-fork/pnpm-store:/store -w /repo omb-fork-test \
     bash fork/test-container.sh $run_args >/dev/null"

# The log stream ends when the container does; reattach if SSH drops.
until ssh -o ConnectTimeout=10 "$HOST" 'docker logs -f omb-fork-test-run 2>&1; [ "$(docker inspect -f {{.State.Running}} omb-fork-test-run)" = false ]'; do
  sleep 2
done
exit "$(ssh "$HOST" 'docker inspect -f {{.State.ExitCode}} omb-fork-test-run')"
