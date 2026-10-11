#!/usr/bin/env bash
# Jabeja fork only: build the Hubigen Mac app (fork/hubigen-builder.yml) for
# this Mac's architecture, signed with Jabeja's Developer ID. Not notarized:
# fine for a Mac that builds it itself (no quarantine flag). Output:
# release/mac-arm64/Hubigen.app (or mac/ on Intel).
#   fork/build-hubigen.sh            build
#   fork/build-hubigen.sh --install  build, then replace /Applications/Hubigen.app
set -euo pipefail
cd "$(dirname "$0")/.."
arch=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)
pnpm install --frozen-lockfile
pnpm package:prepare
pnpm build:speech
pnpm build:cua
pnpm exec electron-builder --config fork/hubigen-builder.yml --mac dir "--$arch" --publish never
app=$(ls -d release/mac*/Hubigen.app | head -1)
codesign --verify --deep --strict "$app"
echo "built $app ($(git rev-parse --short HEAD))"
if [ "${1:-}" = "--install" ]; then
  osascript -e 'quit app "Hubigen"' 2>/dev/null || true
  rm -rf /Applications/Hubigen.app
  ditto "$app" /Applications/Hubigen.app
  echo "installed /Applications/Hubigen.app"
fi
