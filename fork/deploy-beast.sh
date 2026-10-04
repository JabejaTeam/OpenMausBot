#!/usr/bin/env bash
# Jabeja fork only: build this commit on THE BEAST and roll it out to the live
# OpenMausBot (docker container "omb"). Refuses a dirty tree, so what runs is
# always a commit: its hash is written next to the release as DEPLOYED_COMMIT.
# Keeps a dated backup and prints the one command that rolls back.
#   fork/deploy-beast.sh
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=beast
DIR=omb-fork/repo
LIVE=omb-data/home/omb-server
[ -z "$(git status --porcelain)" ] || { echo "commit first: the working tree is dirty" >&2; exit 1; }
commit=$(git rev-parse --short HEAD)
stamp=$(date +%Y%m%d-%H%M%S)

rsync -a --delete --filter=':- .gitignore' --exclude .git --exclude node_modules ./ "$HOST:$DIR/"
ssh "$HOST" "set -e; cd \$HOME/$DIR && docker build -q -t omb-fork-test -f fork/test.Dockerfile fork >/dev/null
  docker run --rm --user \$(id -u):\$(id -g) -e HOME=/tmp/home -e COREPACK_HOME=/store/corepack -e npm_config_store_dir=/store/pnpm \
    -v \$HOME/$DIR:/repo -v \$HOME/omb-fork/pnpm-store:/store -w /repo omb-fork-test \
    bash -c 'pnpm install --frozen-lockfile --reporter=silent && pnpm build:server >/dev/null && pnpm exec vite build >/dev/null && node scripts/build-npm-package.mjs'
  echo $commit > release/npm/DEPLOYED_COMMIT
  # Running turns are interrupted by a restart; say so instead of guessing.
  busy=\$(docker exec omb curl -s 'http://127.0.0.1:8799/api/bots?messages=0' | python3 -c 'import json,sys; print(\", \".join(b[\"name\"] for b in json.load(sys.stdin)[\"bots\"] if b.get(\"busy\")))')
  [ -z \"\$busy\" ] || echo \"note: busy now, interrupted by the restart: \$busy\"
  rsync -a \$HOME/$LIVE/ \$HOME/$LIVE.bak-$stamp/
  rsync -a --delete --exclude node --exclude 'node-v*' release/npm/ \$HOME/$LIVE/
  docker exec omb supervisorctl -c /etc/omb-supervisord.conf restart omb-server >/dev/null
  for i in \$(seq 1 30); do
    [ \"\$(docker exec omb curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/api/bots?messages=0)\" = 200 ] && break
    sleep 1
  done
  [ \"\$(docker exec omb curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/api/bots?messages=0)\" = 200 ] || { echo 'not healthy after 30s' >&2; exit 1; }"
echo "live: $commit (backup ~/$LIVE.bak-$stamp)"
echo "rollback: ssh $HOST 'rsync -a --delete ~/$LIVE.bak-$stamp/ ~/$LIVE/ && docker exec omb supervisorctl -c /etc/omb-supervisord.conf restart omb-server'"
