# HANDOFF — Phase 6: Herdr-first task assignment and visualization

Companion to `HANDOFF.md` (Phases 1–5, implemented). Read that first for conventions,
then `AGENTS.md` and `PLAN.md`. **This document covers the next increment only.**

## Intent and requirements

Nexus is deployed and works: projects and tasks are created and visualized on the
kanban, and agent live state is monitored from the Herdr snapshot. What is missing is
the **workflow that connects tasks to agents**. The operator's intent, settled after
reviewing alternatives (dispatcher push, agent pull, hybrid transport):

1. **Nexus remains the single source of truth for projects and tasks.** The kanban,
   statuses, needs-human flow, and REST routes stay as they are. We are not moving
   task management into the terminal.
2. **The assignment flow is driven from Herdr first.** The operator lives in Herdr
   panes. Creating tasks and assigning them must work as a natural part of the
   conversation with an agent, or as one command typed in a pane — not as buttons in
   a web UI. The web interface stays functional but is secondary for this flow.
3. **No dispatcher daemon.** No poller, no queue, no background scheduler. Assignment
   is either conversational (the agent claims work itself) or declarative (one CLI
   command pushes a prompt into a pane). A daemon can be added later as a thin loop
   over the same CLI; it is explicitly out of scope.
4. **Visualization is a first-class outcome.** The operator wants a glanceable board —
   per project: which agent pane, live agent status, which task it claimed, what it is
   doing — rendered inside Herdr, and the same join available in the web UI later.
5. **Write-back by agents is the bookkeeping mechanism.** Agents claim and complete
   tasks through Nexus's API. This keeps status truthful without any scraping or
   guessing. The agent's identity (which pane it is) is auto-detected, never typed.

### Non-goals (for this phase)

- No auto-dispatch of UI-created tasks (no cron, no watcher). `nx assign` is manual.
- No per-agent personas, skills, or model routing beyond what already exists.
- No new Herdr protocol work — we consume the existing CLI/socket only.
- No changes to the kanban's status vocabulary or the needs-human flow.

## Current state (what exists and can be reused)

- Repo: `~/ws/biznagatec-ws/nexus`, clean tree at `623fa20`. Phases 1–5 done:
  domain + REST routes, kanban UI, agent monitoring (`/api/herdr/snapshot`),
  needs-human inbox with unblock-via-prompt, Docker Compose deployment.
- `src/domain/tasks/task.ts`: `TASK_STATUSES = ["backlog", "ready", "in_progress",
  "blocked", "done"]`, `ASSIGNEE_TYPES = ["me", "agent"]`.
- `src/application/tasks/assign-task/`: stores assignment pointers (`assignee`,
  `agentName`, `harness`, `model`, `effort`, `herdrPaneId`) on a task.
- `src/domain/tasks/agent-prompt.ts`: `AgentPromptPort` — prompt a pane over the
  Herdr socket (terminal harnesses only). Already implemented and used by the
  resolve/unblock route (`src/app/api/tasks/[id]/resolve/route.ts`).
- Schema: `projects` (has `folderPath`, `herdrWorkspaceId`) and `tasks`
  (`status`, `assignee`, `agentName`, `harness`, `model`, `effort`, `herdrPaneId`,
  `needsHuman` + reason, timestamps). No claim/completion timestamps yet.
- **Herdr sets environment variables in every pane it hosts** (verified live):
  `$HERDR_PANE_ID`, `$HERDR_TAB_ID`, `$HERDR_WORKSPACE_ID`, `$HERDR_SOCKET_PATH`,
  `$HERDR_BIN_PATH`. An agent claiming a task can therefore identify its own pane
  with zero configuration.
- Live snapshot shape (read path, already adapted in `src/infrastructure/herdr/`):
  `herdr api snapshot` → `{ result: { snapshot: { agents, panes, tabs, workspaces } } }`;
  each agent entry carries `agent`, `agent_status` (`idle|working|blocked|done|unknown`),
  `cwd`, `pane_id`, `tab_id`, `workspace_id`, `terminal_title`, `tokens.quota_topic`.
- Commands available over the CLI (`herdr agent/pane/workspace/tab ...`) and the full
  socket API: `herdr api schema --json`.

## Your task

Implement phases 6.1–6.5 in order. Commit one logical commit per coherent unit.

### 6.1 — Claim / complete transitions (API + domain)

Atomic, guarded status transitions that agents (and the operator) call over HTTP.

