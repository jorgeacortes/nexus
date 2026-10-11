#!/usr/bin/env bash
# Daily backup: snapshot ./data, compress it, and upload the archive to Cloudflare R2.
#
# Crontab example (03:10 every day). Give cron a PATH that includes node and fnox,
# and a FNOX_AGE_KEY / FNOX_AGE_KEY_FILE so secrets can be injected:
#
#   PATH=/usr/local/bin:/usr/bin:/bin
#   FNOX_AGE_KEY_FILE=/home/you/.config/fnox/age.key
#   10 3 * * * /home/sandbox/ws/biznagatec-ws/nexus/scripts/backup-data.sh >> /home/sandbox/.logs/nexus-backup.log 2>&1
#
# Flags are forwarded to the TypeScript script (e.g. --dry-run).

set -euo pipefail

NEXUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NEXUS_DIR"

if [[ -f "$NEXUS_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$NEXUS_DIR/.env.local"
  set +a
fi

FNOX_CMD=()
if command -v fnox >/dev/null 2>&1; then
  if [[ -n "${FNOX_AGE_KEY:-}" || -n "${FNOX_AGE_KEY_FILE:-}" ]]; then
    FNOX_CMD=(fnox exec --)
  else
    echo "warning: fnox found but FNOX_AGE_KEY / FNOX_AGE_KEY_FILE is unset; R2 secrets will not be injected" >&2
  fi
fi

TSX="$NEXUS_DIR/node_modules/.bin/tsx"
if [[ ! -x "$TSX" ]]; then
  echo "error: tsx not found at $TSX (run pnpm install first)" >&2
  exit 1
fi

exec "${FNOX_CMD[@]}" "$TSX" "$NEXUS_DIR/src/scripts/backup-data.ts" "$@"
