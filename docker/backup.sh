#!/bin/sh
# Nightly Postgres backup. Add to crontab on the Hetzner host, e.g.:
#   0 3 * * * /opt/app-177/docker/backup.sh >> /var/log/ffapp-backup.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

# .env values aren't guaranteed valid shell syntax (e.g. MAILJET_FROM_NAME's unquoted
# "AFKDO Purkersdorf (TEST)" on dev breaks a naive `. ./.env` sourcing with "Syntax error:
# "(" unexpected") - parse KEY=VALUE lines directly instead of executing the file as shell code.
while IFS='=' read -r key value; do
  case "$key" in
    ''|'#'*) continue ;;
  esac
  value="${value%\"}"
  value="${value#\"}"
  export "$key=$value"
done < .env

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

# 30 Tage Aufbewahrung (lokal). Bewusst VOR dem S3-Teil: dessen Fehler dürfen sie nie verhindern.
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +30 -delete

# Löscht Off-Box-Kopien, die laut Dateiname (db-JJJJ-MM-TT_HHMM.sql.gz bzw. config-JJJJ-MM-TT_HHMM.tar.gz)
# älter als 30 Tage sind. Fremde Dateien im Bucket werden nie angefasst. Rückgabe != 0, wenn die Liste
# nicht gelesen werden konnte; ein einzelnes fehlgeschlagenes Löschen ist nur eine Warnung.
s3_retention() {
  CUTOFF_NUM="$(date -d '30 days ago' +%Y%m%d)"
  S3_LISTING="$(AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 ls "s3://$S3_BACKUP_BUCKET/" --endpoint-url "$S3_ENDPOINT_URL")" || return 1
  echo "$S3_LISTING" | while read -r _ _ _ KEY; do
    case "$KEY" in
      db-*.sql.gz|config-*.tar.gz) ;;
      *) continue ;;
    esac
    KEY_DATE="${KEY#*-}"
    KEY_DATE="${KEY_DATE%%_*}"
    KEY_NUM="$(printf '%s' "$KEY_DATE" | tr -d '-')"
    case "$KEY_NUM" in
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
      *) continue ;;
    esac
    if [ "$KEY_NUM" -lt "$CUTOFF_NUM" ]; then
      if AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
        aws s3 rm "s3://$S3_BACKUP_BUCKET/$KEY" --endpoint-url "$S3_ENDPOINT_URL"; then
        echo "Alte Off-Box-Kopie gelöscht: $KEY"
      else
        echo "WARNUNG: Alte Off-Box-Kopie nicht gelöscht: $KEY" >&2
      fi
    fi
  done
}

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
  # daher wird die 30-Tage-Löschung analog zur lokalen find-Zeile (siehe oben) direkt hier nachgebildet.
  #
  # Fehler dabei (2026-11): `aws s3api list-objects-v2` stürzte auf dem Server (aws-cli 2.31.35 mit
  # System-Python 3.14) jede Nacht mit "badly formed help string" ab; wegen `set -e` endete das Skript
  # hier, die Aufbewahrung lief weder in S3 noch lokal. Deshalb: nur `aws s3 ls`/`aws s3 rm` (derselbe
  # Codepfad wie das funktionierende `aws s3 cp`), das Alter kommt aus dem Dateinamen, und ein Fehler
  # in der Aufbewahrung bricht das Skript nie ab (nur Warnung auf stderr).
  if ! s3_retention; then
    echo "WARNUNG: S3-Aufbewahrung (30 Tage) konnte nicht ausgeführt werden." >&2
  fi
fi
