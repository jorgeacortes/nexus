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
- **`nx` CLI** — create, claim, and complete tasks from any Herdr pane or from
  an agent's conversation; a thin HTTP client over the same API.

`PLAN.md` is the product source of truth; `AGENTS.md` covers conventions.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3100, SQLite in ./data-dev
pnpm validate     # biome + typecheck + vitest
```

`pnpm dev` never touches the production database in `./data`. Override the dev
port with `PORT`: `PORT=3211 pnpm dev`.

## The `nx` CLI

`nx` is the Herdr-first way to create and run work. It is a thin HTTP client
(`src/cli/nx.ts`) against `NEXUS_URL` (default `http://localhost:3100`): it works
from any cwd — including inside a Herdr pane — and never opens the database
itself.

Install the wrapper on `PATH` once:

```bash
ln -sf ~/ws/biznagatec-ws/nexus/scripts/nx ~/.local/bin/nx
```

```bash
nx project add "crm development" --folder ~/ws/biznagatec-crm --workspace wP
nx project list
nx task add "crm development" "Implement TAVILY support" --status ready
nx task list [project] [--status ready]
nx task show <id>
nx claim <id>                   # this Herdr pane claims the task
nx done <id> --notes "commit abc123"
nx need <id> --reason "waiting on the Stripe key"
```

Every command accepts `--json`, and a task id may be abbreviated to any unique
prefix. Agents read their own identity from `$HERDR_PANE_ID` — it is never typed.

## Deployment (Docker Compose)

```bash
pnpm docker:up    # build + start; serves http://localhost:3210
pnpm docker:down
```

The container always listens on **3100**; the **published host port** is
`HOST_PORT` (default **3210**, so it does not collide with the dev server or the
CRM on 3000). Override it inline or in a `.env` file (see `.env.example`):

```bash
HOST_PORT=4000 pnpm docker:up          # one-off
BIND_ADDRESS=127.0.0.1 pnpm docker:up  # bind loopback only
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
