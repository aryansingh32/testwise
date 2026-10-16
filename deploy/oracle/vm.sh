#!/usr/bin/env bash
# Helper for the Oracle VM (ssh alias "testwise", see CLAUDE.md). Usage:
#   deploy/oracle/vm.sh sh [cmd...]   run a command (or open a shell)
#   deploy/oracle/vm.sh ps|logs <svc>|psql|sync|deploy
set -euo pipefail
H=testwise; D=/opt/testwise
C="cd $D && sudo docker compose --env-file .env -f src/deploy/oracle/docker-compose.yml"
cd "$(dirname "$0")/../.."
case "${1:-sh}" in
  sh) shift; ssh "$H" "$@";;
  ps) ssh "$H" "$C ps";;
  logs) ssh "$H" "$C logs --tail 100 ${2:?service}";;
  psql) ssh -t "$H" "sudo docker exec -it testwise-postgres psql -U testwise testwise";;
  sync) rsync -a --relative --delete-excluded \
          --exclude node_modules --exclude dist --exclude '.env*' --exclude secrets --exclude uploads --exclude private-uploads \
          package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json packages/shared apps/api apps/admin apps/mobile/package.json deploy/oracle \
          "$H:$D/src/";;
  deploy) "$0" sync; ssh "$H" "$C up -d --build && $C ps";;
  *) echo "unknown command"; exit 1;;
esac
