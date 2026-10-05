# Assessment — a periodic dispatcher of stored jobs that triggers a Herdr agent

Task `8047850a` (nexus). Question: *store jobs, review them periodically, and when
one is due let it trigger an agent in Herdr to do the work — unattended.*

2026-10-05. Follows `ASSESSMENT-agent-orchestrator.md` (`45f37354`) and
`DESIGN-agent-orchestrator.md` (`28fed253`). Those answered *who orchestrates*.
This one is narrower: **what ticks, and where does a stored job live.** Facts
below were read off the machine, not assumed; the evidence list is at the end.

## 0. The finding, up front

**You already own every piece except a due-date column.** Scheduling is a decided
problem: pick a trigger, and the job is "read stored rows that are due → hand one
to Herdr". Nothing here needs a new queue, broker or platform.

Three things must not be conflated, because they have different homes:

| Concern | Question | Right home |
| --- | --- | --- |
| **Decide** | which stored job is due right now? | a durable **job table** + a trigger |
| **Dispatch** | hand that job's prompt to a Herdr pane | Herdr (CLI/socket), via the edge Nexus already has |
| **Execute** | actually do the work | a Herdr pane (full harness). Not an in-process session |

The recommendation (§4) is one small thing: a `jobs` table in the Nexus SQLite DB
and one `runDueJobs()` function invoked by a single-instance runner (a `jobs`
service in the compose file, or a systemd timer). NagaBot stays the front door and
the *brain*, not the dispatcher. Pi Durable answers a different question (§4.1).

## 1. What "periodic dispatcher" actually covers

The operator's phrasing hides three different triggers. A useful dispatcher
should name them, because they are not the same feature:

1. **Schedule** — run at a time: cron/interval. `0 8 * * 1-5`.
2. **Poll / condition** — every N minutes ask a predicate, dispatch only if true
   (new InfoJobs posting, failing health check, unclaimed `ready` task older
   than a day). This is the more valuable one for agents and the one a plain
   cron line cannot express.
3. **Review queue** — a job is *proposed* and a human or the manager approves it
   before it runs. That is not a scheduler at all; it is Nexus's
   `needs_human`/decision path plus a dispatch.

A job row therefore needs, at minimum: `id, name, kind (schedule|poll), spec
(cron expr or interval + predicate), prompt/brief, target (project, workspace,
preferred agent/model/effort), enabled, next_run_at, last_run_at, last_status,
last_error, lease_owner, lease_until, run_count`. Retry policy and budget cap
belong next to it.

## 2. What exists today (verified)

