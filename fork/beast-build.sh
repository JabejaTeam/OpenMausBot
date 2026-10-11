#!/usr/bin/env bash
# Jabeja fork only: build the npm package that fork/deploy-beast.sh rolls out,
# inside the fork container, in this worktree's folder on the beast.
#
# Measured 2026-10-11 (32 cores): vite build 15.4 s, tsc emit 5.9 s, esbuild
# 0.2 s — the whole rollout was those two builds, run one after the other on
# every rollout. Now:
# - each half is skipped when its inputs are byte-for-byte what it was last
#   built from here (a content hash, ~30 ms); a server-only change ships
#   without a frontend build and the other way round;
# - the server's tsc emit is incremental (1.0 s warm instead of 5.9 s);
# - both halves run side by side.
# The hash covers more than strictly needed rather than less: a stale build
# costs a wrong rollout, a needless one a few seconds.
set -euo pipefail
source "$(dirname "$0")/beast-prepare.sh"
# Jabeja fork: what ships is Hubigen. This folder is a synced copy (no .git),
# so rename it before hashing and building (fork/rebrand.mjs); the next sync
# puts upstream's text back and the same rename gives the same hash.
node fork/rebrand.mjs .
mkdir -p node_modules/.cache
# pinned: a new version is a deliberate, measured step
ROLLDOWN_VITE=7.1.12

# tests never reach the build: changing one must not rebuild anything
inputs_hash() { find "$@" -type f ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.mjs' -print0 2>/dev/null | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-32; }
web_hash=$(inputs_hash src shared public index.html vite.config.ts tsconfig.json package.json pnpm-lock.yaml \
  scripts/testing/duration-sequencer.ts server/testing/host-timeout.ts)-rolldown-$ROLLDOWN_VITE
server_hash=$(inputs_hash server shared enterprise scripts electron package.json pnpm-lock.yaml \
  tsconfig.json tsconfig.server.json tsconfig.server.build.json)

build_web() {
  if [ "$(cat node_modules/.cache/web.hash 2>/dev/null)" = "$web_hash" ] && [ -f dist/index.html ]; then
    echo "web: unchanged, kept"; return
  fi
  local s=$SECONDS
  rm -f node_modules/.cache/web.hash
  # rolldown-vite (Rust bundler, same config and plugins) builds the app in
  # 1.3 s instead of 15.4 s (measured 2026-10-11). Installed beside the repo
  # in /store, not in package.json: vitest runs on the repo's own vite, and
  # upstream merges stay untouched. Any failure falls back to plain vite.
  local fast=/store/tools/rolldown-vite-$ROLLDOWN_VITE
  if [ ! -x "$fast/node_modules/.bin/vite" ]; then
    ( mkdir -p "$fast" && cd "$fast" && echo '{"private":true}' > package.json \
      && CI=false pnpm add "rolldown-vite@$ROLLDOWN_VITE" >/dev/null 2>&1 ) || true
  fi
  if [ -x "$fast/node_modules/.bin/vite" ] && "$fast/node_modules/.bin/vite" build >/tmp/web-build.log 2>&1; then
    echo "web: built in $((SECONDS - s)) s (rolldown-vite)"
  else
    [ -x "$fast/node_modules/.bin/vite" ] && { echo "web: rolldown-vite failed, plain vite:"; tail -5 /tmp/web-build.log; }
    node_modules/.bin/vite build >/dev/null
    echo "web: built in $((SECONDS - s)) s"
  fi
  echo "$web_hash" > node_modules/.cache/web.hash
}
build_server() {
  if [ "$(cat node_modules/.cache/server.hash 2>/dev/null)" = "$server_hash" ] && [ -f dist-server/index.js ]; then
    echo "server: unchanged, kept"; return
  fi
  local s=$SECONDS
  rm -f node_modules/.cache/server.hash
  # tsc --incremental trusts its build info, not the disk: with dist-server
  # gone it re-emits nothing and still succeeds (reproduced 2026-10-11: 456
  # files → 0). So every file it ever emitted is listed, checked afterwards,
  # and any one missing means a cold emit.
  local info=node_modules/.cache/tsc-build.tsbuildinfo emitted=node_modules/.cache/tsc-emitted.txt missing=cold
  emit() { node_modules/.bin/tsc -p tsconfig.server.build.json --incremental --tsBuildInfoFile "$info" --listEmittedFiles | sed -n 's/^TSFILE: //p'; }
  if [ -f "$info" ] && [ -s "$emitted" ]; then
    emit >> "$emitted"
    sort -u -o "$emitted" "$emitted"
    missing=$(while read -r f; do [ -f "$f" ] || { echo "$f"; break; }; done < "$emitted")
  fi
  if [ -n "$missing" ]; then
    [ "$missing" = cold ] || echo "server: $missing missing, emitting everything"
    rm -f "$info"
    emit > "$emitted"
  fi
  node scripts/bundle-server.mjs >/dev/null 2>&1
  echo "$server_hash" > node_modules/.cache/server.hash
  echo "server: built in $((SECONDS - s)) s"
}

build_web & web=$!
build_server & server=$!
status=0
wait $web || status=1
wait $server || status=1
[ $status = 0 ] || exit 1
node scripts/build-npm-package.mjs >/dev/null
