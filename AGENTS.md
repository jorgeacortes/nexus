# AGENTS.md

## Project overview

Nexus is the personal agent operations console: it monitors AI coding agents and manages and visualizes their work as tasks on one Kanban board. The board's card is the task (assignee: the operator or one agent); the project (≈ Herdr workspace + folder) is a tag on the card. Built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (radix-nova style), Drizzle ORM, and SQLite.

**Personal use only:** one user, no auth, no multi-tenancy, no scalability scaffolding. `PLAN.md` is the single source of truth for product decisions and implementation phases — read it before writing code.

The architecture is intentionally modeled on `~/ws/biznagatec-crm/webapp` (Biznagatec OS). Read that project's `AGENTS.md` when unsure about a convention — but never edit it from here.

## Setup

This project uses pnpm.

```bash
pnpm install
pnpm dev      # http://localhost:3100 (override with PORT), dev SQLite file in ./data-dev
```

Production data lives in `./data` and is served by `docker compose up` (see `docker-compose.yml`); `pnpm dev` never touches it. The container listens on 3100 internally and publishes `HOST_PORT` (default 3210) on the host, so it does not collide with the dev server.

`nx` (`src/cli/nx.ts`) resolves its board the same way every time: `NEXUS_URL`, then `~/.config/nexus/env`, then a probe of the local ports (deployed `HOST_PORT` before dev `3100`). It reports which board answered (`nx ping`, `nx doctor`) and refuses writes to a probed board that has no projects unless `--force`, so a pane can never silently write to the empty `./data-dev` board.

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

`projects`, `tasks` and `dispatch` are the bounded contexts (`dispatch` added 2026-10-05, see `DESIGN-dispatch.md`: it owns ensure-workspace → tab → start agent → assign, and the guarded close). Do not cross DB boundaries with SQL joins; every integration (Herdr, future agent providers) is a port declared as a narrow interface in `src/domain/` implemented in `src/infrastructure/` (precedent: `src/domain/tasks/agent-prompt.ts`). A *repository* persists aggregates in SQLite; an external system is a *port*, never a repository.

## Reviewed tasks (`reviewedAt`)

- `reviewedAt` is a nullable timestamp on a task recording that the **operator
  personally verified** a finished task. It mirrors `completedAt`: null = not
  reviewed, a date = reviewed then. There is no `reviewed` boolean and no `review`
  column — the board keeps its five columns, and the timestamp is the flag.
- It is **never derived from status**. `completeTask` (`nx done`) leaves it null,
  so "agent finished" and "human verified" stay independent facts. It is only
  meaningful on a `done` task: marking reviewed requires `done`, and any move out
  of `done` clears it (`updateTask`).
- Write paths: the detail-sheet "Reviewed" toggle (`PATCH { reviewed: boolean }`,
  routed through `ReviewTaskUseCase` in `src/application/tasks/review-task/`) and
  `nx review <id> [--undo]`. Marking reviewed also clears `needs_human`: a done
  task flagged needs-human is awaiting review, so reviewing takes the ball out of
  the operator's court.
- **Agent guardrail.** `reviewedAt` is an operator assertion, never an agent
  self-assessment. An agent may record a review **only** when the operator has
  explicitly confirmed — in the conversation — that they personally reviewed the
  task. An agent must never mark its own work reviewed, and must not treat "tests
  pass / looks done / I finished it" as a review. `nx review` is deliberately
  absent from the dispatch prompt (`buildDispatchPrompt`).
- Web affordances: the detail-sheet toggle, a check badge on the card (date in
  the tooltip), and a "Needs review" board filter (`done` with no `reviewedAt`).

## Herdr integration

- Herdr exposes a JSON-RPC API over a Unix socket via `herdr api snapshot` / schema-driven methods. Do not guess the protocol; `herdr api schema --json` is the source of truth for methods and params.
- Herdr sees terminal harnesses (pi, Claude Code, Agy) but not Cursor. SQLite owns assignments (harness/model/effort); Herdr owns live status. The Kanban UI composes both.
- Agent identity (`agent_name` + `harness`) is resolved from the live snapshot when a task is claimed or dispatched (`agentStateForPane` in `src/domain/tasks/live-agents.ts`): the pane's agent kind, never its Herdr tab id. Herdr being unavailable leaves both null (the chip falls back to "Agent") and never fails a claim. That resolver is the only writer of these fields on the claim/dispatch paths (it now also carries the pane's observed model/effort — see below).
- The model/effort label on a board card describes what the agent is *running*,
  not who owns the card: `AssigneeChip` is the owner/harness chip only, and the
  card renders a separate `ModelTag` (`src/components/model-tag.tsx`) on its own
  row. See "Which model is the agent running?" below for where the value comes
  from and why Herdr's status line is only a fallback.

