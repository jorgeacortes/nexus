#!/usr/bin/env bash
# Runs docker compose with the host UID/GID so the container's `node` user owns
# the bind-mounted SQLite files (and can connect to the host Herdr socket).
set -euo pipefail

export DOCKER_UID="${DOCKER_UID:-$(id -u)}"
export DOCKER_GID="${DOCKER_GID:-$(id -g)}"
export HERDR_CONFIG_DIR="${HERDR_CONFIG_DIR:-$HOME/.config/herdr}"

exec docker compose "$@"
