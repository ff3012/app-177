#!/bin/sh
# Triggers the daily system-check email. Add to crontab on the Hetzner host, daily at 09:00
# Vienna time (CRON_TZ is honored by cronie/Debian's cron since ~2019, handles CET/CEST DST
# automatically instead of drifting with a fixed UTC offset):
#   CRON_TZ=Europe/Vienna
#   0 9 * * * /opt/app-177/docker/system-check-email.sh >> /var/log/ffapp-system-check.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/system-check?secret=${CRON_SECRET}"
echo
