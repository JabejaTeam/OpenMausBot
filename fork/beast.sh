# Jabeja fork only: the one way fork tooling reaches THE BEAST. Sourced by
# fork/test-beast.sh, fork/check.sh and fork/deploy-beast.sh, never run alone.
#
# One workspace per worktree (~/omb-fork/wt/<worktree>), not one shared
# folder: two sessions working in two worktrees used to rsync over each
# other's tree in ~/omb-fork/repo while the other was building (2026-10-11).
# Ignored files there (node_modules, *.tsbuildinfo, the build output) survive
# the next sync, so an unchanged lockfile skips the install and the typecheck
# is incremental (fork/beast-prepare.sh).

BEAST_HOST=${BEAST_HOST:-beast}
_beast_root=$(git rev-parse --show-toplevel)
_beast_slug=$(basename "$_beast_root" | tr -c 'A-Za-z0-9_.\n-' '-')
BEAST_DIR="omb-fork/wt/$_beast_slug"
BEAST_CONTAINER="omb-fork-$_beast_slug"

# Copy the working tree (tracked + untracked, not ignored) to this worktree's
# folder on the beast.
beast_sync() {
  ssh "$BEAST_HOST" "mkdir -p \$HOME/$BEAST_DIR \$HOME/omb-fork/pnpm-store"
  rsync -a --delete --filter=':- .gitignore' --exclude .git --exclude node_modules \
    "$_beast_root/" "$BEAST_HOST:$BEAST_DIR/"
}

# The docker run flags every fork container shares: non-root like CI, the
# pnpm store, corepack and Electron's runtime kept between runs.
BEAST_RUN_FLAGS="--init --user \$(id -u):\$(id -g) -e HOME=/tmp/home -e CI=true \
  -e COREPACK_HOME=/store/corepack -e npm_config_store_dir=/store/pnpm -e electron_config_cache=/store/electron \
  -e OMB_TEST_DURATIONS=/store/test-durations.json \
  -v \$HOME/$BEAST_DIR:/repo -v \$HOME/omb-fork/pnpm-store:/store -w /repo omb-fork-test"

# Run `bash -c <command>` in a detached container on the beast and follow its
# log until it exits; returns its exit code. Detached, so a dropped SSH
# connection or a sleeping laptop never stops it; the follow reattaches.
beast_container() {
  local command=$1
  ssh "$BEAST_HOST" "cd \$HOME/$BEAST_DIR && docker build -q -t omb-fork-test -f fork/test.Dockerfile fork >/dev/null \
    && docker rm -f $BEAST_CONTAINER >/dev/null 2>&1; docker run -d --name $BEAST_CONTAINER $BEAST_RUN_FLAGS bash -c $(printf '%q' "$command") >/dev/null"
  until ssh -o ConnectTimeout=10 "$BEAST_HOST" "docker logs -f $BEAST_CONTAINER 2>&1; [ \"\$(docker inspect -f {{.State.Running}} $BEAST_CONTAINER)\" = false ]"; do
    sleep 2
  done
  return "$(ssh "$BEAST_HOST" "docker inspect -f {{.State.ExitCode}} $BEAST_CONTAINER")"
}
