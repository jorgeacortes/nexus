# Design — the `dispatch` context (a real dispatcher, no `/tmp` scripts)

Status: **approved by the operator (2026-10-05)**, with the `/tmp` retirement gated
(see §8). This doc is the source for the `DSP-*` tasks on the board.

## 0. The decision, in one paragraph

Herdr owns terminal topology and Nexus owns the ledger, and today the only bridge
between them is an unversioned shell script in `/tmp` (`/tmp/joma-dispatch.sh`)
that creates tabs, starts agents and closes them on a timer. That script is what
killed a working agent with ~2400 lines of uncommitted work. We replace it with a
named bounded context, `dispatch`, inside Nexus: given a ready task and its
project, it ensures a place to run the agent, starts it, hands over the brief, and
tears the tab down **under guard**. Herdr is reached through a domain port; the
`dispatch` context is a one-shot function + CLI, never a daemon.

## 1. What exists today (verified)

| piece | fact |
| --- | --- |
| `HerdrPort` | exactly two operations — `snapshot()` and `prompt(paneId, text)`. No topology. |
| `src/domain/tasks/agent-prompt.ts` | the precedent for a **narrow domain port**: `AgentPromptPort`, adapted to `HerdrClient` in `src/infrastructure/container.ts`. |
| `nx assign` | an HTTP client call: `POST /api/tasks/[id]/dispatch` → `DispatchTaskUseCase` → `AgentPromptPort.prompt`. It **requires an existing pane**; `--to auto` fails when no idle pane matches. |
| topology automation | exactly one script, `/tmp/joma-dispatch.sh`: `nx task edit --status ready` → `herdr tab create` → `herdr agent start <slug> --kind pi` → `nx assign` → poll 45 s × N → `herdr tab close`. Outside version control. |
| Herdr capabilities we need | `workspace create`, `tab create --workspace --cwd --label`, `pane list --workspace`, `tab list --workspace`, `agent start <name> --kind <k> --pane <id>` (needs an *existing shell pane*), `agent list`, `pane process-info`, `tab close`. |
| no pre-close hook | `tab.close` takes only `tab_id`; `tab.closed`/`workspace.closed` are post-hoc events; plugins register keybinding actions, not interceptors. **A raw close cannot be made to fail.** |

Container notes that matter for placement: `docker-compose.yml` mounts
`~/.config/herdr:/herdr:ro` and sets `HERDR_SOCKET=/herdr/herdr.sock`, so the
server *can* reach the socket. That is not a reason to put a loop in Next.js — see §6.

## 2. Architecture

New bounded context, hexagonal, same shape as `projects` and `tasks`:

```
src/domain/dispatch/          harness.ts (HarnessPort), placement.ts (workspace/tab choice), close-guard.ts
src/application/dispatch/     ensure-workspace/, dispatch-task/, close-harness/, detect-lost-agents/
src/infrastructure/herdr/     HerdrClient implements HarnessPort (topology methods added)
src/infrastructure/db/nexus/  dispatches table (migration)
src/app/api/dispatch/         thin routes (POST dispatch, POST close) for nx + future callers
src/cli/nx.ts                 nx dispatch <task> | nx dispatch close <tab>
```

`AGENTS.md` currently says *"`projects` and `tasks` are the only bounded contexts"* —
this doc amends that to three, and `PLAN.md`'s non-goals are amended in §6.

### 2.1 The port

`HarnessPort` is a **port/gateway, not a repository** (repositories persist
aggregates in SQLite). It follows the `AgentPromptPort` precedent: a narrow
interface in `src/domain/dispatch/`, implemented by `HerdrClient` and wired in
`container.ts`. Domain and application code never touch the socket.

| read | write |
| --- | --- |
| `snapshot()` *(exists)*, `listWorkspaces()`, `listTabs(workspaceId)`, `listPanes(workspaceId)`, `agentStates()` *(exists as snapshot)*, `processes(paneId)` | `createWorkspace(label, cwd)`, `createTab(workspaceId, label, cwd)`, `startAgent(name, kind, paneId)`, `prompt(paneId, text)` *(exists)*, `closeTab(tabId)` |

`closeTab()` on the adapter stays dumb: **the decision to refuse belongs in the
application layer**, where it can read task state and be unit-tested.

### 2.2 Data

- **Live link stays where it is:** `tasks.herdr_pane_id` + `agent_name` + `harness`
  (written by the existing assign path). No new pointer is needed for the guard to
  join pane → task.
