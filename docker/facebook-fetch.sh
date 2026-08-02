#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./.env
curl -fsS "${AUTH_URL}/api/cron/facebook-fetch?secret=${CRON_SECRET}" >> docker/facebook-fetch.log 2>&1
