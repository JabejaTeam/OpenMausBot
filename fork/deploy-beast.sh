#!/usr/bin/env bash
# Jabeja fork only: build this commit on THE BEAST and roll it out to the live
# OpenMausBot (docker container "omb"). Refuses a dirty tree, so what runs is
# always a commit: its hash is written next to the release as DEPLOYED_COMMIT.
# A restart kills running turns; they are picked up again afterwards (each
# re-checks what already happened). Without --force it first waits until no
# bot is busy and no handoff is open (up to 20 minutes).
#   fork/deploy-beast.sh                   wait for idle, then roll out
#   fork/deploy-beast.sh --force           roll out now, interrupting running work
#   fork/deploy-beast.sh --allow-rollback  also when live has commits this one lacks
#
# Three rules, each from 2026-10-11:
# - Never undo another session's rollout: this commit must contain what is
#   live (checked here, and again on the beast under the lock, since another
#   rollout may finish in between). Rebase on fork/main when it refuses.
# - One rollout at a time: the rollout step holds ~/omb-fork/deploy.lock.
# - This side waits for the DEPLOY_OK / DEPLOY_FAIL line the beast writes,
#   never for a process to vanish: `pgrep -f` over ssh matched its own shell
#   and the wait never ended (rollout done in 26 s, this side still waiting).
set -euo pipefail
cd "$(dirname "$0")/.."
source fork/beast.sh

LIVE=omb-data/home/omb-server
force=0; rollback=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --allow-rollback) rollback=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
[ -z "$(git status --porcelain)" ] || { echo "commit first: the working tree is dirty" >&2; exit 1; }
commit=$(git rev-parse --short HEAD)
stamp=$(date +%Y%m%d-%H%M%S)

git fetch -q fork 2>/dev/null || true
live=$(ssh "$BEAST_HOST" "cat \$HOME/$LIVE/DEPLOYED_COMMIT 2>/dev/null" || true)
if [ -n "$live" ] && [ $rollback = 0 ]; then
  git cat-file -e "$live^{commit}" 2>/dev/null \
    || { echo "live is $live, which this clone does not have: git fetch fork && git rebase fork/main" >&2; exit 1; }
  git merge-base --is-ancestor "$live" HEAD \
    || { echo "live ($live) has commits $commit lacks; rolling out would undo them: git rebase fork/main (or --allow-rollback)" >&2; exit 1; }
fi

beast_sync
# what live may be for this rollout to go ahead: any ancestor of this commit
git rev-list HEAD | head -20000 | ssh "$BEAST_HOST" "cat > \$HOME/$BEAST_DIR/.deploy-ancestors"

log=omb-fork/deploy-$stamp.log
ssh "$BEAST_HOST" "cat > \$HOME/omb-fork/deploy-$stamp.sh" <<REMOTE
set -euo pipefail
ok=0
trap '[ \$ok = 1 ] || echo DEPLOY_FAIL' EXIT
cd \$HOME/$BEAST_DIR
start=\$(date +%s)
docker build -q -t omb-fork-test -f fork/test.Dockerfile fork >/dev/null
docker run --rm $BEAST_RUN_FLAGS bash -c 'source fork/beast-prepare.sh && pnpm -s build:server >/dev/null && pnpm exec vite build >/dev/null && node scripts/build-npm-package.mjs'
echo $commit > release/npm/DEPLOYED_COMMIT
echo "built in \$((\$(date +%s) - start)) s"

exec 9>\$HOME/omb-fork/deploy.lock
flock -w 900 9 || { echo "another rollout held the lock for 15 minutes" >&2; exit 1; }
now_live=\$(cat \$HOME/$LIVE/DEPLOYED_COMMIT 2>/dev/null || true)
if [ -n "\$now_live" ] && [ $rollback = 0 ] && ! grep -q "^\$now_live" .deploy-ancestors; then
  echo "live became \$now_live meanwhile, which $commit lacks; nothing restarted. Rebase and roll out again." >&2
  exit 1
fi
busy() {
  docker exec omb curl -s 'http://127.0.0.1:8799/api/bots?messages=0' | python3 -c 'import json,sys; print(", ".join(b["name"] for b in json.load(sys.stdin)["bots"] if b.get("busy") or b.get("waitingForTeammates")))'
  python3 -c 'import json; print("open handoffs" if any(n["status"] not in ("completed","failed","cancelled") for n in json.load(open("/home/jabeja/omb-data/home/.openmausbot/room-handoffs.json"))) else "")'
}
if [ $force = 0 ]; then
  for i in \$(seq 1 240); do
    now=\$(busy | tr '\n' ' ' | xargs)
    [ -z "\$now" ] && break
    [ \$((i % 12)) = 1 ] && echo "waiting for idle: \$now"
    sleep 5
  done
  [ -z "\$now" ] || { echo "still busy after 20 minutes (\$now); nothing restarted. Use --force to interrupt." >&2; exit 1; }
fi
rsync -a \$HOME/$LIVE/ \$HOME/$LIVE.bak-$stamp/
rsync -a --delete --exclude node --exclude 'node-v*' release/npm/ \$HOME/$LIVE/
docker exec omb supervisorctl -c /etc/omb-supervisord.conf restart omb-server >/dev/null
for i in \$(seq 1 30); do
  [ "\$(docker exec omb curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/api/bots?messages=0)" = 200 ] && break
  sleep 1
done
[ "\$(docker exec omb curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/api/bots?messages=0)" = 200 ] || { echo 'not healthy after 30s' >&2; exit 1; }
echo "live in \$((\$(date +%s) - start)) s"
ok=1
echo DEPLOY_OK
REMOTE
# The rollout runs on the beast itself (nohup), so a dropped SSH connection
# from this machine never stops it halfway; this side only follows its log.
ssh "$BEAST_HOST" "nohup bash \$HOME/omb-fork/deploy-$stamp.sh > \$HOME/$log 2>&1 &"
waited=0
until ssh -o ConnectTimeout=10 "$BEAST_HOST" "grep -qE '^DEPLOY_(OK|FAIL)\$' \$HOME/$log" 2>/dev/null; do
  sleep 3; waited=$((waited + 3))
  # build + idle wait + lock wait together stay well under this
  [ $waited -lt 3600 ] || { echo "no end line after an hour; see ~/$log on $BEAST_HOST" >&2; exit 1; }
done
ssh "$BEAST_HOST" "cat \$HOME/$log"
ssh "$BEAST_HOST" "grep -qx DEPLOY_OK \$HOME/$log" || { echo "rollout failed; see ~/$log on $BEAST_HOST" >&2; exit 1; }
echo "live: $commit (backup ~/$LIVE.bak-$stamp)"
echo "rollback: ssh $BEAST_HOST 'rsync -a --delete ~/$LIVE.bak-$stamp/ ~/$LIVE/ && docker exec omb supervisorctl -c /etc/omb-supervisord.conf restart omb-server'"
