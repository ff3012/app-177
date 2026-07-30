#!/bin/sh
# Triggers the scheduled-News dispatch. Add to crontab on the Hetzner host, e.g. every 5 minutes:
#   */5 * * * * /opt/ffapp/docker/send-scheduled-news.sh >> /var/log/ffapp-news.log 2>&1
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

curl -fsS "${AUTH_URL}/api/cron/send-scheduled-news?secret=${CRON_SECRET}"
echo
