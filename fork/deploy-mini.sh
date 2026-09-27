#!/usr/bin/env bash
# Jabeja fork only: build the server package here and roll it out to the
# Mac mini (~/omb-server, LaunchAgent be.jabeja.omb-server). Takes a backup
# first and restores it automatically when /api/health does not come back.
#   fork/deploy-mini.sh            build + deploy
#   fork/deploy-mini.sh --no-build deploy the existing release/npm
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=wiebrens-mac-mini
DEST=omb-server
AGENT=be.jabeja.omb-server

if [ "${1:-}" != "--no-build" ]; then
  pnpm build:server
  pnpm exec vite build
  node scripts/build-npm-package.mjs
fi
rm -rf release/npm/enterprise
version=$(node -p 'require("./release/npm/package.json").version')
stamp=$(date +%Y%m%d-%H%M)
echo "deploying $version ($(git rev-parse --short HEAD)) to $HOST"

ssh "$HOST" "cp -a ~/$DEST ~/$DEST.bak-$stamp"
rsync -a --delete --exclude node --exclude 'node-v*' release/npm/ "$HOST:$DEST/"
ssh "$HOST" "launchctl kickstart -k gui/501/$AGENT"

for _ in $(seq 1 30); do
  sleep 2
  if ssh "$HOST" "curl -sf -m3 -o /dev/null http://127.0.0.1:8799/api/health"; then
    echo "healthy: $version live, backup at ~/$DEST.bak-$stamp"
    exit 0
  fi
done

echo "health check failed, restoring ~/$DEST.bak-$stamp" >&2
ssh "$HOST" "rsync -a --delete ~/$DEST.bak-$stamp/ ~/$DEST/ && launchctl kickstart -k gui/501/$AGENT"
exit 1