| Piece | State | Consequence for this task |
| --- | --- | --- |
| **Herdr** | Actuator, complete; **no scheduling primitive** — no cron/timer anywhere in `herdr --help` or the subcommands | We must supply the tick. It supplies the dispatch: `agent start --kind pi --pane`, `agent prompt --wait --until`, `agent wait`, `agent read`, `pane split`, `events.subscribe` |
| **Nexus** | SQLite board + `HerdrPort` (`snapshot`, `prompt`) + a working dispatch edge (`nx assign` → `POST /api/tasks/[id]/dispatch` → `buildDispatchPrompt` → `agent.prompt`). Reachable from its container via `/herdr/herdr.sock` | The job table and the dispatch adapter can live here with no new infrastructure. But dispatch only **prompts an existing pane** — no spawn, and `--to auto` fails loudly when no idle pane matches |
| **Nexus, by design** | `PLAN.md`: *"task automation itself… Nexus observes and dispatches; it does not execute work"*, and the accepted non-goal **"No dispatcher daemon. No poller, no queue, no background scheduler."** | A **resident** loop inside Nexus fights the product. A **one-shot tick** invoked from outside does not |
| **NagaBot** | Already has the feature, roughly: `routines` (cron via `croner` + IANA tz), a 60 s tick in `watchRoutines`, JSON store `.nagabot/routines.json`, run logs under `.nagabot/routine-runs/<id>/`, and a `routine` tool so the agent manages its own schedules. It is **live**: `nagabot-web-1` runs `web`, which starts `watchRoutines` alongside the server | Real precedent and a real UX. But it runs the prompt **in-process** (`runIsolatedPrompt` → a pi session inside NagaBot's sandbox), not via Herdr. No retry/backoff, no lease, one routine at a time, store is **per workspace** rather than one shared table, and the container has **no Herdr socket**, read-only rootfs, only `/workspace` writable. It cannot spawn or prompt panes |
| **Pi Durable** | `@earendil-works/pi-durable` 1.0.3 (MIT) is published: durable conversations/tasks/documents, `harness.resume()` after a crash, tasks that `wait` on other tasks (`allSettled`/`failFast`), and a runtime clock — `sleep(until)` *"resolve once the Harness clock reaches `until`"* | This is a **durable timer plus exactly-once submissions plus retry-by-construction**. It makes the external tick optional: a job can be a recurring durable task that sleeps to `next_run_at` |
| **Host** | `cron` and a populated **systemd** are both present; the only project cron line is the CRM backup at 03:00. systemd timers support `OnCalendar=` and `Persistent=true` (catch up a missed run). No Kubernetes here | The trigger is already installed. systemd timers are strictly better than cron for this: catch-up, real logs (`journalctl`), no PATH/secret surprises |
| **Off-the-shelf** | BullMQ Job Schedulers (needs Redis), Agenda (Mongo), pg-boss (Postgres), Windmill/Hatchet/Temporal/n8n (server + DB ± Redis ± UI), `mcp-cron`-style MCP servers (a wrapper around a shell, alive only as long as the MCP client session) | See §3 — all work, none pay for themselves on one host at this scale |

## 3. Options

| # | Option | Job state | Who ticks | Dispatch to | New code | Ops burden | Unattended reliability | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Cron/systemd timer → `nx assign`** | Nexus tasks (no new columns) | systemd | existing pane | ~0 (one unit file) | none | medium: no lease, no retry, needs a pane to pre-exist | good to prove the loop today |
| 2 | **Nexus job table + one `nx job tick`** | Nexus SQLite (migration) | one invoker (§4.1) | pane; + spawn | small (schema, tick, dispatch adapter) | none beyond the invoker | high: lease + retry + run history, survives restart by construction | **recommended** |
| 3 | **Resident scheduler daemon inside Nexus** | Nexus SQLite | the Next.js process | pane | medium | a daemon to supervise | medium | **rejected** — breaks the non-goal; Next.js request/response is the wrong host for a long loop |
| 4 | **NagaBot routines as the dispatcher** | `.nagabot/routines.json` (per workspace) | NagaBot's 60 s loop | its own in-process pi session (not Herdr) | small (add herdr tool + mount socket) | low, but widens the sandbox | medium: at-least-once, no lease/retry; a crash before `nextRunAt` advances re-runs | runner-up, for self-contained agent jobs |
| 5 | **Herdr-native scheduler** | — | — | — | large | — | — | **not an option**: Herdr has no scheduling primitive, and should not grow one |
| 6 | **Pi Durable conductor: each job is a durable task that `sleep`s to `next_run_at`** | conductor SQLite/JSONL documents | the harness task scheduler | Herdr bridge (spawn/prompt/wait/read) | medium (the conductor from `DESIGN-agent-orchestrator.md`) | one service | **high**: checkpoints, resume after crash, exact-once submissions, tasks that wait | **not now** — it answers the orchestrator question (`28fed253`), not this one; a Herdr pane cannot be checkpointed, so it does not protect the work this dispatcher hands off |
| 7 | **Broker queue** (BullMQ / Agenda / pg-boss) | Redis / Mongo / Postgres | worker process | pane | medium | a broker + a worker to run and supervise | high on retries, but adds a datastore | over-built: another DB for one host |
| 8 | **Platform** (Windmill, Hatchet, Temporal, n8n, Kestra) | its DB | its server | HTTP/script; a Herdr call needs a bridge container with the socket | integration | **high**: server + DB ± Redis ± UI to run and upgrade | high | real value at team scale; tax here |
| 9 | **MCP "cron" server** | in-memory / its own file | the MCP client's session | whatever the tool shells to | small | none | **low**: not durable, tied to a session that must be alive; no catch-up | not for unattended |
| 10 | **Off-machine scheduler** (Cloudflare cron, GitHub Actions, k8s CronJob) | the cloud | the cloud | cannot reach the local Herdr socket | medium | low | high scheduling, but the target is on this machine behind a socket | wrong side of the boundary |

Two notes on the tempting rows:

- **Row 4 is not a rival to row 2 — it is a different execution model.** NagaBot
  routines run the *agent inside NagaBot*, sandboxed, with only `/workspace`.
  That is a fine place for "an LLM does a self-contained thing and reports", and
  it is the best today for exactly that. It is the wrong place for "start a
  worker in project X's folder and watch its pane", which is what this task asks.
- **Row 8's real cost is not money, it is surface.** Temporal/Windmill/n8n each
  add a service with its own datastore, auth, upgrades and failure modes, plus a
  bridge to reach a Unix socket — for a workload of, realistically, a handful of
  jobs a day on a single box.

## 4. Recommendation

**Job rows in Nexus SQLite, one `runDueJobs()` function, one single-instance
invoker. No new datastore, no queue, no Pi Durable.**

- **Storage:** a `jobs` table in the Nexus SQLite DB (a Drizzle migration like
  the others), plus a `job_runs` table for history. This keeps the one honest
  board: a human sees and edits jobs in the same place as tasks.
- **The tick is one function, not a service.** `runDueJobs()` reads the due rows,
  leases them, dispatches, and records; expose it as `nx job tick` (a one-shot
  CLI) and let any invoker call the same function. Placement then becomes an ops
  choice (§4.1) you can change without a rewrite.
- **Tick semantics:** read `enabled AND next_run_at <= now`, take a lease per row
  (`lease_owner`, `lease_until`) inside one SQLite transaction, dispatch each, then
  advance `next_run_at` and write a `job_runs` row. At-least-once with a lease is
  the honest guarantee; make the job prompt idempotent or mark jobs that are not.
- **Dispatch adapter:** reuse `DispatchTaskUseCase`/`HerdrPort`, with **one gap
  closed — spawn.** Today dispatch only prompts a pane that already exists and
  `--to auto` fails when no idle pane matches; an unattended job cannot depend on
  that. Give the job an explicit target (workspace + tab, or project folder) and
  the adapter: if the target pane is missing, `herdr pane split` +
  `agent start --kind pi --pane`; then `agent prompt --wait --until <state>`;
  then `agent read` for the result. This is the same "bridge" the design doc
  already reserves for Herdr.
- **Failure handling:** retries with backoff (`retry_count`, `max_retries`),
  a per-run timeout, `last_error` on the row, and a dead-letter state that flips
  the job off. A failed job should be visible as a job, not only as a log line.
- **Human surface:** `nx job list | show | run | pause | resume | edit`, the board
  view, and a `needs_human` ping whenever a job exhausts retries. Review-mode jobs
  (`kind=review`) are simply never auto-dispatched; they surface as a decision
  card and wait for `nx job approve`.
- **Safety defaults for unattended dispatch:** concurrency 1, a per-job and
  per-day budget cap, a global kill switch, and the rule that irreversible actions
  require the approval gate from `DESIGN-agent-orchestrator.md`. Unattended token
  spend is the real risk here, not disk.

### 4.1 Where the tick runs

The container already has what a tick needs: the SQLite file at `./data`, the
Herdr socket at `/herdr/herdr.sock`, and the image carries `scripts/` + `tsx`, so
`nx job tick` runs inside it as-is. Every placement below works; they differ in
blast radius and in where the config lives.

| Placement | Self-contained | Failure isolation | Notes |
| --- | --- | --- | --- |
| `setInterval` inside `next start` | best | **worst** | board and scheduler are one process: an unhandled scheduler error restarts the container and the board goes down with it — exactly when you want the board to show the failure; `next dev` HMR and any future replica duplicate the timer. **Rejected** |
| second process in the same container | good | poor | possible (`init: true`; the entrypoint `exec`s its args), but shared logs and no separate restart policy |
| **`jobs` service in the same `docker-compose.yml`** | good | **good** | same image, same `./data` and `/herdr` mounts, own `restart:` and `docker compose logs jobs`; still no host config. **Preferred** |
| **systemd timer → `nx job tick`** | weak | best | no new container, `Persistent=true` catch-up, `journalctl`; but the unit is repo-external config — the fragility the Nexus backup task (`4626eec6`) already has to document |
| cron line → `nx job tick` | weak | best | as above, without catch-up |

Two details are not optional whichever invoker you pick: open the DB with a
`busy_timeout` (better-sqlite3's `timeout`) so a tick never dies on `SQLITE_BUSY`
while the app is writing, and make lease + advance atomic, so a tick killed
mid-dispatch (the container's `stop_grace_period: 20s`) is recovered by the next
tick instead of lost.

Choosing the `jobs` service means **amending `PLAN.md`'s non-goal** (*"No
dispatcher daemon. No poller, no queue, no background scheduler."*). The rationale
behind it — don't blur "why has work stopped?" with "what is the scheduler
 doing?", don't duplicate Herdr — survives in a separate process with its own logs
and restart policy. The letter does not. That is an operator call.

**Not adopted: Pi Durable as the scheduler.** Its durable `sleep`, `resume` and
exactly-once submissions protect work that runs *inside a process*. This job's work
runs in a Herdr pane, which no framework can checkpoint or resume — so the
machinery buys almost nothing here, at the cost of a supervised service, a second
datastore and an experimental dependency. It becomes relevant only if execution
itself moves into the conductor (`DESIGN-agent-orchestrator.md`, `28fed253`), which
is a separate decision. Revisit if: jobs turn into multi-step workflows that span
days and branch on a result; the dispatcher starts doing LLM work in-process
rather than handing it to a pane; or the job count outgrows one tick.

**Runner-up — NagaBot routines.** Wins outright if the jobs you actually want are
"an LLM, in the workspace, with its tools, on a schedule" and you never need a
worker in another project's folder or a watched pane. It is zero new code and it
is already running. It loses on: shared job state (per-workspace JSON), spawning
and watching Herdr panes (no socket in the sandbox), durability (no lease/retry;
a crash mid-run re-runs), and cross-project work. If adopted, the right move is
not to extend it but to have its `routine` tool **create jobs on the Nexus
board**, so there is one job store rather than two.

**Explicitly rejected for now:** a resident scheduler in Nexus (breaks its stated
non-goal and its process shape), a broker (Redis/Mongo/PG for a handful of jobs),
a workflow platform (Temporal/Windmill/Hatchet/n8n — a server, a DB and a bridge
to supervise), a k8s CronJob (no k8s), and MCP cron servers (not durable, session
scoped, no catch-up).

## 5. Open questions for the operator

1. **Spawn or reuse?** A job target that spawns a fresh pane per run (board =
   "what is running") or one pinned idle pane per project (cheaper, serialises)?
2. **Concurrency and spend:** max concurrent jobs, and a daily token/€ cap. May a
   job dispatch an agent with **no human in the loop**, or must the first N runs
   be approved?
3. **Missed ticks:** when the machine was off across a job's slot, run once on
   wake or skip to the next slot? Per job, or global? (In-tick logic answers this
   for every invoker; systemd `Persistent=true` answers it for the timer only.)
4. **Where does the job list live for the operator** — the Nexus board, `nx job`
   only, or also NagaBot chat ("what's scheduled?")?
5. **Is NagaBot's `routine` tool to be reconciled** with the board jobs (one
   store), or left as a separate, in-process mechanism?
6. **Invoker, and the non-goal:** the compose `jobs` service (self-contained), or
   a host systemd timer (no new container)? The first amends `PLAN.md`'s "no
   dispatcher daemon".

## 6. Evidence

- **Herdr:** `herdr --help` and subcommands (no `schedule`/`cron`/`timer` token
  anywhere); `herdr agent {start,prompt,wait,read}`, `herdr pane {split,read,list}`,
  `herdr workspace list`, `events.subscribe`. `herdr agent start <name> --kind pi
  --pane <id>` requires an **existing** shell pane and waits for readiness.
- **Nexus:** `PLAN.md` (non-goals: *"Nexus observes and dispatches; it does not
  execute work"*, *"No dispatcher daemon. No poller, no queue, no background
  scheduler."*); `src/infrastructure/herdr/herdr-client.ts` (`HerdrPort` =
  `snapshot` + `prompt`); `src/application/tasks/dispatch-task/dispatch-task.usecase.ts`;
  `src/domain/tasks/dispatch-prompt.ts`; `src/app/api/tasks/[id]/dispatch/route.ts`;
  `src/cli/nx.ts` (`assign`, `claim`, `done`, `need`); `docker-compose.yml`
  (`~/.config/herdr:/herdr:ro`, `HERDR_SOCKET=/herdr/herdr.sock`);
  `ASSESSMENT-agent-orchestrator.md`, `DESIGN-agent-orchestrator.md`. No cron/
  scheduler dependency in `package.json`.
- **NagaBot:** `src/routines/{scheduler,run,store,schedule}.ts` (`TICK_MS =
  60_000`, `croner`, one routine at a time via a sequential `for … await`, JSON
  store, per-run markdown log, no retry/backoff, no execution lease); `src/tools/routine.ts`;
  `src/cli.ts` (web mode runs `watchRoutines` in parallel with the server);
  `docker-compose.yml` (read-only rootfs, only `${NAGABOT_WORKSPACE}:/workspace`,
  no Herdr socket); `package.json` (`croner`). Live: `nagabot-web-1` up.
- **Pi Durable:** npm `@earendil-works/pi-durable@1.0.3` (MIT, 2026-10-05);
  README ("task: a durable state machine that saves a checkpoint at every step",
  `harness.resume()`, `waiting` with `allSettled`/`failFast`); `dist/types.d.ts`
  — `/** Resolve once the Harness clock reaches \`until\` */ sleep(until, context)`
  and `now()`.
- **Host:** `which cron crontab systemctl herdr`; `crontab -l` (one CRM backup
  line at 03:00); `systemctl list-timers --all`; `docker ps` (compose only, no k8s).
  systemd `OnCalendar` + `Persistent=true` catch missed runs
  (ArchWiki/systemd.timer, SUSE docs).
- **Off-the-shelf:** BullMQ *Job Schedulers* (Redis) — docs.bullmq.io/guide/job-schedulers;
  Windmill *Schedules* — windmill.dev/docs/core_concepts/scheduling;
  Temporal/Hatchet comparisons — kestra.io "Temporal alternatives";
  `mcp-cron` — github.com/jolks/mcp-cron, mcpmarket.com/server/mcp-cron.
