# Nexus

Personal agent operations console: one glanceable place to monitor AI coding
agents (pi, Claude Code, Cursor) and manage their work as tasks on a single
kanban board.

- **Board** — one board for everything; the project is a tag on the card. Status
  columns answer *why has work stopped?*, the **needs human** badge answers
  *whose court is the ball in?*
- **Agents** — live status from the Herdr socket, composed with the SQLite
  assignment (harness → model → effort). Cursor tasks show stored state only.
- **Inbox** — tasks awaiting you, agent-blocked suggestions, and a no-project
  triage list. Terminal harnesses can be unblocked with an `agent.prompt`.

`PLAN.md` is the product source of truth; `AGENTS.md` covers conventions.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3100, SQLite in ./data-dev
pnpm validate     # biome + typecheck + vitest
```

`pnpm dev` never touches the production database in `./data`.

## Deployment (Docker Compose)

```bash
pnpm docker:up    # build + start; serves http://localhost:3100
pnpm docker:down
```

- SQLite lives on the host at `./data/nexus.db`; migrations run before the
  server starts, and data survives `down && up`.
- `scripts/docker-up.sh` passes the host UID/GID (`PUID`/`PGID`) so bind-mounted
  WAL/SHM files stay writable by the host user.
- The host Herdr socket directory (`~/.config/herdr`, override with
  `HERDR_CONFIG_DIR`) is mounted read-only at `/herdr` and `HERDR_SOCKET` points
  the app at it.

## Herdr

Reads go over the socket (`session.snapshot`, CLI fallback); mutations
(`agent.prompt`) go over the socket. `herdr api schema --json` is the protocol
source of truth.
