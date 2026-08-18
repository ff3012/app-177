#!/bin/sh
# Triggers the 5-minute ICS calendar import sync (external calendars like Google Calendar into a
# Feuerwehr's own Kalender, see Organization.icsImportUrl). Add to crontab on the Hetzner host:
#   CRON_TZ=Europe/Vienna
#   */5 * * * * /opt/app-177/docker/kalender-ics-sync.sh >> /var/log/ffapp-kalender-ics-sync.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/kalender-ics-sync?secret=${CRON_SECRET}"
echo