- **New `dispatches` row** (one per dispatch attempt): `id`, `task_id`, `tab_id`,
  `pane_id`, `agent_name`, `harness`, `workspace_id`, `lease_owner`, `lease_until`,
  `started_at`, `ended_at`, `outcome`. This buys (a) idempotency — the lease stops
  two racing dispatches from spawning two agents for one task, (b) the tab → task
  join the close guard wants, (c) history.
  **Lease semantics as implemented (DSP-4):** `lease_until` bounds only an attempt
  that has not yet started an agent; once `started_at` is set the open row holds
  the lease until an outcome ends it (`failed` / `expired` / `closed` / `lost`).
  A partial unique index (`dispatches_open_task_idx` on `task_id WHERE ended_at IS
  NULL`) enforces one open dispatch per task in the database, so the check and the
  insert cannot race even across processes. A crashed attempt that never started
  an agent is superseded as `expired` once its lease lapses.

## 3. Flows

### 3.1 `dispatch(taskId)` — the create flow
1. **Lease.** Take the task's dispatch lease in one SQLite transaction; refuse if
   held. (At-least-once with a lease is the honest guarantee.)
2. **Ensure the workspace** (`ensureWorkspace`): use `project.herdrWorkspaceId` **iff
   it appears in the snapshot**; otherwise find a live workspace by label/cwd;
   otherwise `createWorkspace(label = project name, cwd = project.folderPath)` and
   **persist the new id back onto the project**. That writeback is the repoint
   capability `03628cd3` needs; it also stops the dangling-pointer cascade for good.