## Which model is the agent running?

**Decision: the harness's own session state is authoritative for the model; Herdr's
`tokens.quota_provider_model`/`quota_model` is a display label used only as a
fallback when that state cannot be read. The stored `tasks.model` is the fallback
once the pane is offline.** This was verified against the running machine, not
assumed — Herdr's label disagreed with the harnesses in three different ways:

| harness | Herdr label (before) | harness's own state (ground truth) | source |
| --- | --- | --- | --- |
| pi | `opencode-go/deepseek-v4.1-flash` | `deepseek-v4.1-flash`, `thinkingLevel: high` | `agent_session.value` is the transcript path → first entries carry `modelId`/`provider`/`thinkingLevel` |
| Claude Code | `Claude/Sonnet 5.5` | `claude-sonnet-5-5`, `effort: high` | `agent_session.value` is the session id → `~/.claude/projects/<slug>/<id>.jsonl`, assistant turns carry `message.model`, `effort`/`perTurnEffort`; `~/.claude/settings.json` `modelSettings[model].effortLevel` is the fallback |
| Cursor | `Claude/Sonnet 5.5` (wrong) or no tokens at all | `grok-4.7` (both live panes) | `agent_session.value` is the session id → `~/.cursor/chats/<hash>/<id>/store.db`, `meta` value is hex-encoded JSON with `lastUsedModel`; per-model effort in `~/.cursor/cli-config.json` `modelParameters` |

- Resolution lives in `src/infrastructure/herdr/session-model.ts`; `HerdrClient.snapshot()`
  enriches each agent with it (`hydrate`). Reads are bounded head/tail slices,
  cached by file mtime+size, and best-effort: any failure yields "unknown", never
  an exception. Cursor's `store.db` is opened read-only, with a raw hex scan of
  `"lastUsedModel":"` as fallback because the container mounts the directory `:ro`
  and SQLite cannot create the `-shm` sidecar a WAL database wants.
- **Canonical model id** (`src/domain/tasks/model.ts`): the harness's id, provider
  prefix stripped, lowercased, spaces → dashes, then a short alias table for
  display labels (`Claude/Sonnet 5.5` → `claude-sonnet-5-5`) and historical dotted
  ids. Everything the app stores or renders is this id; `modelLabel()` renders it.
- **The registry (`KNOWN_MODELS`) is the assignment vocabulary, not a validator of
  observed values.** Pi's entry mirrors `enabledModels` in `~/.pi/agent/settings.json`
  with the efforts pi's own catalog declares (`thinkingLevelMap` in
  `~/.pi/agent/models-store.json`), which is how `deepseek-v4.1-flash` (`low`,
  `high`, `max`) got in; cursor's entry mirrors the models `~/.cursor/cli-config.json`
  records. `normalizeAssignment(input, "assigned")` validates a chosen pair, but
  `"observed"` values are only normalised — a registry that lags a harness release
  must never fail a claim or blank a card.
- **`nx claim` records the pane's observed model/effort** (`agentStateForPane` →
  `ClaimTaskInput.model/effort` → `claimTask`), so an offline card keeps its model
  and `nx task show`'s model column stops being permanently "—". The claim API does
  not accept a client-supplied model: the server resolves it. When the observed
  model changed, an effort that belonged to the old model is dropped.
- **UI rule: the model never lives inside a chip.** `ModelTag` gives it its own row
  under the title/description, wrapping instead of truncating (the old chip cut off
  at `max-w-[170px]`), with no `title` escape hatch; `AssigneeChip` is owner/harness
  only. A live agent whose model cannot be resolved renders "Model unknown" rather
  than a blank that reads as "no model"; a card with no agent and no model stays
  compact. Inbox rows and the Agents screen use the same component.
