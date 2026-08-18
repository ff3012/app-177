#!/bin/sh
# Triggers the daily cleanup of orphaned PENDING Einsatzfotos (abandoned uploads where the client
# called presign but never finished the PUT/complete flow) older than 24h. Add to crontab on the
# Hetzner host, daily:
#   CRON_TZ=Europe/Vienna
#   0 4 * * * /opt/app-177/docker/incident-photo-cleanup.sh >> /var/log/ffapp-incident-photo-cleanup.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/incident-photo-cleanup?secret=${CRON_SECRET}"
echo
