# Assessment — which tool becomes the agent orchestrator: NagaBot or Nexus?

Task `45f37354` (nexus, high). Question: *"assess either to turn nagabot or nexus
into an agent orchestrator tool to handle tasks from a single agent that hands
over to others."*

2026-10-04. Everything below was verified against the running machine (Nexus on
`:3210`, NagaBot on `127.0.0.1:8787`, Herdr protocol 22), not assumed.

## 1. What "orchestrator" means here

"One agent hands over to others" is four different jobs. Keeping them apart is
the whole assessment, because no single tool is good at all four:

| Job | What it is | Who is good at it |
| --- | --- | --- |
| **Decompose** | read the goal, split it, pick a worker | an LLM |
| **Dispatch** | put a task in front of a specific agent pane | something that can touch Herdr |
| **Ledger** | what work exists, who owns it, why it stopped, whose court the ball is in | a database with one board |
| **Watch & collect** | notice a worker finished/blocked, read its result, decide the next step | a loop |

## 2. What already exists (three layers, not two)

### Herdr — the actuator: complete, nothing to build

Verified live: 6 workspaces, 4 agents (`pi`×3, `cursor`). Seasoned primitives
(`herdr --help`, `herdr api schema --json`):

- topology: `workspace create`, `tab create`, `pane split` — all with `--cwd`,
  `--env`, `--label`, `--no-focus`
- `agent start <name> --kind pi --pane <id>` — start a supported harness in an
  existing shell pane
- `agent prompt <target> <text> --wait [--until idle|working|blocked|done]`
- `agent wait <target> --until blocked`, `agent read <target> --source recent-unwrapped --lines N`
- `agent list` / snapshot, and `events.subscribe` / `events.wait` for push
  notification instead of polling

So *spawn a worker → aim it at a folder → prompt it → wait for a settled state →
read its transcript* is fully available today, with no code. Herdr's own skill
even ships the exact loop ("Start and coordinate an agent") — and warns agents
not to delegate merely because they can.

### Nexus — the ledger plus the current dispatch edge (partial)

Already durable and truthful:

- project → task; `status` (`backlog|ready|in_progress|blocked|done`), 5
  priorities, `assignee = me|agent|null`, harness/model/effort,
  `needs_human` + reason, claim/completed timestamps, `completion_notes`.
- **Worker protocol that needs no identity typing**: `nx claim` / `nx done` /
  `nx need`, pane from `$HERDR_PANE_ID`, agent kind resolved from the live
  snapshot (`agentStateForPane`).
