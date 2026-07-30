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

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/system-check?secret=${CRON_SECRET}"
echo
