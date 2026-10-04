# Nexus — implementation plan

Personal agent operations console: monitor AI coding agents, and manage and visualize their work as tasks on one kanban board.

This is the single source of truth for the project's product decisions and implementation order. No code exists beyond the bootstrap commit (`7ad5bf2`: Next.js skeleton, `tasks` SQLite schema, Herdr client); implementation starts at Phase 1 below. Decisions listed here are approved and final unless changed by the operator.

## Intent, goals, and constraints

**Intent.** The operator runs several AI coding agents across multiple harnesses (pi, Claude Code, Cursor, Agy) inside Herdr, one workspace per project (crm development, linkedin posts, nagabot development, proposal creation…), each project living in its own folder. Today, monitoring what agents are doing means inspecting Herdr directly, and the work to be done lives in scattered lists. Nexus exists to give one glanceable place for both.

**Goals.**
1. **Monitor agents:** see every agent across harnesses and what it is doing right now (working/idle/blocked, current task, live titles).
2. **Manage and visualize work:** one kanban board of tasks with status, the project as a tag, the assignee (agent or the operator), and a clear signal for tasks needing human action.

**Non-goals.** Multi-user support, authentication, hosting for teams, mobile apps, task automation itself (Nexus observes and dispatches; it does not execute work), integrations beyond Herdr for now.

**Constraints.**
- **Personal project:** single operator, single machine; no auth, no multi-tenancy.
- **No scalability scaffolding** (pagination, caching layers, role models) unless a real need appears.
- **Local-first data:** SQLite file in `./data/nexus.db`; Herdr state stays on-machine via its socket API.
- **Operator is the developer:** simplicity and low ceremony beat configurability; hand-maintained lists are acceptable.
- **Docker Compose is the only deployment path.** Production runs via `docker compose up` with a multi-stage Dockerfile and the SQLite directory bind-mounted from the host; bare `next start` on the host is not a supported deployment.

## Approved decisions