- In Docker the three state directories are mounted read-only under `/harness`
  (`HARNESS_STATE_DIR=/harness`, see `docker-compose.yml`); on the host the
  resolver reads the real `~/.pi/agent`, `~/.claude`, `~/.cursor`.

## Host listeners (Servers screen)

- The **Servers** screen (`src/app/(main)/servers/`) lists what is listening on the
  host — port, protocol, bind address (loopback vs all interfaces), folder or
  container, owning process/PID/uid, and uptime — and never writes. It polls
  `/api/servers` every 5s, the same cadence as the Herdr snapshot, so a service
  that stops disappears on the next tick.
- **One row per app, not per socket.** `groupListeners` (`src/lib/servers.ts`)
  collapses a service's TCP/UDP and per-address variants into one row that lists
  its ports and binds and says "N sockets" — `docker-proxy` publishing the same
  container port on two host IPs is one row, `systemd-resolved` on `127.0.0.53`
  and `127.0.0.54` is one row. Host rows collapse by pid; a listener whose owner
  cannot be named stays on its own row.
- **The web-app rule, stated on the screen and here:** a listener is one of the
  operator's apps when it is a published Docker port (container sockets are the
  operator's by construction) or when a non-root process from the
  `WEB_APP_RUNTIMES` allowlist in `src/lib/servers.ts` owns it (node, bun, deno,
  python/uvicorn/gunicorn, ruby/puma, php, npm/pnpm/yarn, tsx, vite). Everything
  else — cupsd, systemd-resolved, systemd-networkd, a root daemon — is a **host
  service**. There is deliberately no HTTP probe: the screen polls every 5s and
  must not become a request generator. The two groups render as sections, host
  services are collapsed behind one control, and the control always states how
  many rows are hidden so nothing is dropped silently. The header line answers
  the question directly: "4 web apps · 12 listeners", plus the Docker count and
  how many sockets are on all interfaces.
- **Per-listener identity comes from procfs**, next to the socket match that
  already names the owner: working directory from `/proc/<pid>/cwd`, command line
  from `/proc/<pid>/cmdline`, and `$HOME` from `/proc/<pid>/environ` (used to
  shorten the folder to `~/ws/…`). The app name is the folder's basename, falling
  back to the runtime. When the folder is merely unreadable the row says so
  ("folder not readable for this process") rather than printing a bare dash.
