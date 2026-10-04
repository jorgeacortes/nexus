# AGENTS.md

## Project overview

Nexus is the agent operations console: it monitors AI coding agents and manages and visualizes agent tasks. The core product is a Kanban board of tasks with status, the agent assigned to each one, and a clear signal for tasks needing human action. Built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (radix-nova style), Drizzle ORM, and SQLite.

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

Hexagonal layers, one bounded context (`tasks`):

- Layers: `src/domain/tasks/` → `src/application/tasks/` → `src/infrastructure/` → `src/app/` (thin route/API adapters)
- Schema + repositories: `src/infrastructure/db/tasks/` and `src/infrastructure/repositories/tasks/`
- `src/infrastructure/herdr/` contains the Herdr API client (agents/monitoring). It is a port + adapter; domain and application code never touch sockets directly.
- `src/app/api/` routes are resource-flat and thin: validate, call a use case, return JSON.
- Co-location-based structure: screens under `src/app/(main)/<screen>/page.tsx`, screen-specific components in `_components/`. Keep `page.tsx` a Server Component by default.
- Shared shadcn components live in `src/components/ui/`; shared app code in `src/components/`, `src/hooks/`, `src/lib/`.

`tasks` is the only bounded context for now. Do not cross DB boundaries with SQL joins; every integration (Herdr, future agent providers) is an application-level port implemented in `src/infrastructure/`.

## Herdr integration

- Herdr exposes a JSON-RPC API over a Unix socket via `herdr api snapshot` / schema-driven methods. Do not guess the protocol.
- During Herdr setup tasks, `herdr api schema --json` is the source of truth for methods and params.
- Agent monitoring reads from the Herdr socket API; task management reads from SQLite. The Kanban UI composes both.

## Code conventions

- TypeScript strict mode; no `any`.
- Biome: double quotes, semicolons, two-space indentation, sorted imports.
- Run `pnpm validate` after making changes — it is the gate for every change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
