#!/bin/sh
set -e

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

exec "$@"