- **Decision: container names come from a socket proxy, never from the real
  socket.** The Docker rows show the container name and the compose identity
  (`nagabot-web-1`, `nagabot/web`), the image, and the compose working directory
  as the folder column. Those live in the daemon, so a
  `tecnativa/docker-socket-proxy` service in `docker-compose.yml` holds
  `/var/run/docker.sock:ro` with only `CONTAINERS=1` and `POST=0` enabled (the
  image's other endpoints default off) and listens on 2375 inside the internal
  `dockerapi` network — no published port, and only Nexus joins it. Nexus never
  mounts the real socket: a read-only bind of a unix socket still gives the holder
  root-equivalent Docker API access, which is why the direct mount (rejected) and
  the `/var/lib/docker/containers` read (which also exposes container `Env`, i.e.
  secrets) were not used. Port: `ContainerInventoryPort` in
  `src/infrastructure/docker/container-inventory.ts`; the adapter makes one
  `GET /containers/json` per tick and one cached `GET /containers/<id>/json` per
  container to turn a compose-built image's bare `sha256:…` into its tag. The
  use case joins an inventory entry onto a listener by `docker-proxy`'s
  `-container-ip` (the container's network address), or by the cgroup container id
  when there is no published mapping.
- **A dead Docker proxy costs the names, never the screen.** The use case catches
  the inventory failure, reports it in `ServersPayload.docker`, and leaves the
  identity fields null; the UI says "container names unavailable" and keeps the
  published mapping. No name is ever guessed.
- **The procfs side of Docker attribution** needs no socket at all:
  `docker-proxy`'s own argv carries `-host-port/-container-ip/-container-port`,
  so a published row still reads "Docker · published 3210 → container
  172.19.0.2:3100" when the proxy is down, and a container-run process's
  `/proc/<pid>/cgroup` names its 12-char container id. A host process satisfies
  neither test, so it can never be labelled Docker.
- **Decision: the app reads the host's `/proc` directly; there is no sidecar
  collector.** The Compose service runs with `pid: host`, so `/proc` is the host's
  procfs and `/proc/1/net/{tcp,tcp6,udp,udp6}` is the host's network namespace
  (the container's own `/proc/net` only holds the container). `docker-entrypoint.sh`
  drops privileges with `setpriv` and hands the unprivileged app user two ambient
  capabilities — `CAP_SYS_PTRACE` (the ptrace check on `/proc/<pid>/fd/<n>`) and
  `CAP_DAC_OVERRIDE` (listing another user's fd directory) — which is what lets
  the collector match a socket inode to the process holding it; `apparmor=unconfined`
  is required because the default profile forbids cross-profile ptrace. Without
  any of this the list still renders with the process/PID columns empty. Rejected:
  a host-side collector writing a snapshot file Nexus reads (a second long-running
  process, and a stale file cannot be told apart from an empty host without extra
  bookkeeping), and mounting host `/proc` without `pid: host` (the net tables would
  belong to the container's network namespace).
- Port: `ServerCollectorPort` in `src/infrastructure/servers/server-collector.ts`,
  mirroring `HerdrPort`; the procfs adapter is
  `src/infrastructure/servers/host-listeners.ts`, the read use case is
  `src/application/servers/read-servers/`. Domain, application, and UI code never
  read `/proc`; labels and heuristics live in `src/lib/servers.ts`.
- A collector that cannot be read reports `available: false` with the reason and
  is never rendered as "nothing is listening"; a failed poll keeps the last
  snapshot and labels it. Rows are marked when their port is `HOST_PORT` (the
  deployed board) or `PORT` (dev), and the list is filterable by app, folder,
  container, runtime, port, process, pid, or address.

## Branding

- The app's mark is the **StarCraft II in-game building icon for the Nexus** — the art
  the game's own UI uses for the building, not a 3D render (the render was tried in
  bb57489 and the operator preferred the UI icon).
- Source of truth: `assets/branding/nexus-sc2-ui-icon.dds`, the raw command-card
  button asset taken from the Blizzard game files and mirrored in the
  `NobleXenon/AP_SC2Icons` repo as `dds/liberty/btn-building-protoss-nexus.dds`
  (76×76, DXT5). Blizzard art, personal use only. 76×76 is the native resolution of
  this art, so the 180px icon is a documented upscale, not a downscale of a larger
  original.
- `scripts/make-brand-icons.mjs` decodes that DDS (BC1/BC3, no image library) and
  writes everything derived from it with a Lanczos-3 resample:
  `assets/branding/nexus-sc2-ui-icon.png` (the decoded 76×76 master, for reading),
  `src/app/apple-icon.png` (180×180), `src/app/icon.png` (64×64) and
  `src/app/favicon.ico` (PNG-in-ICO at 16/32/48). Run the script instead of editing
  the outputs by hand; the `icons` block in `src/app/layout.tsx` serves them.
- In the UI it renders in `SidebarBrand` (`src/app/(main)/_components/sidebar-nav.tsx`),
  which the desktop rail and the mobile drawer share: `next/image` imports
  `apple-icon.png` directly at an explicit 32×32 in the brand block's `size-8` slot, so
  the block cannot shift on load. The icon brings the game's own dark tile as its
  background: never put a coloured plate behind it and never add a `public/` copy.

## Code conventions

- TypeScript strict mode; no `any`.
- Biome: double quotes, semicolons, two-space indentation, sorted imports.
- Clipboard writes go through `copyText` (`src/lib/clipboard.ts`) and the shared
  `CopyButton` (`src/components/copy-button.tsx`). The deployed board is plain
  `http` off localhost, where `navigator.clipboard` does not exist, so the helper
  falls back to a hidden textarea + `execCommand` — parked inside the open dialog
  when there is one, because a Radix modal's focus trap drops the selection of a
  textarea on `<body>` and the command then reports success without writing — and
  returns whether the copy landed; a copy control must show success in place and
  report a failure instead of failing silently. Task ids are copied whole (a full
  uuid), never abbreviated.
- Run `pnpm validate` after making changes — it is the gate for every change.
- Deployment is Docker Compose only (`Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh`, modeled on the CRM webapp). See `PLAN.md` Phase 5.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
