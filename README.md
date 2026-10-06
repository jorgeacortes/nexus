# Nexus

Personal agent operations console: one glanceable place to monitor AI coding
agents (pi, Claude Code, Cursor, Agy) and manage their work as tasks on a single
kanban board.

- **Board** — one board for everything; the project is a tag on the card. Status
  columns answer *why has work stopped?*, the **needs human** badge answers
  *whose court is the ball in?*
- **Agents** — live status from the Herdr socket, composed with the SQLite
  assignment (harness → model → effort). Cursor tasks show stored state only.
  Agy (Antigravity) is a terminal harness: `agy` panes are monitored and
  promptable like pi and Claude Code.
- **Servers** — what is listening on the host: port, protocol, bind address
  (loopback vs all interfaces), owning process/PID, and uptime, read from the
  host's procfs and refreshed every 5 seconds. Nexus' own ports are marked, the
  list is filterable by port, process, pid, or address, and a service that stops
  drops off on the next tick.
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
(`src/cli/nx.ts`): it works from any cwd — including inside a Herdr pane — and
never opens the database itself.

Install the wrapper on `PATH` once:

```bash
ln -sf ~/ws/biznagatec-ws/nexus/scripts/nx ~/.local/bin/nx
```

### Which board?

The board URL is resolved in this order, and the winner is always reported:

1. `NEXUS_URL`;
2. `NEXUS_URL` from the machine config `~/.config/nexus/env` (or
   `$XDG_CONFIG_HOME/nexus/env`) — a `KEY=value` file that may use `export`:
   `NEXUS_URL=http://localhost:3210`;
3. a probe of the local ports, deployed container first: `HOST_PORT` (default
   `3210`), then `http://localhost:3100` (the dev server). Override the list with
   `NEXUS_CANDIDATES="http://host:port,..."`.

So a bare `nx claim` works from an agent pane that has no `NEXUS_URL` set, and it
says which board it reached: `nx: board http://localhost:3210 · /app/data/nexus.db
· 12 tasks / 3 projects — probed; pin it with NEXUS_URL or ~/.config/nexus/env`.
Because a probed board is a guess, a write to a probed board that has no projects
is refused (`--force` overrides): that is the empty `./data-dev` trap — the dev
database holds no projects, so a bare write there would silently land on a board
you never look at. Pin the URL for day-to-day use, and check what answered with:

```bash
nx ping        # the board in use, or a non-zero exit when none answers
nx doctor      # every candidate, what answered, and what is suspicious
```

```bash
nx project add "crm development" --folder ~/ws/biznagatec-crm --workspace wP
nx project edit "crm development" --workspace wW   # repoint a dead workspace (`-` clears it)
nx project list
nx task add "crm development" "Implement TAVILY support" --status ready
nx task list [project] [--status ready] [--sort activity|priority]
nx task show <id>
nx claim <id>                   # this Herdr pane claims the task
nx done <id> --notes "commit abc123"
nx need <id> --reason "waiting on the Stripe key"
nx assign <id> --to auto      # push the task's prompt into an idle pane
nx board --watch
```

Every command accepts `--json`, and a task id may be abbreviated to any unique
prefix. `nx project edit <name|id> [--name] [--folder] [--workspace]` is the
supported way to change a project's folder or Herdr workspace (wrapping
`PATCH /api/projects/<id>`); `--folder -` / `--workspace -` clears the field. A
dangling `herdrWorkspaceId` a project still points at is also repaired by
dispatch when it resolves the project's workspace, so a closed Herdr workspace
never strands the project. Agents read their own identity from `$HERDR_PANE_ID`
— it is never typed.
`nx done --notes` is stored on the task (`tasks.completion_notes`) and shown in
the card's detail panel next to the claim/completion timestamps. `nx board` and
`nx task show` name the board they read, so two instances can never be confused.

### Agent skill

The convention agents follow is packaged as a skill at `skills/nx-tasks/SKILL.md`.
Install it for every harness on the machine — pi, Cursor, and Agy read
`~/.agents/skills` natively, Claude Code needs the link:

```bash
ln -sfn ~/ws/biznagatec-ws/nexus/skills/nx-tasks ~/.agents/skills/nx-tasks
~/.agents/link.sh
```

### `nx board` — the live join

`nx board` renders tasks (SQLite, via the API) next to the live Herdr agents:
project · agent pane · live status · the task the pane claimed · its status · the
agent's current topic. A task another pane pinned as `[#<id>]` shows up as a
display-only hint (marked `~`); unclaimed non-done tasks get their own row. It is
read-only and never writes. It degrades to task state only when Herdr is down.

```bash
nx board              # one frame
nx board --watch      # re-render every 10 seconds
nx board --watch 5    # every 5 seconds
```

### Mission control (manual, once)

Host the board in its own Herdr workspace so it is always one glance away:

```bash
herdr workspace create --label mission-control --cwd ~/ws/biznagatec-ws/nexus --focus
# in the new pane:
nx board --watch
```

`$HERDR_PANE_ID` inside that pane belongs to the board, not to an agent, so the
board will not try to claim work for it.

### `nx assign` — the declarative push into an existing pane

`nx assign <id> --to <pane-id>` injects a short instruction into that Herdr pane
(through `agent.prompt`, server-side): claim the task, work it, complete it. The
task immediately records the pane and agent as its assignment pointers, so the
board reflects it on the next frame.

```bash
nx assign 42 --to wP:p4   # a specific pane always wins
nx assign 42 --to auto    # idle pane whose cwd is inside the task's project folder
```

`auto` never crosses projects: with no idle agent under the project folder it
exits non-zero with the folder it looked in. It never creates a pane or a tab —
use `nx dispatch` when the topology may not exist yet.

### `nx dispatch` — start work, and close it safely

`nx dispatch <task>` is the dispatcher: it **leases** the task (one agent per
task), resolves the project's Herdr workspace — creating it and repairing the
project's link when it is missing — places the agent (reusing a bare shell pane in
the project folder, otherwise a new tab), starts it, hands it the dispatch brief,
and records the pane on the task.

```bash
nx dispatch 42                 # lease → ensure workspace → place → start agent → assign
nx dispatch close wR:t7        # the sanctioned way to close a harness tab
nx dispatch detect             # flag dispatched agents that vanished without finishing
```

`nx dispatch close` refuses, non-zero, naming the pane, its agent and its status,
while **any** pane in the tab still holds live work: an agent that is
`working`/`blocked`/`unknown`, an `idle` agent whose task is not `done`, or a
foreground process. Herdr has no pre-close hook, so a raw `herdr tab close` cannot
be blocked — the guard covers the `nx` path only, and closing a workspace's **last**
tab destroys the workspace. Flow and rationale: `DESIGN-dispatch.md`.

There is still **no dispatcher daemon**: `nx dispatch` is one-shot, and nothing
decides *when* to dispatch yet (the jobs table + `nx job tick` are not built).

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
- The container runs with `pid: host` and a minimal capability set
  (`SYS_PTRACE`, `DAC_OVERRIDE`, `apparmor=unconfined`) so the **Servers** screen
  can read the host's listening sockets from `/proc` and name the owning process
  (the container's own `/proc/net` only shows the container). The entrypoint
  re-grants the two capabilities as ambient ones to the unprivileged app user, so
  the SQLite files stay host-owned. Drop the `cap_add`/`security_opt` lines and
  the screen still works, with the process/PID columns empty. See `AGENTS.md` →
  "Host listeners".

## Herdr

Reads go over the socket (`session.snapshot`, CLI fallback); mutations
(`agent.prompt`) go over the socket. `herdr api schema --json` is the protocol
source of truth.
