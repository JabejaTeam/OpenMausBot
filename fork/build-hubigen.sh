#!/usr/bin/env bash
# Jabeja fork only: build the Hubigen Mac app (Apple chip),
# signed with Jabeja's Developer ID. Built from a COPY of this repo that
# fork/rebrand.mjs renamed to the product in shared/product.json; the repo
# itself keeps upstream's text. Not notarized yet: fine for a Mac that builds
# it itself (no quarantine flag). Output: release/mac-arm64/Hubigen.app
#   fork/build-hubigen.sh            build
#   fork/build-hubigen.sh --install  build, then replace /Applications/Hubigen.app
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD
name=$(node -p 'require("./shared/product.json").name')
copy="${TMPDIR:-/tmp}/hubigen-build"
mkdir -p "$copy"
rsync -a --delete --exclude .git --exclude node_modules --exclude release --exclude 'dist*' ./ "$copy/"
node fork/rebrand.mjs "$copy"
cd "$copy"
pnpm install --frozen-lockfile
pnpm package:prepare
pnpm build:speech
pnpm build:cua
# targets and notarizing come from the config: an app folder, or with
# HUBIGEN_RELEASE=1 (fork/release-hubigen.sh) a notarized dmg + zip
pnpm exec electron-builder --config fork/hubigen-builder.mjs --mac --publish never
app=$(ls -d release/mac*/"$name.app" | head -1)
codesign --verify --deep --strict "$app"
mkdir -p "$repo/release/$(dirname "${app#release/}")"
rm -rf "$repo/release/${app#release/}"
ditto "$app" "$repo/release/${app#release/}"
if [ "${HUBIGEN_RELEASE:-}" = 1 ]; then
  rsync -a release/"$name"-*.dmg release/"$name"-*.zip release/*.blockmap release/latest-mac.yml "$repo/release/"
fi
echo "built release/${app#release/} ($(git -C "$repo" rev-parse --short HEAD))"
if [ "${1:-}" = "--install" ]; then
  osascript -e "quit app \"$name\"" 2>/dev/null || true
  for _ in $(seq 1 20); do pgrep -x "$name" >/dev/null || break; sleep 1; done
  rm -rf "/Applications/$name.app"
  ditto "$app" "/Applications/$name.app"
  echo "installed /Applications/$name.app"
fi