- **Dispatch**: `nx assign <id> --to <pane|auto>` → `POST /api/tasks/[id]/dispatch`
  → `buildDispatchPrompt` (task id, project, folder, "claim it first", "finish
  with `nx done`") pushed through `agent.prompt`; then the assignment pointers are
  recorded. `--to auto` picks an **idle** agent whose cwd is inside the project
  folder and **fails loudly** rather than crossing projects.
- Inbox + resolve: a `needs_human`/blocked task can be unblocked by prompting the
  pane (`AgentPromptPort`).
- It already reaches Herdr from inside Docker: `~/.config/herdr:/herdr:ro` +
  `HERDR_SOCKET=/herdr/herdr.sock`. `HerdrPort` has exactly two methods today:
  `snapshot()` and `prompt()`.

What it deliberately is **not** (PLAN.md intent + accepted non-goals, and the
Phase 6 non-goals):

- *"Nexus observes and dispatches; it does not execute work."*
- *"No dispatcher daemon. No poller, no queue, no background scheduler."*

And the concrete gaps that make it not-an-orchestrator yet:

1. **No spawn** — it can prompt a pane that already exists, never create one or
   start an agent.
2. **No watch loop** — dispatch is one-shot fire-and-forget; after a worker calls
   `nx done`, nothing reads the outcome or starts the next step.
3. **No result capture** — only a free-text `completion_notes` string.
4. **No handover relation** — no parent/child or dependency on a task, so "task X
   spawned tasks Y and Z" cannot be represented on the board at all.
5. No retry, no concurrency limit, no budget.

### NagaBot — the only headless agent we run as a service (right shape for a brain)

- A `pi` SDK agent (`createAgentSession`), one session per workspace, with
  `read`/`bash`/`edit`/`write` plus `web`, `fetch`, `nexus` (read + gated
  writes), `routine` (cron) and MCP tools.
- Long-lived and unattended-capable: `pnpm web` / Docker (`nagabot-web-1` is up),
  routines fire prompts on a schedule.
- Because `bash` is a default file tool, NagaBot can already run `herdr …` and
  `nx …` — **if it can see them**.
- Sandbox reality, which is the crux: its `nexus` tool explicitly *"does not
  dispatch a task to a Herdr pane"*; the container mounts only `/workspace`, has
  **no Herdr socket**, no `~/.pi/agent`, a read-only rootfs, and reaches the board
  via `host.docker.internal:3210`. As shipped it can neither spawn, prompt, nor
  read any agent, and cannot read another project's folder.

### pi itself

Ships **no sub-agents and no plan mode** ("Pi ships with powerful defaults but
skips features like sub-agents and plan mode. Ask Pi to build what you want, or
install a package"). So a worker is a Herdr pane running a full pi session — not
an in-process child — unless we build a package.

## 3. The ways we actually have

| # | Way | Holds state | Executes | New code | Main cost |
| --- | --- | --- | --- | --- | --- |
| 1 | **Convention only** — an orchestrator pane runs `herdr` + `nx` by hand | Nexus | Herdr | none | not durable (pane dies → work vanishes), no visibility, double-dispatch, token-heavy |
| 2 | **Nexus grows spawn + watch** | Nexus | Nexus→Herdr | medium | turns the monitoring console into a scheduler/daemon — against its accepted non-goal and its Next.js request/response shape |
| 3 | **Nexus as queue only**, a small external conductor loop | Nexus | conductor→Herdr | small–medium | a 4th daemon, and still no home for decomposition |
| 4 | **NagaBot becomes the orchestrator** (herdr capability + nexus dispatch action + routine loop) | Nexus | NagaBot→Herdr | medium | sandbox work: mount the Herdr socket, decide read access to worker output |
| 5 | **Hybrid: NagaBot is the brain, Nexus the ledger, Herdr the actuator** | Nexus | NagaBot→Herdr | small | needs one schema addition (handover link) and one new capability |

Notes on the two that look tempting and aren't:

- **Way 1 works right now and is worth using immediately** — you already have a
  workspace labelled `manager` (`wT`) and NagaBot/Nexus project workspaces. A
  `pi` pane with the Herdr skill plus the `nx-tasks` skill is a functioning
  orchestrator today. It just isn't durable or observable, so it should be
  treated as the prototype of Way 4/5, not the destination.
- **Way 2 fights the product.** Nexus's value is being the one honest board. Put
  a scheduler inside it and you blur "why has work stopped?" with "what is the
  scheduler doing?", and you duplicate Herdr's job. It also has nowhere to run a
  long loop: the deployment is a Next.js server behind Docker Compose.

## 4. Recommendation — Way 5

**NagaBot is the orchestrator brain. Nexus stays the ledger and the handover
record. Herdr stays the actuator.** Not "either/or": each takes the job it is
already shaped for.

Why:

- Decomposition, worker selection, judging a result, deciding the next step are
  LLM work — only NagaBot is already a headless agent with tools and a cron.
- Durability ("what work exists, who owns it, why it stopped, whose court") is
  already Nexus and should not move.
- Touching terminals and reading transcripts is already Herdr and should not be
  re-implemented.
- A parent/child link on the board is the one thing missing to make a *handover*
  a first-class fact instead of a sentence in a description.

Smallest change that gets there, no daemon required:

1. **Schema**: `tasks.parent_task_id` (nullable, self-reference) — a handover
   becomes visible on the board ("2 subtasks", blocked-on-children optional
   later). This is the only board change.
2. **One capability, one place**: either
   - give NagaBot a `herdr` tool (socket client: `start`, `prompt --wait`,
     `wait`, `read`) and mount `~/.config/herdr` into `nagabot-web`; or
   - add `nx spawn` to the CLI (host-side, next to the dispatch that already
     lives there) so NagaBot keeps its current sandbox and simply shells out.
     This is the smaller trust-surface change and my preference to start.
3. **Orchestrator skill/prompt**: when to split, when to reuse an idle pane
   (`assign --to auto`) vs spawn, how to record the handover, how to report back.
   Workers are unchanged: they keep `claim`/`done`/`need`.

Resist, at least until this loop is boring: a poller (use `agent prompt --wait`,
`agent wait`, or a cron routine first), a queue, per-agent personas, and letting
NagaBot spend tokens spawning agents unattended.

## 5. Open questions for the operator

1. Orchestrator identity: **NagaBot as a service**, or a **dedicated `pi`
   "manager" pane** (like the existing `manager` workspace `wT`)?
2. Handover on the board: add `parent_task_id` (my recommendation), or keep it
   as a line in the description for now?
3. NagaBot boundary: mount the Herdr socket into `nagabot-web`, or add `nx spawn`
   on the host and let NagaBot keep its current isolation?
4. Worker lifecycle: **spawn a pane per task** (board then means "what is
   running") or **reuse idle panes** (today's `assign --to auto`)?
5. Unattended limits: max concurrent workers, and may a cron routine dispatch
   agents without a human in the loop?

## 6. Evidence

- Herdr: `herdr --help`, `herdr agent --help`, `herdr pane --help`,
  `herdr workspace --help`, `herdr --skill`, `herdr api schema --json`
  (`agent.start`, `agent.prompt`, `agent.wait`, `agent.read`, `events.subscribe`),
  `herdr agent list`, `herdr workspace list`.
- Nexus: `PLAN.md` (intent, non-goals, decisions 2/3/7/10),
  `HANDOFF-PHASE-6.md` (dispatch design + Phase 6 non-goals),
  `src/application/tasks/dispatch-task/dispatch-task.usecase.ts`,
  `src/domain/tasks/dispatch-prompt.ts`, `src/domain/tasks/agent-prompt.ts`,
  `src/infrastructure/herdr/herdr-client.ts`, `src/cli/nx.ts` (`assign`,
  `claim`, `done`, `need`), `src/app/api/tasks/[id]/*`, `docker-compose.yml`.
- NagaBot: `src/session.ts`, `src/prompt.ts`, `src/tools/nexus.ts`,
  `src/tools/routine.ts`, `src/config.ts`, `docker-compose.yml`
  (`NEXUS_URL=http://host.docker.internal:3210`, `/workspace` only).
- pi: `docs/sdk.md`; package README (no sub-agents / no plan mode).
- Live: `docker ps` (nexus-nexus-1, nagabot-web-1), `nx project list`.