1. **Personal use only.** One user, one machine, no auth, no multi-tenancy, no scalability scaffolding (pagination, caching layers, role models) unless a real need appears.
2. **One kanban board for everything.** No board-per-project. The project is a **tag on the card**.
3. **Two-level model: Project → Tasks.** The card is the **task**: an actionable unit ("implement TAVILY support", "refine post on Y", "validate Z"), done by one actor — an agent **or the operator**. The project is the stable container ("crm development", "linkedin posts", "nagabot", "proposals") that holds many tasks.
4. **Each project lives in one folder.** `folder_path` on the project (e.g. `~/ws/biznagatec-crm`), nullable. The Herdr workspace link (`herdr_workspace_id`) is separate and optional: a project may have a folder but no Herdr workspace, or vice versa.
5. **Multiple agent harnesses.** The operator runs **pi, Claude Code, Cursor, and Agy (Antigravity)**. Every agent assignment records harness, model, and effort. **Effort is a property of the model, not the harness** — a model owns its effort vocabulary, and the harness declares which of those efforts it exposes for that model (e.g. GPT-5 `xhigh` vs a Claude model's `medium`/`high`; agy's `gemini-3.8-flash` has no `minimal`, while pi's model of the same name does). Assignment records a `(model, effort)` pair; the harness only constrains which models are offered and which of a model's efforts are selectable.
6. **Herdr is best-effort live state, not the registry.** Herdr sees terminal harnesses (pi, Claude Code, Agy) but **not Cursor** (GUI). Harness/model/effort assigned to a task live in SQLite; live status (working/idle/blocked, terminal titles) is read from Herdr when the harness is visible there, and absent for Cursor.
7. **Assignment lives on the task** as nullable columns (no history table): `assignee = me | agent | null` plus, when agent: `agent_name`, `harness`, `model`, `effort`, optional `herdr_pane_id` live link. Loose pointers, not foreign keys into Herdr.
8. **Tasks without a project are allowed** (nullable `project_id`) — a dump-and-triage inbox.
9. **Models registry is a static TypeScript constant** (`harness → model → supported efforts`), hand-maintained in the codebase; it drives UI dropdowns and validates the `(model, effort)` pair. Adding a model means editing the file — nothing is auto-discovered.
10. **Two orthogonal axes on every card:**
    - `status` answers "why has work stopped?" — task-level. `blocked` means the task cannot move forward right now, whatever the cause (cron, deploy, another task, a missing key). It says nothing about who acts next.
    - `needs_human` answers "whose court is the ball in?" — operator-level flag, orthogonal to status. It can sit on `in_progress` (agent paused awaiting input), on `blocked` (agent hit a wall needing a decision), or on `done` (awaiting review). Set manually, or auto-suggested when the linked Herdr agent reports `blocked`; never derived from task status alone. No `review` column.
11. **The board address is resolved, never assumed.** Two boards exist one port apart (deployed container on `HOST_PORT`, default 3210, against `./data`; dev server on 3100 against `./data-dev`, empty), so `nx` resolves in the order `NEXUS_URL` → `~/.config/nexus/env` → probe of the local ports, always reports which board answered, and refuses writes to a *probed* board that has no projects unless `--force`. Identity comes from `/api/instance` (database file + counts), so the caller can prove which instance it reached; a board without that route still works, with identity unknown. No magic port fallback beyond the ordered probe, and no second source of truth for the URL in docs or wrappers.
12. **`agent_name` is the live Herdr agent kind; the pane is the source of identity.** When a task is claimed or dispatched, Nexus resolves the pane from the same Herdr snapshot the board reads and records `agent_name` (the kind Herdr reports — `pi`, `claude_code`, `cursor`, or a kind the registry does not map, e.g. `codex`) plus the mapped `harness`. A pane Herdr does not report as a live agent — a bare shell, a closed pane — or Herdr being unreachable, leaves both null (the card falls back to "Agent") and never fails a claim. A Herdr tab/pane id is never an agent name: the domain rejects a value shaped like `wR:t2`, and `agentIdentityForPane` is the only writer of the field on the claim and dispatch paths. A model belongs to the harness it was chosen for, so dispatching to a pane whose harness cannot run the recorded model drops the `(model, effort)` pair.

### The model

```text
Project (folder + optional Herdr workspace; the tag)
   └── N Tasks (kanban cards)
         └── assignee: you | one agent | nobody
               └── when agent: harness → model → effort (valid pair)
```

**`projects`**
- `id`, `name`, `folder_path` (nullable), `herdr_workspace_id` (nullable), `created_at`

**`tasks`**
- `id`, `project_id` (nullable), `title`, `description`
- `status`: `backlog | ready | in_progress | blocked | done`
- `assignee`: `me | agent | null`
- when `assignee = agent`: `agent_name` (nullable; the live Herdr agent kind — `pi`, `claude_code`, `cursor`, `agy`, or an unmapped kind — never a Herdr tab id), `harness` (nullable; `pi | claude_code | cursor | agy`), `model` (nullable text, e.g. `sonnet-5.5`), `effort` (nullable text, validated against the model per the registry), `herdr_pane_id` (nullable live link)
- `needs_human` + `needs_human_reason`
- `created_at`, `updated_at`

### Accepted trade-offs

- Assignment can go stale if a pane dies or you reassign; the fix is one field update, and live truth stays in Herdr where visible.
- Model/effort recorded at assignment time; mid-task changes lag until updated. Activity log can come later if wanted.
- 1 task : 1 project assumption could break (task spanning two projects) — ignore until it happens; escape hatch is splitting the task.
- Kanban value depends on keeping cards finishable; epics live on the project, steps are cards. Usage discipline, not schema.

### Rejected alternatives (do not revisit without new information)

- "Objective" cards with agents derived from the workspace (conflates levels; the card is the actionable task and assignment belongs on it).
- Per-agent task lists as separate boards (bookkeeping overhead, board noise).
- Free-text project tag with no projects table (repeats folder/workspace per task; renames painful).
- Board-per-project (defeats the one-board vision).
- Global effort enum shared by all models (wrong: effort vocabulary is model-specific).
- Assignment-history tables (no stated need; add later if tracking model changes per task matters).
- Treating Herdr as the agent registry (excludes Cursor; breaks when Herdr is down; SQLite owns assignment, Herdr owns live status).

## Phases

### Phase 1 — Project + task domain (SQLite core)
1. `src/domain/projects/project.ts` and `src/domain/tasks/task.ts` — entities; `TASK_STATUSES`; `ASSIGNEE_TYPES`; `HARNESSES` (`pi | claude_code | cursor`); `KNOWN_MODELS` constant
2. Domain rule: `effort` must be valid for the assigned `model` when both are set
3. `ProjectRepository` and `TaskRepository` ports in domain; Drizzle adapters in `src/infrastructure/repositories/{projects,tasks}/`
4. Schema: `projects` + `tasks` tables (replaces the bootstrap `tasks`-only table; agent columns replaced by assignee + `(model, effort)` fields)
5. Use cases in `src/application/{projects,tasks}/`: create-project, create-task, move-task, assign-task (me/agent with model+effort pair), flag-needs-human
6. Thin REST routes: `/api/projects`, `/api/tasks`, `/api/tasks/[id]` (resource-flat, like the CRM)

### Phase 2 — Kanban UI
1. Dashboard shell + sidebar (borrow layout patterns from CRM's `(main)` route group)
2. Single board at `src/app/(main)/board/page.tsx`: columns from status; cards show title, project tag, assignee chip (🧑 you / harness icon + model + effort), "needs human" badge
3. Drag-and-drop → move-task via `PATCH` (`react-dnd` + HTML5 backend); task detail panel with description, project, folder path, assignment editing (harness/model/effort), linked Herdr pane when present
4. Project overview screen (optional, cheap): open tasks per project, folder path, live agents for its Herdr workspace
5. Semantic theme tokens, light/dark, matching CRM screen rhythm

### Phase 3 — Agent monitoring
1. `/api/herdr/snapshot` route returning normalized agent state (`HerdrClient` already reads the live session — 7 agents/7 tabs verified live); map Herdr agent kind → harness (`pi` → pi, `claude` → claude_code, `agy` → agy)
2. Agents overview screen: status per Herdr-visible agent (cwd, terminal title, working/idle/blocked); Cursor tasks show only stored task state, updated by hand
3. Board composes tasks (SQLite) + live agent status (Herdr) by `herdr_pane_id` / project workspace
4. Refresh via polling first (SWR-style); SSE only if polling disappoints

### Phase 4 — Human-in-the-loop
1. `needs_human` flag: manual, or auto-suggested when the linked Herdr agent reports `blocked`
2. Inbox view of tasks awaiting human action (plus the no-project triage inbox)
3. Resolve/unblock actions send an `agent.prompt` back through the Herdr socket API (terminal harnesses only; Cursor tasks are resolved by hand)

### Phase 5 — Docker Compose deployment (required before handoff is accepted)

Model on the CRM webapp (`~/ws/biznagatec-crm/webapp/Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`), simplified to one service:

1. **Dockerfile** — multi-stage (`deps` → `builder` → `runner`) on `node:24-bookworm-slim`:
   - `deps` stage needs `python3 make g++` for the `better-sqlite3` native build; pnpm via corepack, frozen lockfile
   - `builder`: `pnpm build`; keep `data/` dockerignored (host bind mount); ensure the data dir exists at build (the DB module opens the file when Next collects page data)
   - `runner`: full tree (not standalone) is fine for a single webapp; `PORT=3100`, `HOSTNAME=0.0.0.0`
2. **docker-entrypoint.sh** — remap the `node` user to `PUID`/`PGID` (host uid/gid) via gosu so WAL/SHM sidecar files stay host-writable, same as CRM
3. **docker-compose.yml** — single `nexus` service: image, `./data` bind mount (production DB stays separate from `./data-dev`), host port 3100, `PUID`/`PGID` passthrough; migration step (drizzle `migrate`) runs once before the server starts
4. **Verification:** `docker compose up` serves the board on http://localhost:3100 with SQLite persisted across container recreation; `docker compose down && up` keeps data
5. `docker compose` is also how the app reaches the Herdr socket — mount `~/.herdr` read-only into the container and point `HERDR_SOCKET` at it (verify socket path inside container)

## Herdr API notes (verified live)

- Read path: `herdr api snapshot` → `{ result: { snapshot: { agents, panes, tabs, workspaces, ... } } }`
- Socket: `~/.herdr/herdr.sock`, JSON-RPC; methods via `herdr api schema --json` (`agent.prompt`, `agent.list`, `events.subscribe`, tab/workspace CRUD)
- Agent statuses: `idle | working | blocked | done | unknown`; agent kinds seen: `pi`, `claude`, `codex`, `gemini`, `aider`, `opencode`
- Live model info is partial (snapshot `tokens.quota_model`, e.g. `Claude/Sonnet 5.5`); the SQLite assignment is the reliable record

## Working conventions

- Stack: Next.js 16, React 19, TypeScript strict, Tailwind v4, shadcn/ui (radix-nova style), Drizzle ORM, SQLite (`./data/nexus.db`), Biome, Vitest, pnpm.
- Hexagonal layers: `src/domain/<context>/` → `src/application/<context>/` → `src/infrastructure/` → `src/app/` (thin route adapters). Contexts: `projects`, `tasks`. No context-level barrels; contexts must not import each other's internals.
- `pnpm dev` on http://localhost:3100; `pnpm validate` (Biome + typecheck + Vitest) is the gate for every change.
- Architecture modeled on `~/ws/biznagatec-crm/webapp` — consult its `AGENTS.md` for conventions, never edit it.