- New use cases in `src/application/tasks/`:
  - `claim-task`: allowed from `backlog` and `ready` only. Sets `status = in_progress`,
    `assignee = "agent"`, and, when the caller is an agent pane, `agentName` and
    `herdrPaneId` from the request. Idempotent claim already in progress by the same
    pane returns the task unchanged; a claim on a task that is `in_progress` under a
    *different* pane returns a domain error (`TaskAlreadyClaimedError`).
  - `complete-task`: allowed from `in_progress` (also from `blocked` to force-close).
    Sets `status = done`, clears `needsHuman`, records timestamps.
- New REST routes next to the existing `[id]/resolve` route:
  - `POST /api/tasks/[id]/claim` — body: `{ paneId?, agentName?, harness? }`. When the
    body omits `paneId`, the route falls back to `$HERDR_PANE_ID` (agents always have
    it set; the web UI always sends explicit values, so it never picks up a random
    pane).
  - `POST /api/tasks/[id]/complete` — body: `{ notes? }` (notes appended to the task
    description or stored in a new `completion_notes` column — your call, document it).
- Schema migration: add nullable `claimed_at` and `completed_at` text columns to
  `tasks` (drizzle-kit generate; follow the existing `0000` migration style). Update
  the board UI to surface these where natural (e.g. "claimed 12m ago").
- Transition rules live in the domain (`src/domain/tasks/task.ts`), not in routes —
  mirror how status validation is already handled there.

### 6.2 — The `nx` CLI

A thin, always-available command surface for the operator and the agents. It is an
**HTTP client only** — it never imports SQLite or the application layer, so it works
from any cwd, inside or outside the container, and cannot corrupt the DB.

- Location: `src/cli/nx.ts` (no framework, plain `process.argv` parsing — do not add a
  CLI dependency). Runs with `tsx`; expose it on `PATH` via a wrapper script committed
  to the repo and installed manually by the operator:
  `~/.local/bin/nx` → `exec pnpm --dir ~/ws/biznagatec-ws/nexus exec tsx src/cli/nx.ts "$@"`.
- Base URL: `NEXUS_URL` env (default `http://localhost:3100`).
- Commands (output: human table by default; `--json` everywhere for scripting):
  - `nx project add <name> [--folder <path>] [--workspace <herdr-workspace-id>]`
  - `nx project list`
  - `nx task add <project> "<title>" [--description <text>] [--status backlog|ready]`
  - `nx task list [project] [--status <status>]`
  - `nx task show <id>`
  - `nx claim <id>` — calls claim, auto-fills pane/agent name from `$HERDR_PANE_ID`
    and `$HERDR_AGENT` (fallback: `$HERDR_TAB_ID`)
  - `nx done <id> [--notes <text>]`
  - `nx board` — see 6.4
  - `nx assign <id> --to <pane-id|auto>` — see 6.5
- Errors: non-zero exit with a short message on the domain errors (404, already
  claimed, invalid transition). No stack traces in the terminal output.

### 6.3 — Pi skill so agents use it conversationally

The conversational assignment mode only works if agents know the convention.

- Add a pi skill in the Nexus repo (`skills/nx-tasks/SKILL.md`) documenting: when the
  operator says "take task #N" / "work the board" / "what's left on <project>", the
  agent runs `nx task list`, `nx claim <id>`, does the work, then `nx done <id>`
  (with the commit or artifact referenced in `--notes`).
- Rule of thumb baked into the skill: **always claim before starting, always `done`
  when finished, never edit task rows directly.** If a task turns out to need the
  operator, set `needs_human` via `POST /api/tasks/[id]/needs-human` (route exists
  from Phase 4) instead of dropping status.
- Keep the skill short (~40 lines). It is a convention document, not documentation.

### 6.4 — `nx board` (the visualization)

- `nx board` renders the join of **tasks (SQLite, via API)** × **agents (live Herdr
  snapshot via `/api/herdr/snapshot`)**. It is read-only.
- Join rules:
  - A task claimed by a pane links to that agent row via `herdrPaneId` (primary).
  - Unclaimed ready tasks associate to a project by `projects.folderPath` matching
    the agent pane's `cwd` (fallback display only, never a write).
  - Optional association aid: if an agent's `terminal_title`/topic matches
    `[#<id>]` (agents are asked to prefix work with the task id), show the
    association as a hint. This is a display heuristic, never persisted.
- Columns: `PROJECT · AGENT (pane) · LIVE STATUS · TASK · TASK STATUS · TOPIC/NOTES`.
  Sort by project, then agent status (`working` first). Follow the layout discipline
  of the `herdr-workspaces` table (width-bounded, grouped, blank cells left empty).
