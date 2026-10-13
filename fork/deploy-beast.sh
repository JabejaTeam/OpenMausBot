#!/usr/bin/env bash
# Jabeja fork only: build this commit on THE BEAST and roll it out to a live
# OpenMausBot from fork/instances.tsv (default "jabeja": docker container
# "omb" on the beast). Refuses a dirty tree, so what runs is always a commit:
# its hash is written next to the release as DEPLOYED_COMMIT.
# A restart kills running turns; they are picked up again afterwards (each
# re-checks what already happened). Without --force it first waits until no
# bot is busy and no handoff is open (up to 20 minutes).
#   fork/deploy-beast.sh                   wait for idle, then roll out (jabeja)
#   fork/deploy-beast.sh --instance ripal  another instance (or OMB_INSTANCE=ripal)
#   fork/deploy-beast.sh --all             build once, roll out to every instance in turn
#   fork/deploy-beast.sh --force           roll out now, interrupting running work
#   fork/deploy-beast.sh --allow-rollback  also when live has commits this one lacks
#
# Three rules, each from 2026-10-11:
# - Never undo another session's rollout: this commit must contain what is
#   live (checked here, and again on the host under the lock, since another
#   rollout may finish in between). Rebase on fork/main when it refuses.
# - One rollout at a time per host: the rollout step holds ~/omb-fork/deploy.lock there.
# - This side waits for the *_OK / *_FAIL line the remote side writes,
#   never for a process to vanish: `pgrep -f` over ssh matched its own shell
#   and the wait never ended (rollout done in 26 s, this side still waiting).
set -euo pipefail
cd "$(dirname "$0")/.."
source fork/beast.sh

force=0; rollback=0; all=0; instance=${OMB_INSTANCE:-jabeja}
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    --allow-rollback) rollback=1 ;;
    --all) all=1 ;;
    --instance) instance=${2:?--instance needs a name}; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
# name, host, container, port, live, data: one line per instance
rows=$(grep -v '^#' fork/instances.tsv | grep . || true)
[ $all = 1 ] || rows=$(echo "$rows" | awk -F'\t' -v name="$instance" '$1 == name')
[ -n "$rows" ] || { echo "no instance '$instance' in fork/instances.tsv" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "commit first: the working tree is dirty" >&2; exit 1; }
commit=$(git rev-parse --short HEAD)
stamp=$(date +%Y%m%d-%H%M%S)

# Runs ~/omb-fork/<job>.sh on <host> under nohup, so a dropped SSH connection
# from this machine never stops it halfway; this side only follows its log
# until the <WORD>_OK / <WORD>_FAIL line.
run_remote() {
  local host=$1 job=$2 word=$3 waited=0
  ssh "$host" "nohup bash \$HOME/omb-fork/$job.sh > \$HOME/omb-fork/$job.log 2>&1 &"
  until ssh -o ConnectTimeout=10 "$host" "grep -qE '^${word}_(OK|FAIL)\$' \$HOME/omb-fork/$job.log" 2>/dev/null; do
    sleep 1; waited=$((waited + 1))
    # build + idle wait + lock wait together stay well under this
    [ $waited -lt 3600 ] || { echo "no end line after an hour; see ~/omb-fork/$job.log on $host" >&2; return 1; }
  done
  ssh "$host" "cat \$HOME/omb-fork/$job.log"
  ssh "$host" "grep -qx ${word}_OK \$HOME/omb-fork/$job.log" || { echo "failed; see ~/omb-fork/$job.log on $host" >&2; return 1; }
}

git fetch -q fork 2>/dev/null || true
while IFS=$'\t' read -r name host _ _ live _ <&3; do
  [ "$host" = beast ] && host=$BEAST_HOST
  now_live=$(ssh -n "$host" "cat \$HOME/$live/DEPLOYED_COMMIT 2>/dev/null" || true)
  if [ -n "$now_live" ] && [ $rollback = 0 ]; then
    git cat-file -e "$now_live^{commit}" 2>/dev/null \
      || { echo "$name: live is $now_live, which this clone does not have: git fetch fork && git rebase fork/main" >&2; exit 1; }
    git merge-base --is-ancestor "$now_live" HEAD \
      || { echo "$name: live ($now_live) has commits $commit lacks; rolling out would undo them: git rebase fork/main (or --allow-rollback)" >&2; exit 1; }
  fi
