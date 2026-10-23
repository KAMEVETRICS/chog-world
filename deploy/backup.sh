#!/usr/bin/env bash
# Daily backup of Chog World's database: a compressed pg_dump from the running db container, checked before it is
# kept, with the last CHOG_BACKUP_DAYS days retained. Run as root (cron), from anywhere:
#   bash /home/ubuntu/chog-world/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"

dir=${CHOG_BACKUP_DIR:-/var/backups/chog-world}
keep=${CHOG_BACKUP_DAYS:-14}
umask 077
mkdir -p "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
partial="$dir/.chog-world-$stamp.sql.gz.partial"
trap 'rm -f "$partial"' EXIT

# pipefail: a failed pg_dump fails the backup instead of leaving a truncated file.
docker compose exec -T db pg_dump -U chog -d chog_world --no-owner | gzip -9 > "$partial"
gzip -t "$partial"
if ! zcat "$partial" | grep -q "PostgreSQL database dump complete"; then
  echo "$(date -u +%FT%TZ) backup FAILED: the dump is incomplete" >&2
  exit 1
fi

final="$dir/chog-world-$stamp.sql.gz"
mv "$partial" "$final"
find "$dir" -maxdepth 1 -name 'chog-world-*.sql.gz' -mtime "+$keep" -delete
echo "$(date -u +%FT%TZ) backup ok: $final ($(du -h "$final" | cut -f1)), $(find "$dir" -maxdepth 1 -name 'chog-world-*.sql.gz' | wc -l) kept"
