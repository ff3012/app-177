#!/bin/sh
# Triggers the 14-Tage-Aufbewahrung für Tätigkeitsberichte: löscht jeden abgegebenen Bericht
# (SUBMITTED), dessen submittedAt länger als 14 Tage zurückliegt, inkl. des gespeicherten PDFs aus
# S3, sowie jeden Entwurf (DRAFT), dessen createdAt länger als 14 Tage zurückliegt (siehe
# docker/README.md). Works unmodified for either stack - reads AUTH_URL/CRON_SECRET from whichever
# repo checkout's own .env it's run from. Add to crontab on the Hetzner host, once daily:
#   0 5 * * * /opt/app-177/docker/report-retention.sh >> /var/log/ffapp-report-retention.log 2>&1
#   0 5 * * * /opt/app-177-dev/docker/report-retention.sh >> /var/log/ffapp-dev-report-retention.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/report-retention?secret=${CRON_SECRET}"
echo
