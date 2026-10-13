#!/bin/bash
# Nightly database backup (cron). Keeps 14 days. Restore: gunzip -c FILE | docker exec -i testwise-postgres psql -U testwise testwise
set -euo pipefail
DOCKER=docker; docker ps >/dev/null 2>&1 || DOCKER='sudo -n docker'   # cron may run without docker-group membership
DIR=/opt/testwise/backups; mkdir -p "$DIR"
F="$DIR/testwise-$(date +%F-%H%M).sql.gz"
$DOCKER exec testwise-postgres pg_dump -U testwise --no-owner testwise | gzip -9 > "$F.tmp" && mv "$F.tmp" "$F"
find "$DIR" -name 'testwise-*.sql.gz' -mtime +14 -delete
echo "backup ok: $F ($(du -h "$F" | cut -f1))"
