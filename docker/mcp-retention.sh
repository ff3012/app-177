#!/bin/sh
# Triggers the daily MCP cleanup: audit log (180 days), expired/revoked OAuth tokens (30 days), old
# authorization codes and unused OAuth clients. Works unmodified for either stack - reads AUTH_URL/CRON_SECRET
# from whichever repo checkout's own .env it's run from. Add to crontab on the Hetzner host, daily:
#   15 5 * * * /opt/app-177/docker/mcp-retention.sh >> /var/log/ffapp-mcp-retention.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/mcp-retention?secret=${CRON_SECRET}"
echo
