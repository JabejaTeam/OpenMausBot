#!/usr/bin/env bash
# Jabeja fork only: run the vitest suite on THE BEAST (32 cores) instead of
# this machine, in this worktree's own folder there (fork/beast.sh). No
# GitHub runner on the beast on purpose: this fork is public, so workflow
# code from PRs must never reach it.
#   fork/test-beast.sh                          the whole suite
#   fork/test-beast.sh --files server/a.test.ts just these files, sliced and in parallel
#   fork/test-beast.sh --workers 32             override the worker count
# For a change, fork/check.sh is the quick gate; this is the full suite.
set -euo pipefail
cd "$(dirname "$0")/.."
source fork/beast.sh
beast_sync
beast_container "bash fork/test-container.sh $(printf '%q ' "$@")"
