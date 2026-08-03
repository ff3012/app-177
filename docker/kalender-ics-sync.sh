#!/bin/sh
# Triggers the 5-minute ICS calendar import sync (external calendars like Google Calendar into a
# Feuerwehr's own Kalender, see Organization.icsImportUrl). Add to crontab on the Hetzner host:
#   CRON_TZ=Europe/Vienna
#   */5 * * * * /opt/app-177/docker/kalender-ics-sync.sh >> /var/log/ffapp-kalender-ics-sync.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/kalender-ics-sync?secret=${CRON_SECRET}"
echo