3. **Choose the place** (`placement.ts`): reuse an idle pane already inside that
   workspace when one matches the task's folder, otherwise `createTab(label = task
   slug)`. Default is *reuse if idle, else a new tab per task*.
4. **Start the agent:** `startAgent(name, kind, paneId)` with
   `name = <task-slug>-<short-id>` — Herdr requires `[a-z][a-z0-9_-]{0,31}` and
   uniqueness among live agents. `kind` comes from the task's recorded harness.
5. **Assign:** `prompt(paneId, buildDispatchPrompt(task, project))`, then record
   `herdrPaneId`/`agentName`/`harness` on the task (the existing assign path) and
   close the dispatch row's start fields.
6. Return tab + pane; append the ephemeral check to the *caller's* log, not ours.

### 3.2 `close(tabId, {force})` — the guarded teardown
A tab is protected if **any** pane in it matches:

| pane state | close |
| --- | --- |
| agent `working` / `blocked` / `unknown` | refuse |
| agent `idle` **and** the pane owns a task that is not `done` | refuse |
| agent `idle`, owns no task, or its task is `done` | allow |
| agent `done` | allow |
| no recognized agent but `pane process-info` reports a foreground process | refuse |
| bare prompt, no agent, no foreground process | allow |

Refusal exits non-zero and names the pane, its agent and its status. **A close is
never triggered by a timeout** — that was the incident. Last-tab destruction is
deliberately *not* guarded (an empty workspace is cheap to recreate from the
project row); see the sibling decision recorded in `DSP-5`.

### 3.3 `detectLostAgents()` — the path we do not own
Because a raw `herdr tab close` cannot be blocked, the remaining control is
detection: Nexus already polls the snapshot every 5 s, so a non-idle agent that
disappears without a `done` becomes `needsHuman` on its task with a reason. Read-only.

### 3.4 Agent polling
Dispatch **pushes** the brief (`buildDispatchPrompt`); nothing in this design makes
the agent poll for work. `nx board` / `nx task show` remain the steering surface,
and `nx need` the escalation. Pull-based workers are explicitly not in scope.

## 4. Guardrails

- One dispatch per task at a time (lease).
- The dispatcher never closes on timeout and never closes a protected tab.
- Placement is explicit and logged; a missing pane is a *spawn*, never a silent
  `--to auto` failure.
- The sanctioned close is `nx dispatch close`; the guard lives in one place.

## 5. Relationship to the existing docs and tasks

- **`45f37354` (agent orchestrator, in_progress, operator decision).** This design
  does **not** supersede it; it is its Phase 0 — the execution edge the conductor
  will call. The conductor recommendation (own service, Pi Durable, durable
  conversations) is untouched and still awaiting the operator's six decisions.
- **`ASSESSMENT-periodic-job-dispatcher.md` / `8047850a`** already recommends a job
  table plus one `runDueJobs()` exposed as `nx job tick`, and names the one gap to
  close: **spawn** ("if the target pane is missing, `herdr pane split` +
  `agent start`; then `agent prompt`; then `agent read`"). The `dispatch` context
  *is* that edge. `runDueJobs()` calls `dispatch(taskId)`; no second mechanism.
- **`03628cd3`** (duplicate projects) keeps the "`nx project add` must not create a
  duplicate" half; the "supported way to repoint `herdrWorkspaceId`" half is
  delivered by §3.1 step 2.
- **`5f7325b7`** (guarded close) becomes `DSP-5`.

## 6. Non-goals we are amending (recorded, on purpose)

`PLAN.md` says two things this design contradicts, so the operator's approval is
recorded here rather than left implicit:

1. *"task automation itself (Nexus observes and dispatches; it does not execute
   work)"* — Nexus now **creates topology** (workspace, tab) and **starts agents**.
2. *"No dispatcher daemon. No poller, no queue, no background scheduler."* — **still
   true, and the design depends on it.** Nothing here runs on a timer inside
   Next.js. `dispatch()` is a one-shot function invoked by `nx dispatch` or by the
   future `nx job tick`; the invoker (host systemd timer vs compose one-shot) stays
   the ops choice the job-dispatcher assessment left open.

Net effect: Nexus gains an *actuator* it can call on demand, but gains no daemon.

## 7. Open questions

1. Invoker for the future tick: host systemd timer, or a compose one-shot service?
2. Reuse vs spawn default (reuse idle pane if present, else new tab) — confirm.
3. `dispatches` retention: keep history forever or prune with the auto-archive task?
4. Do non-pi harnesses (`claude_code`, `cursor`, `agy`) get `startAgent` in DSP-2,
   or is pi the only kind until the orchestrator lands?

## 8. Task breakdown

| code | task | depends on |
| --- | --- | --- |
| `DSP-1` | this doc + `PLAN.md` / `AGENTS.md` amendments | — |
| `DSP-2` | `dispatch` context + `HarnessPort` + Herdr topology adapter + wiring + tests against a fake port | DSP-1 |
| `DSP-3` | `ensureWorkspace`: resolve-or-create the project workspace, persist `herdrWorkspaceId` | DSP-2 |
| `DSP-4` | `nx dispatch <task>`: lease → ensure → place → start → assign | DSP-3 |
| `DSP-5` | guarded close + tests (was `5f7325b7`) | DSP-2 |
| `DSP-6` | `detectLostAgents()` → `needsHuman` | DSP-2 |
| `DSP-7` | retire `/tmp/joma-dispatch.sh` | DSP-4, **and joma must have no dispatch in flight** |

`DSP-7` is deliberately gated: `/tmp/joma-dispatch.sh` stays in place until the
replacement is verified *and* the current joma work in progress has finished.

## 9. Evidence

- Herdr CLI/API: `herdr tab close --help`; `herdr tab create --workspace --cwd
  --label --no-focus`; `herdr pane process-info --pane <id>` → `foreground_processes[]`;
  `herdr workspace create --label --cwd`; `herdr agent start <name> --kind pi
  --pane <id>`; `herdr api schema --json` (protocol 22) — `TabTarget` = `{tab_id}`
  only; no pre-close hook; `events.subscribe`/`events.wait` for post-hoc events.
- Live reproduction of the destructive close: a throwaway workspace (`wX`) whose
  only tab was closed returned `{"result":{"type":"ok"}}` with exit 0, and the
  workspace was gone on the next `workspace list` (`workspace_not_found`, exit 1).
- Nexus: `src/domain/tasks/agent-prompt.ts`; `src/infrastructure/container.ts`;
  `src/infrastructure/herdr/herdr-client.ts` (`HerdrPort` = `snapshot` + `prompt`);
  `src/application/tasks/dispatch-task/dispatch-task.usecase.ts`;
  `src/cli/nx.ts`; `docker-compose.yml` (`/herdr:ro`, `HERDR_SOCKET`).
- Scripts: `/tmp/joma-dispatch.sh` (the only topology automation; unversioned).
- Sibling decisions: `ASSESSMENT-agent-orchestrator.md`,
  `DESIGN-agent-orchestrator.md`, `ASSESSMENT-periodic-job-dispatcher.md`.
