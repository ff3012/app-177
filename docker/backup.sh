#!/bin/sh
# Nightly Postgres backup. Add to crontab on the Hetzner host, e.g.:
#   0 3 * * * /opt/app-177/docker/backup.sh >> /var/log/ffapp-backup.log 2>&1
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

# Off-Box-Kopie auf S3-kompatiblen Object Storage (z. B. Exoscale SOS) - optional, nur aktiv wenn
# S3_BACKUP_BUCKET in .env gesetzt ist, damit Server ohne konfigurierten Object Storage unverändert
# weiterlaufen.
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "$FILE" "s3://$S3_BACKUP_BUCKET/$(basename "$FILE")" --endpoint-url "$S3_ENDPOINT_URL"
  echo "Off-Box-Kopie hochgeladen: s3://$S3_BACKUP_BUCKET/$(basename "$FILE")"

  # Eigener Zeitstempel für die Status-Seite (analog zu lastBackupAt oben), bewusst erst NACH dem
  # erfolgreichen Upload gesetzt - schlägt `aws s3 cp` fehl, bricht das Skript wegen `set -e` vorher
  # ab und dieser UPSERT wird nie erreicht, ohne eigene Fehlerbehandlung.
  docker compose -f docker/docker-compose.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "INSERT INTO \"AppSettings\" (id, \"lastS3BackupAt\", \"updatedAt\") VALUES ('singleton', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET \"lastS3BackupAt\" = NOW(), \"updatedAt\" = NOW();"

  # .env und docker/Caddyfile existieren NUR auf diesem Server (.env ist bewusst .gitignore't, die
  # echte Domain in Caddyfile wurde direkt auf dem Server eingetragen, nie committet) - ohne sie ist
  # ein pg_dump-Restore auf einem neuen Server für sich allein nutzlos, allem voran weil
  # VAPID_PRIVATE_KEY nicht nachträglich rekonstruierbar ist: ohne den exakt gleichen Schlüssel
  # werden alle bestehenden PushSubscription-Zeilen aus dem DB-Restore permanent nutzlos, und jedes
  # der ~200 Mitglieder müsste Push-Benachrichtigungen manuell neu aktivieren. Nur als S3-Kopie
  # gedacht (nicht zusätzlich lokal aufgehoben) - die Dateien liegen ohnehin schon unverändert direkt
  # neben diesem Skript, ein lokales "Backup" davon hätte keinen zusätzlichen Schutzwert; chmod 600
  # wegen der Klartext-Secrets in .env, und die lokale Kopie wird nach dem Upload sofort gelöscht.
  CONFIG_FILE="$BACKUP_DIR/config-$TIMESTAMP.tar.gz"
  tar -czf "$CONFIG_FILE" .env docker/Caddyfile
  chmod 600 "$CONFIG_FILE"
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "$CONFIG_FILE" "s3://$S3_BACKUP_BUCKET/$(basename "$CONFIG_FILE")" --endpoint-url "$S3_ENDPOINT_URL"
  echo "Off-Box-Kopie hochgeladen: s3://$S3_BACKUP_BUCKET/$(basename "$CONFIG_FILE")"
  rm -f "$CONFIG_FILE"

  # Exoscale SOS (Stand jetzt) unterstützt keine native Bucket-Lifecycle-Policy - eine
  # PutBucketLifecycleConfiguration wird entweder stillschweigend ignoriert oder mit MalformedXML
  # abgelehnt, je nach Rule-Inhalt (getestet). Exoscales eigener Workaround (ein separater
  # Docker-Client) braucht zusätzlich aktiviertes Bucket-Versioning, was hier nicht gewünscht ist -
  # daher wird die 30-Tage-Löschung analog zur lokalen find-Zeile unten direkt hier nachgebildet.
  CUTOFF="$(date -d '30 days ago' +%Y-%m-%dT%H:%M:%S)"
  OLD_KEYS="$(AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3api list-objects-v2 --bucket "$S3_BACKUP_BUCKET" --endpoint-url "$S3_ENDPOINT_URL" \
    --query "Contents[?LastModified<='$CUTOFF'].Key" --output text)"
  if [ "$OLD_KEYS" != "None" ] && [ -n "$OLD_KEYS" ]; then
    for KEY in $OLD_KEYS; do
      AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
        aws s3 rm "s3://$S3_BACKUP_BUCKET/$KEY" --endpoint-url "$S3_ENDPOINT_URL"
      echo "Alte Off-Box-Kopie gelöscht: $KEY"
    done
  fi
fi

# 30 Tage Aufbewahrung (lokal - siehe oben für die S3-Aufbewahrung)
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +30 -delete
