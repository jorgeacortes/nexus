#!/bin/sh
# Drop root to the host UID/GID so bind-mounted SQLite files (nexus.db plus
# WAL/SHM sidecars) stay owned by the user that runs the app on the host.
set -eu

PUID="${PUID:-${DOCKER_UID:-1000}}"
PGID="${PGID:-${DOCKER_GID:-1000}}"

mkdir -p /app/data /app/.next/cache

if [ "$(id -u)" = "0" ]; then
  if [ "$PUID" = "0" ]; then
    echo "warning: running as root (PUID=0); bind-mounted database files will be root-owned" >&2
    exec "$@"
  fi

  # Reuse the image's `node` account so we do not fight with a missing passwd entry.
  groupmod -o -g "$PGID" node >/dev/null
  usermod -o -u "$PUID" -g "$PGID" node >/dev/null

  chown -R node:node /app/data /app/.next/cache
  exec gosu node "$@"
fi

exec "$@"
