#!/bin/sh
# Triggers the scheduled-News dispatch. Add to crontab on the Hetzner host, e.g. every 5 minutes:
#   */5 * * * * /opt/ffapp/docker/send-scheduled-news.sh >> /var/log/ffapp-news.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/send-scheduled-news?secret=${CRON_SECRET}"
echo