done 3<<< "$rows"

beast_sync
ssh "$BEAST_HOST" "cat > \$HOME/omb-fork/build-$stamp.sh" <<REMOTE
set -euo pipefail
ok=0
trap '[ \$ok = 1 ] || echo BUILD_FAIL' EXIT
cd \$HOME/$BEAST_DIR
start=\$(date +%s)
$BEAST_IMAGE
docker run --rm $BEAST_RUN_FLAGS bash fork/beast-build.sh
echo $commit > release/npm/DEPLOYED_COMMIT
echo "built in \$((\$(date +%s) - start)) s"
ok=1
echo BUILD_OK
REMOTE
run_remote "$BEAST_HOST" "build-$stamp" BUILD

while IFS=$'\t' read -r name host container port live data <&3; do
  [ "$host" = beast ] && host=$BEAST_HOST
  job=deploy-$stamp-$name
  ssh -n "$host" "mkdir -p \$HOME/omb-fork"
  if [ "$host" = "$BEAST_HOST" ]; then
    release=$BEAST_DIR/release/npm
  else
    # the same exclusions as the rollout's rsync: the container brings its own node
    release=omb-fork/release-$name
    ssh -n "$host" "rm -rf \$HOME/$release && mkdir -p \$HOME/$release"
    ssh -n "$BEAST_HOST" "tar -C \$HOME/$BEAST_DIR/release/npm --exclude node --exclude 'node-v*' -cf - ." \
      | ssh "$host" "tar -C \$HOME/$release -xf -"
  fi
  # what live may be for this rollout to go ahead: any ancestor of this commit
  git rev-list HEAD | head -20000 | ssh "$host" "cat > \$HOME/omb-fork/$job.ancestors"
  ssh "$host" "cat > \$HOME/omb-fork/$job.sh" <<REMOTE
set -euo pipefail
ok=0
trap '[ \$ok = 1 ] || echo DEPLOY_FAIL' EXIT
start=\$(date +%s)
exec 9>\$HOME/omb-fork/deploy.lock
flock -w 900 9 || { echo "another rollout held the lock for 15 minutes" >&2; exit 1; }
now_live=\$(cat \$HOME/$live/DEPLOYED_COMMIT 2>/dev/null || true)
if [ -n "\$now_live" ] && [ $rollback = 0 ] && ! grep -q "^\$now_live" \$HOME/omb-fork/$job.ancestors; then
  echo "live became \$now_live meanwhile, which $commit lacks; nothing restarted. Rebase and roll out again." >&2
  exit 1
fi
busy() {
  docker exec $container curl -s 'http://127.0.0.1:$port/api/bots?messages=0' | python3 -c 'import json,sys; print(", ".join(b["name"] for b in json.load(sys.stdin)["bots"] if b.get("busy") or b.get("waitingForTeammates")))'
  python3 -c 'import json,sys; print("open handoffs" if any(n["status"] not in ("completed","failed","cancelled") for n in json.load(open(sys.argv[1]))) else "")' "\$HOME/$data/room-handoffs.json"
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
rsync -a \$HOME/$live/ \$HOME/$live.bak-$stamp/
rsync -a --delete --exclude node --exclude 'node-v*' \$HOME/$release/ \$HOME/$live/
docker exec $container supervisorctl -c /etc/omb-supervisord.conf restart omb-server >/dev/null
for i in \$(seq 1 30); do
  [ "\$(docker exec $container curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/api/bots?messages=0)" = 200 ] && break
  sleep 1
done
[ "\$(docker exec $container curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/api/bots?messages=0)" = 200 ] || { echo 'not healthy after 30s' >&2; exit 1; }
echo "live in \$((\$(date +%s) - start)) s"
ok=1
echo DEPLOY_OK
REMOTE
  run_remote "$host" "$job" DEPLOY || { echo "$name: rollout failed" >&2; exit 1; }
  echo "$name live: $commit (backup ~/$live.bak-$stamp on $host)"
  echo "rollback: ssh $host 'rsync -a --delete ~/$live.bak-$stamp/ ~/$live/ && docker exec $container supervisorctl -c /etc/omb-supervisord.conf restart omb-server'"
done 3<<< "$rows"
