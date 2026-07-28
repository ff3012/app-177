#!/bin/sh
# Nightly Postgres backup. Add to crontab on the Hetzner host, e.g.:
#   0 3 * * * /opt/ffapp/docker/backup.sh >> /var/log/ffapp-backup.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/docker/backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H%M)
FILE="$BACKUP_DIR/db-$TIMESTAMP.sql.gz"

docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"

echo "Backup geschrieben: $FILE"

# Zeitpunkt in AppSettings festhalten, damit die Status-Seite (Verwaltung > Status) das letzte
# erfolgreiche Backup anzeigen kann, ohne dass der App-Container Zugriff auf dieses Verzeichnis braucht.
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "INSERT INTO \"AppSettings\" (id, \"lastBackupAt\", \"updatedAt\") VALUES ('singleton', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET \"lastBackupAt\" = NOW(), \"updatedAt\" = NOW();"

# 30 Tage Aufbewahrung
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +30 -delete
