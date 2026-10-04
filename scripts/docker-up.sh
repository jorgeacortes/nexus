#!/usr/bin/env bash
# Runs docker compose with the host UID/GID so the container's `node` user owns
# the bind-mounted SQLite files (and can connect to the host Herdr socket).
#
# The published host port comes from HOST_PORT (default 3210); the container
# always listens on 3100. Set it inline or in a `.env` file next to this repo:
#   HOST_PORT=4000 pnpm docker:up
set -euo pipefail

export DOCKER_UID="${DOCKER_UID:-$(id -u)}"
export DOCKER_GID="${DOCKER_GID:-$(id -g)}"

exec docker compose "$@"
