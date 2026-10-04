# HANDOFF — Nexus implementation

This document is the entry point for the implementing agent. Everything needed to start (and finish) the work is reachable from here.

## What Nexus is

A **personal** agent operations console: the operator runs AI coding agents across multiple harnesses (pi, Claude Code, Cursor) inside Herdr, one workspace per project, each project in its own folder. Nexus gives one glanceable place to (1) monitor the agents and (2) manage and visualize their work as tasks on a single kanban board, with a clear signal for tasks needing human action.

Read `AGENTS.md` first (conventions), then `PLAN.md` (intent, goals, constraints, approved decisions, model, phases). **Do not redesign what is decided there.** Decisions are approved and final unless the operator changes them. If something in the plan blocks you, stop and ask — do not silently substitute a different design.

## Repository state

- Location: `~/ws/biznagatec-ws/nexus`
- Commits (clean tree, nothing in progress):
  - `7ad5bf2` — bootstrap: Next.js 16 + React 19 skeleton (dev on http://localhost:3100), `tasks` SQLite schema via drizzle-kit (migration `0000`), Herdr client (`src/infrastructure/herdr/herdr-client.ts`, live-verified: reads the real session snapshot), Biome + Vitest + `pnpm validate` gate green
  - `a07751e` — plan + docs consolidated
- **No product code exists yet.** Implementation starts at Phase 1 of `PLAN.md`. The bootstrap schema has a `tasks`-only table with agent columns; Phase 1 replaces it with `projects` + `tasks` per the approved model.

## Your task

Implement `PLAN.md` Phases 1–5, in order:

1. **Phase 1 — Project + task domain (SQLite core):** entities, domain constants (`TASK_STATUSES`, `ASSIGNEE_TYPES`, `HARNESSES`, `KNOWN_MODELS`), the `(model, effort)` validation rule, repository ports + Drizzle adapters, use cases, thin REST routes (`/api/projects`, `/api/tasks`, `/api/tasks/[id]`).
2. **Phase 2 — Kanban UI:** dashboard shell + sidebar, single board at `src/app/(main)/board/page.tsx` (status columns, project tag, assignee chip, needs-human badge), drag-and-drop via `react-dnd`, task detail panel. Match the CRM's visual rhythm and semantic theme tokens.
3. **Phase 3 — Agent monitoring:** `/api/herdr/snapshot` route (adapter already exists — extend, don't rewrite), agents overview screen, board composes tasks (SQLite) + live agent status (Herdr) by `herdr_pane_id` / workspace. Cursor tasks show only stored state. Polling refresh.
4. **Phase 4 — Human-in-the-loop:** `needs_human` flag (manual + auto-suggestion on linked agent `blocked`), inbox view, resolve/unblock via `agent.prompt` (terminal harnesses only).
5. **Phase 5 — Docker Compose deployment:** multi-stage Dockerfile (native `better-sqlite3` build: `python3 make g++` in the deps stage), gosu PUID/PGID entrypoint, single-service compose with `./data` bind mount, migrations before start, Herdr socket mounted read-only (`HERDR_SOCKET`). Verify data persists across `docker compose down && up`.

## Hard rules

- **Personal project:** one user, one machine. No auth, no multi-tenancy, no scalability scaffolding.
- **Deployment is Docker Compose only.** Do not propose or build a bare `next start` production path.
- **SQLite owns assignments; Herdr owns live state.** Never store agent live status in the DB; never foreign-key into Herdr ids.
- **One kanban board.** Projects are tags, never columns or boards.
- **Effort is per model, not per harness** — validate `(model, effort)` pairs against the `KNOWN_MODELS` constant.
- Architecture: hexagonal, `domain/<context>` → `application/<context>` → `infrastructure` → `app` routes. Contexts: `projects`, `tasks`. No cross-context SQL joins; Herdr access only through the port in `src/infrastructure/herdr/`.
- This is Next.js 16 — APIs differ from your training data; read `node_modules/next/dist/docs/` guides before writing route/app code (see the block in `AGENTS.md`).
- Do not touch `~/ws/biznagatec-crm/webapp` (reference only). Do not add dependencies without need.

## Definition of done (per change)

```bash
pnpm validate        # biome + typecheck + vitest — must pass, this is the only gate
pnpm dev             # must boot and serve the screen you touched
```

Final acceptance:

- [ ] All four phases' screens work against real data (`./data/nexus.db`) and the live Herdr session
- [ ] `docker compose up` serves the board on http://localhost:3100; data survives `down && up`
- [ ] Kanban shows: task cards, status columns, project tag, assignee (me/agent), needs-human signal
- [ ] Drag-and-drop moves a task and persists
- [ ] Agents overview reflects the real Herdr session (pi / Claude Code visible; Cursor absent is expected)
- [ ] `pnpm validate` green
- [ ] Work committed with clear messages, one logical commit per coherent unit

## Working notes

- pnpm 10.29.3, Node ≥ 22. `pnpm install` first; `better-sqlite3` native builds are pre-approved via `pnpm.onlyBuiltDependencies` in `package.json`.
- Herdr read path: `herdr api snapshot` → `{ result: { snapshot: { agents, panes, tabs, workspaces, ... } } }`. Socket: `~/.herdr/herdr.sock` (JSON-RPC). Full method list: `herdr api schema --json`. Never guess protocol fields.
- Herdr agent statuses: `idle | working | blocked | done | unknown`; kinds seen: `pi`, `claude`, `codex`, `gemini`, `aider`, `opencode`.
- Dev DB is `./data-dev` (set `DATA_DIR`); production DB is `./data/nexus.db`. Keep them separate, as the CRM does.
- If you need a Herdr mutation (`agent.prompt`, tab/workspace CRUD), check the schema first and keep it behind the `HerdrPort` interface in `src/infrastructure/herdr/herdr-client.ts`.
