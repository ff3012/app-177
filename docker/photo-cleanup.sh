#!/bin/sh
# Triggers the daily photo-cleanup: (1) deletes any complete Foto Upload - all its photos + S3
# objects, regardless of status - once older than 96h (storage-size cap, see docker/README.md),
# and (2) cleans up orphaned PENDING/UPLOADING photos (abandoned uploads where the client called
# presign but never finished the PUT/complete flow, or the complete step crashed before finalizing
# the status) between 24h and 96h old. Works unmodified for either stack - reads AUTH_URL/
# CRON_SECRET from whichever repo checkout's own .env it's run from. Add to crontab on the Hetzner
# host, daily:
#   CRON_TZ=Europe/Vienna
#   0 4 * * * /opt/app-177/docker/photo-cleanup.sh >> /var/log/ffapp-photo-cleanup.log 2>&1
#   0 4 * * * /opt/app-177-dev/docker/photo-cleanup.sh >> /var/log/ffapp-dev-photo-cleanup.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/photo-cleanup?secret=${CRON_SECRET}"
echo
