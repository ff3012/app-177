#!/bin/sh
# Triggers the hourly Facebook feed fetch for the Dashboard Feuerwehrhaus (Issue #8). Add to
# crontab on the Hetzner host, hourly (CRON_TZ is honored by cronie/Debian's cron since ~2019):
#   CRON_TZ=Europe/Vienna
#   0 * * * * /opt/app-177/docker/facebook-fetch.sh >> /var/log/ffapp-facebook-fetch.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/facebook-fetch?secret=${CRON_SECRET}"
echo