- `nx board --watch [interval]` re-renders on an interval (default 10s; plain loop,
  clear screen between frames).
- The operator hosts it in a dedicated Herdr workspace (e.g. `mission-control`) with
  the board running via `nx board --watch`. Setting this workspace up is manual, but
  document the exact steps (workspace create, pane split, command to run) in the
  README of this phase.

### 6.5 — `nx assign` (the declarative push, the only Herdr-coupled command)

- New use case + route: `POST /api/tasks/[id]/dispatch` with body `{ paneId }` or
  `{ target: "auto" }`. Server-side: resolve the pane, build the prompt, and call the
  existing `AgentPromptPort`. The CLI stays a plain HTTP client.
- Prompt template (server-side constant, keep it in the tasks domain so the web UI
  and CLI share it): a compact instruction that names the task id, tells the agent to
  claim it first (`nx claim <id>`), work it, and complete it (`nx done <id>`),
  mirroring the skill in 6.3.
- `--to auto` resolution (server-side): among live agents with status `idle`, pick
  the one whose `cwd` sits inside the task's project `folderPath`; if none, error
  with a clear message (no silent cross-project dispatch). `--to <pane-id>` always
  wins over auto.
- On successful dispatch the use case sets `herdrPaneId` + `agentName` on the task
  (assignment pointers, same as the existing assign use case) and returns the task —
  the board reflects it immediately.

## Hard rules

- **SQLite owns assignments; Herdr owns live state** — unchanged from Phase 1.
  `herdrPaneId` is a loose pointer, never a foreign key; never store live status.
- **The CLI is an HTTP client only.** No direct DB access from `src/cli/`.
- **No dispatcher daemon, no polling loop in the server.** The only background-ish
  thing in this phase is the operator-launched `nx board --watch`.
- **Claim/complete transitions are guarded in the domain**, not in routes or CLI.
- **Hexagonal boundaries unchanged**: domain → application → infrastructure → routes;
  Herdr access only via the existing port(s) in `src/infrastructure/herdr/`.
- Next.js 16: read `node_modules/next/dist/docs/` guides before writing routes.
- Do not touch `~/ws/biznagatec-crm/webapp`. No new dependencies without need.

## Definition of done (per change)

```bash
pnpm validate        # biome + typecheck + vitest — the only gate
pnpm dev             # boots; the touched screen/route works against real data
```

Final acceptance:

- [ ] An agent can claim and complete a task end-to-end: `nx claim 42` → work →
      `nx done 42`, and the kanban reflects it
- [ ] Double-claim protection verified (second claim on an in-progress task errors)
- [ ] `nx assign <id> --to <pane>` injects the prompt into the right Herdr pane and
      the agent starts working the task; `--to auto` picks the idle pane in the
      project folder or fails loudly
- [ ] `nx board` (and `--watch`) shows the real join: projects, live agent states,
      claimed tasks, topics — verified against the live Herdr session
- [ ] A task created via the web UI can be assigned from Herdr with `nx assign`, and
      a task created via `nx task add` appears on the kanban
- [ ] `pnpm validate` green; work committed one logical unit per commit
- [ ] README section for this phase: how to install the `nx` wrapper, how to host the
      mission-control board workspace, and the agent conversational conventions

## Working notes

- pnpm 10.29.3, Node ≥ 22; run `pnpm install` before anything.
- Herdr env in panes: `$HERDR_PANE_ID`, `$HERDR_TAB_ID`, `$HERDR_WORKSPACE_ID`,
  `$HERDR_SOCKET_PATH`, `$HERDR_BIN_PATH`, `$HERDR_ENV=1`. Never hardcode ids.
- Socket: `~/.config/herdr/herdr.sock` (JSON-RPC, protocol 22). Server-side prompt
  sending must go through `AgentPromptPort`, not raw socket calls.
- Docker note: the compose file already mounts the Herdr socket read-only and sets
  `HERDR_SOCKET_PATH`; `nx assign` therefore works against the containerized Nexus
  too, as long as it runs on the operator's machine (the CLI targets `NEXUS_URL`).
- Snapshot fields worth using (verified live): `agent_status`, `cwd`, `pane_id`,
  `workspace_id`, `terminal_title`, `tokens.quota_topic` (the agent's current topic —
  good enough for the TOPIC column), `tokens.quota_provider_model`.
- When testing claim/assign, use a scratch project and a scratch task; do not leave
  test rows in `./data/nexus.db`.
