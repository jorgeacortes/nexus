# Dispatch

`dispatch` puts one ready task in front of an agent. Given the task and its
project, it ensures a Herdr workspace, places a pane, starts the harness, hands
over the brief, and records the assignment. Tear-down is a separate command and
goes through the close guard.

It is a one-shot function: `nx dispatch <task>` and `POST /api/dispatch`. The
Next.js process does not poll, queue, or schedule it. A stored job is a
different caller — see Jobs below.

## Layout

```
src/domain/dispatch/          HarnessPort, placement, close guard
src/application/dispatch/     ensure-workspace, dispatch-task, close-harness, detect-lost-agents
src/infrastructure/herdr/     HerdrClient implements HarnessPort
src/infrastructure/db/        dispatches table
src/app/api/dispatch/         POST dispatch, close, detect
src/cli/nx.ts                 nx dispatch | nx dispatch close | nx dispatch detect
```

`HarnessPort` is a port, not a repository. Domain and application code never
touch the Herdr socket. `closeTab()` on the adapter stays dumb: the decision to
refuse a close reads task state in the application layer, where it is
unit-tested.

## Ledger

The live link stays on the task: `herdr_pane_id`, `agent_name`, `harness`.

Each attempt is a `dispatches` row: `id`, `task_id`, `tab_id`, `pane_id`,
`agent_name`, `harness`, `workspace_id`, `lease_owner`, `lease_until`,
`started_at`, `ended_at`, `outcome`, `last_seen_status`, `last_seen_at`. The
row is the lease (one open dispatch per task), the tab → task join the close
guard uses, and the history of the attempt. Ended rows stay; nothing prunes
them.

`lease_until` bounds only an attempt that has not started an agent. Once
`started_at` is set, the open row holds the lease until an outcome ends it
(`failed`, `expired`, `closed`, `lost`). A partial unique index on `task_id
WHERE ended_at IS NULL` enforces one open row per task. A crashed attempt that
never started an agent is superseded as `expired` once its five-minute lease
lapses.

## `dispatch(taskId)`

1. **Lease.** Take the lease in one SQLite transaction. Refuse while one is
   held. The lease precedes every Herdr call.
2. **Ensure the workspace.** Use `project.herdrWorkspaceId` when that workspace
   is in the snapshot; otherwise match a live workspace by label or folder;
   otherwise create one (`label` = project name, `cwd` = `folderPath`) and
   write the new id back onto the project. A project with no folder is not
   created.
3. **Place.** Reuse a bare shell pane (`agent === null`) whose cwd is the task
   folder. Otherwise create a tab. A pane that already runs an agent is never
   reused. Ties break on pane id.
4. **Label the tab.** The tab the agent lands in carries the task slug, capped
   at 48 characters, cut on a `-` boundary and marked with `…`. A new tab is
   created with that label. A reused tab is renamed only when the agent will be
   its only pane. Herdr itself does not cap the label.
5. **Start.** `startAgent` with `name = <task-slug>-<short-id>` (Herdr requires
   `[a-z][a-z0-9_-]{0,31}`) and `kind` from the task's harness (`pi`, `claude`,
   `cursor`, `agy`). A task with no harness starts `pi`. The readiness wait
   defaults to 30 seconds.
6. **Assign.** Prompt the pane with `buildDispatchPrompt`, then record the
   pane and the live agent identity from the snapshot. The started name is not
   the identity: `agentStateForPane` is.

A failure after placement ends the row as `failed` and flags the task
`needs_human`, naming the tab and pane. Nothing is closed on that path.

A dispatch-created workspace keeps a single tab — the agent's. There is no
companion idle shell. A dead `herdrWorkspaceId` is repaired by step 2, and an
empty workspace is cheap to recreate from the project row.

## Close

`nx dispatch close <tab-id>` (`POST /api/dispatch/close`) is the close path
Nexus controls. Herdr's `tab.close` takes only a tab id, so a raw close cannot
be made to fail. A close is never fired by a timeout.

A tab is protected when **any** pane matches:

| pane state | close |
| --- | --- |
| agent `working` / `blocked` / `unknown` | refuse |
| agent `idle` and its task is not `done` | refuse |
| agent `idle`, owns no task, or its task is `done` | allow |
| agent `done` | allow |
| no recognized agent, but a foreground process other than the pane's own shell | refuse |
| bare prompt, no agent, no foreground process | allow |
| an open, lease-held `dispatches` row for the tab whose task is not `done` | refuse |

The last row covers a dispatch that placed a tab and died before writing
`tasks.herdr_pane_id`. A row whose unstarted lease has lapsed does not block.
A row whose task cannot be read refuses. Refusal exits non-zero and names the
pane, its agent, and its status; the tab stays open.

Closing a workspace's last tab destroys the workspace. That case is not
guarded.

When a close is allowed, the tab's open dispatch rows end as `closed`. A task
that reaches `done` ends its open row the same way. Both are ledger writes; the
tab is left alone until someone closes it.

## Detect

`nx dispatch detect` (`POST /api/dispatch/detect`) runs once per call. An open,
started dispatch whose pane has left the snapshot, and whose task is not
`done`, ends as `lost` and sets `needs_human` with the last seen status. A live
pane only refreshes `last_seen_status`. The sweep never closes, spawns, or
prompts.

## What the agent does

Dispatch pushes the brief. The agent does not poll for work. `nx board` and
`nx task show` are how a person steers; `nx need` is the escalation.

## Guardrails

- One dispatch per task at a time.
- The dispatcher never closes on timeout and never closes a protected tab.
- A missing pane is a spawn (a new tab), never a silent `nx assign --to auto`
  failure. `nx assign` still requires a pane that already exists.
- The sanctioned close is `nx dispatch close`. The guard lives in one place.

## Jobs

A stored job does not take a task lease and does not call `dispatch(taskId)`.
A spawn run places its pane with the same rules — ensure the project workspace,
reuse a bare shell in that folder or create a tab, start the agent — in
`placeJobPane`. The tick is `pnpm jobs:tick` (`scripts/jobs-tick.ts`), which
the compose `jobs` service runs with `--loop`. It stays outside Next.js.
`JOBS_ENABLED` defaults off. Job kinds, caps, and the review/poll behaviour are
in `AGENTS.md`.
