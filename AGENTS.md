# AGENTS.md

## Project overview

Nexus is the personal agent operations console: it monitors AI coding agents and manages and visualizes their work as tasks on one Kanban board. The board's card is the task (assignee: the operator or one agent); the project (≈ Herdr workspace + folder) is a tag on the card. Built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (radix-nova style), Drizzle ORM, and SQLite.

**Personal use only:** one user, no auth, no multi-tenancy, no scalability scaffolding. `PLAN.md` is the single source of truth for product decisions and implementation phases — read it before writing code.

The architecture is intentionally modeled on `~/ws/biznagatec-crm/webapp` (Biznagatec OS). Read that project's `AGENTS.md` when unsure about a convention — but never edit it from here.

## Setup

This project uses pnpm.

```bash
pnpm install
pnpm dev      # http://localhost:3100, SQLite file in ./data/nexus.db
```

Available commands:

```bash
pnpm build
pnpm lint
pnpm check
pnpm check:fix
pnpm typecheck
pnpm test
pnpm validate        # biome + typecheck + vitest
pnpm db:generate     # drizzle-kit generate (tasks schema)
pnpm db:migrate      # apply SQLite migrations
pnpm db:studio
```

## Architecture

Hexagonal layers, two bounded contexts (`projects`, `tasks`):

- Layers: `src/domain/<context>/` → `src/application/<context>/` → `src/infrastructure/` → `src/app/` (thin route/API adapters)
- Schema + repositories: `src/infrastructure/db/<context>/` and `src/infrastructure/repositories/<context>/`
- `src/infrastructure/herdr/` contains the Herdr API client (agents/monitoring). It is a port + adapter; domain and application code never touch sockets directly.
- `src/app/api/` routes are resource-flat and thin: validate, call a use case, return JSON.
- Co-location-based structure: screens under `src/app/(main)/<screen>/page.tsx`, screen-specific components in `_components/`. Keep `page.tsx` a Server Component by default.
- Shared shadcn components live in `src/components/ui/`; shared app code in `src/components/`, `src/hooks/`, `src/lib/`.

`projects` and `tasks` are the only bounded contexts. Do not cross DB boundaries with SQL joins; every integration (Herdr, future agent providers) is an application-level port implemented in `src/infrastructure/`.

## Herdr integration

- Herdr exposes a JSON-RPC API over a Unix socket via `herdr api snapshot` / schema-driven methods. Do not guess the protocol; `herdr api schema --json` is the source of truth for methods and params.
- Herdr sees terminal harnesses (pi, Claude Code) but not Cursor. SQLite owns assignments (harness/model/effort); Herdr owns live status. The Kanban UI composes both.

## Code conventions

- TypeScript strict mode; no `any`.
- Biome: double quotes, semicolons, two-space indentation, sorted imports.
- Run `pnpm validate` after making changes — it is the gate for every change.
- Deployment is Docker Compose only (`Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh`, modeled on the CRM webapp). See `PLAN.md` Phase 5.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
