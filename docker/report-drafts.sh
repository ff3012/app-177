#!/bin/sh
# Triggers the Tätigkeitsbericht-Entwurf auto-creation: finds every GENEHMIGT VehicleBooking whose
# endsAt has already passed and that has no linked Report yet, and creates one Report(DRAFT) per such
# booking (see docker/README.md). Works unmodified for either stack - reads AUTH_URL/CRON_SECRET
# from whichever repo checkout's own .env it's run from. Add to crontab on the Hetzner host, every
# 15 minutes:
#   */15 * * * * /opt/app-177/docker/report-drafts.sh >> /var/log/ffapp-report-drafts.log 2>&1
#   */15 * * * * /opt/app-177-dev/docker/report-drafts.sh >> /var/log/ffapp-dev-report-drafts.log 2>&1
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

curl -fsS "${AUTH_URL}/api/cron/report-drafts?secret=${CRON_SECRET}"
echo
