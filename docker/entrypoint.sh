#!/bin/sh
set -e

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

# The shell auto-exports HOSTNAME as the container's own hostname (its short container ID).
# Next.js's standalone server.js does `hostname = process.env.HOSTNAME || '0.0.0.0'` and binds
# to exactly that address instead of falling back - fine for a container on a single Docker
# network (that hostname resolves to its only IP anyway), but on a container attached to two
# networks (e.g. the dev stack's app service, also joining the shared caddy_net) it silently
# binds to only one of them. A reverse proxy reaching it via the other network's alias then gets
# "connection refused" even though the app logs "Ready". Unsetting it here restores the
# '0.0.0.0' fallback so the server always listens on every interface.
unset HOSTNAME
exec "$@"
