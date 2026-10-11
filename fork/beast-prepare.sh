#!/usr/bin/env bash
# Jabeja fork only: ready a worktree's folder on the beast, inside the fork
# container. Sourced first by every container command (fork/beast.sh).
set -euo pipefail
cd /repo
# the copy has no .git; tests that ask git about .gitattributes need a repository
[ -d .git ] || git init -q
# Install only when the lockfile changed since the last install here: the
# install was ~30-60 s of every check, test run and rollout.
lock_hash=$(sha256sum pnpm-lock.yaml package.json | sha256sum | cut -c1-16)
if [ "$(cat node_modules/.omb-lock-hash 2>/dev/null)" != "$lock_hash" ]; then
  pnpm install --frozen-lockfile --reporter=silent
  echo "$lock_hash" > node_modules/.omb-lock-hash
fi
