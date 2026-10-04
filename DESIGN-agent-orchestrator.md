# Design — the agent orchestrator we should build

Task `28fed253` (nexus, high). Follows `ASSESSMENT-agent-orchestrator.md`, which
asked *which of the two* becomes the orchestrator. This document answers the
better question: **what should exist, and what is the proper experience.**

Design principle used throughout: **do not constrain to what we have.** Where an
existing component is the wrong shape, say so.

---

## 0. The one key finding

Everything this document used to ask us to hand-roll — durable runs, crash
resume, subagents, ownership trees, human approval gates, atomic app state,
multi-client attach and steering — already exists as a first-party product:
**Pi Durable** (`@earendil-works/pi-durable`, experimental, shipped with Pi 1.0).

- A **conversation** is an agent (model + thinking + tools + cwd).
- Everything the harness runs is a **task**; every step stores a checkpoint, so a
  process death resumes rather than repeats. Submissions carry a `requestId` and
  are exactly-once.
- A **subagent is a conversation owned by the tool call that started it** — a few
  lines of code, and it inherits durability, its own model/tools, its own cost.
- **Ownership forms a tree**; aborting a task aborts what it owns, bottom-up,
  with each task cleaning up its own effects.
- **Tasks** (`defineTask`) are durable state machines with phases, timers that
  survive restarts, `waiting` on other tasks with a `failFast` policy, and an
  `abort` that can undo effects.
- **Documents** are typed durable app state changed in the same atomic commit as
  the transcript, with fork semantics.
- **Hooks** (`beforeTool`, `afterTool`, `onYield`, `afterResponse`) can block a
  tool call — that is the human approval gate, and it survives a restart via `memo`.
- **Multiplayer**: any number of clients attach to any conversation, get current
  state first, then deltas; any client can steer.
- Tools run in an **execution environment** built per conversation, so the
  harness can run on one machine and the tools somewhere else.
- **Malleable**: the extension registry can be replaced while conversations run.

So the orchestrator is not a feature to add to a kanban app, and not a loop to
hand-write. **It is a Pi Durable application.** The design below is mostly about
what that application is, how it connects to the pieces already on this machine,
and what experience it must produce.

---

## 1. The experience

### 1.1 The story

> The operator is on their phone. They open one chat and type: *"Ship the Nexus
> R2 backup task."*
>
> The Manager asks two questions it actually needs answered, then produces a plan
> visible as a tree on the board: **research the CRM pipeline → port the code →
> tests → restore runbook**. Dependencies are drawn. Each leaf has a brief: what
> to do, what "done" means, what to touch, what artifact to produce.
>
> Workers start. Each gets its own git worktree and branch, its own model, and a
> bounded tool set. The board shows each one's state and a live transcript.
>
> The research worker finishes with a commit and a two-line summary. It did its
> job; the harness marks the task complete, records the artifact, and releases
> the next task — all without the manager's model being awake.
>
> The tests worker gets stuck: R2 credentials don't exist for Nexus. It escalates
> with a structured blocker. The manager reads the blocker, tries one resolution
> of its own, fails, and escalates to the human — which appears as a *decision
> card* on the phone: the exact question, the two options, a recommendation, and
> what happens next either way. The operator taps "reuse the CRM bucket, prefix
> `nexus/`". The worker resumes mid-task.
>
> The goal completes. The Manager posts a final report: the commits, the tests
> that ran, the one open question it handed back, and what the whole goal cost.
>
> Nothing about that conversation depended on any pane staying alive, or on the
> manager's context surviving. The machine could have rebooted at any point.

### 1.2 The principles that produce it

1. **One front door.** The operator gives a *goal*, not a pane assignment. They
   never pick an agent, a model, or a terminal.
2. **The plan is visible and editable.** Handover is a tree fact on the board,
   not prose in a description.
3. **Workers are disposable; the plan is durable.** A worker is a conversation
   with a brief. Killing it loses nothing but its attempt.
4. **The manager is durable too — and cheap.** It wakes at decision points
   (plan, judge, unblock, report), not to babysit. Durable tasks carry the loop.
5. **Escalation is a first-class path, not an error.** Blocker → manager decides →
   human decides → resume. Every hand-off is an event with a reason.
6. **Results are artifacts.** Every task ends with a commit/diff/files/tests and
   a short structured report. Never a chat message.
7. **Isolation is default.** Own worktree, own branch, per-role tool allowlist,
   per-task budget, no secrets unless granted.
8. **Everything is auditable and steerable.** A timeline per task; the operator
   can read any live transcript and steer or take over at any level.
9. **Unattended-safe.** Budget caps, concurrency caps, approval gates for
   irreversible actions, and a hard rule that unsafe effects never replay.
10. **Evidence beats opinion for routing.** Model/effort/runtime/cost per task is
    recorded, so "who should do this kind of work" becomes measurable later.

---

## 2. Architecture

Three roles, one durable core. The important move is that **the control plane is
not a Next.js app and not an LLM loop** — it is a Pi Durable harness process with
a deterministic task graph, and the LLM is invoked as one kind of task inside it.

```
┌──────────────────────────── surfaces (clients) ────────────────────────────┐
│  NagaBot chat (web/phone/CLI)   ·   Nexus board & goal view   ·   nx CLI    │
│  all are Pi Durable clients: current state first, then deltas; steerable     │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ HTTP (+ SSE/websocket deltas)
┌───────────────────────────────────▼────────────────────────────────────────┐
│  CONDUCTOR — a Pi Durable harness (new service, own process, SQLite)        │
│                                                                             │
│   conversations ......... the Manager (long-lived) + one per worker         │
│   durable tasks ......... plan · dispatch · wait · settle · escalate ·      │
│                           retry · report · budget · schedule                │
│   ownership tree ........ every worker conversation is owned by the task    │
│                           that started it → abort/undo propagates           │
│   documents ............. Goal, PlanNode, WorkerBrief, WorkerReport,        │
│                           Decision, Artifact, Timeline, Budget (durable,    │
│                           committed atomically with the transcript)         │
│   extensions ............ orchestration tools, roles, hooks (approval gate) │
└──────┬──────────────────────────────────────────┬───────────────────────────┘
       │ execution environment per conversation    │ adapter
┌──────▼───────────────────────┐        ┌─────────▼──────────────────────────┐
│ git worktree + shell + tools │        │ Herdr pane bridge (optional)       │
│ (NodeExecutionEnv, cwd =     │        │ start/prompt/wait/read a pane for  │
│  worktree/branch per task)   │        │ non-pi harnesses or when the human │
│                              │        │ wants to watch in a terminal       │
└──────────────────────────────┘        └────────────────────────────────────┘
```

### 2.1 Roles = conversations with different extensions, not different binaries

| Role | Model | Tools | Notes |
| --- | --- | --- | --- |
| **Manager** | strongest available; the expensive one | plan/delegate/status/decide/report + read-only code | one long-lived conversation per goal, or one per operator with a goal document set |
| **Worker** | chosen per task (cheap for docs/tests, strong for refactors) | read/edit/write/bash scoped to its worktree + `report`/`escalate` | one conversation per task |
| **Reviewer** | mid | read-only + `review` verdict | optional; a review hand-off before merge |
| **Human** | — | the decision inbox | never an LLM |

Because Pi Durable conversations store model + thinking + tool *names*, roles are
configuration, and routing is a policy field on the brief — not a code branch.

### 2.2 The execution environment is the isolation story

Each worker conversation gets an environment whose `cwd` is a fresh **git
worktree on its own branch** (for repo work; a scratch dir otherwise). This gives
file-level parallelism, a reviewable artifact, and a clean "throw it away"
semantic. Herdr already has `herdr worktree create`, and the same thing is 3 git
commands — do it in the conductor, not in the pane layer.

Non-repo tasks get a scratch env with a declared writable root. Secrets are
attached per task from a named grant, never inherited by default.

### 2.3 What each existing piece becomes

| Today | Becomes |
| --- | --- |
| **Herdr** (actuator, panes) | the *visible* execution surface and the bridge for non-pi harnesses. The durable workers don't need a pane; when the operator wants to watch or intervene by hand, the conductor can "promote" a worker to a pane and attach it. |
| **Nexus** (board, ledger) | the **projection + human UI**: the goal tree, the decision inbox, the timeline, the artifacts, the live transcripts. It stops owning the dispatch edge. |
| **NagaBot** | the **front door**: the conversational surface over the conductor (its own tools stay for everything else). It is a client, not the orchestrator. |
| **`nx` CLI** | unchanged for a human at a shell; gains `nx goal`, `nx tree`, `nx decide`, `nx watch`. Agents inside panes keep `claim`/`done`/`need` as the *pane-side* adapter into the same model. |
| **Nexus's `nx assign`** | superseded: "dispatch" becomes "the manager delegates a task to a worker conversation". Kept only as the pane bridge. |

---

## 3. Data model (Pi Durable documents)

Documents are durable, typed, and committed atomically with the transcript — this
replaces "tasks table plus hope".

```
Goal        { id, title, intent, doneWhen, owner, status, budget, createdAt }
PlanNode    { id, goalId, parentId, deps[], title, brief, role, routing,
              status, attempt, maxAttempts, lease, blocker?, artifactIds[] }
Brief       { objective, context[], doneWhen[], constraints[], deliverable,
              writableRoot, secretGrants[], budget, reportTo }
Report      { nodeId, status, summary, artifacts[], testsRun, blockers[],
              followUps[], confidence }
Decision    { id, nodeId?, question, context, options[], recommendation?,
              deadline?, answer?, answeredBy, answeredAt }
Artifact    { id, nodeId, kind: commit|pr|file|doc|url, ref, summary }
Timeline    { nodeId, at, kind: created|dispatched|prompt|state|escalated|
              decided|artifact|settled|failed, from, to, detail }
Budget      { scope: goal|node, tokens, cost, wallclock, hardLimit }
```

The **Timeline** is not a nice-to-have: it is how "why is this blocked?" gets
answered without asking an LLM. `PlanNode` + `deps` is the DAG the scheduler
walks.

Nexus's board tables stay, extended with `parent_id`, `deps`, `artifact`, and a
`timeline` read model — either the conductor writes them through the existing
REST API (one writer per concern; recommended), or Nexus reads the conductor's
documents read-only (fewer moving parts, but couples the board to the harness
SQLite). Recommendation: **conductor writes through the Nexus API**; the board
remains the single human-visible ledger.

---

## 4. The handover protocol (the actual product)

Handover types, all of them events on the timeline:

| Handover | From → To | Trigger |
| --- | --- | --- |
| **Decompose** | goal → plan nodes | manager planning task |
| **Delegate** | manager → worker | scheduler sees a ready node |
| **Return** | worker → manager | worker settles (report + artifact) |
| **Escalate** | worker → manager | structured blocker |
| **Ask** | manager → human | manager cannot/ must not decide |
| **Resume** | human → worker | decision answered; task re-enters `running` |
| **Reassign** | dead worker → new worker | lease expiry / failed attempt |
| **Review** | manager → reviewer → human | pre-merge gate (optional) |

Rules that make it trustworthy:

- **One protocol, not chat.** Workers never free-form message each other or the
  manager. They call `report`/`escalate`, which write documents. Inter-agent
  chatter is untraceable and loops; the board is the bus.
- **The manager is invoked, not resident.** Each handover that needs judgment
  starts a manager task with the relevant documents in context. The manager's
  conversation is durable but idle between decisions — cheap and restart-safe.
- **Every node has a lease.** `(worker conversation id, pane id?, expiresAt)`.
  Expired lease → node back to `ready`, `attempt++`, timeline event. This is what
  makes "a pane died" a non-event.
- **Bounded attempts and budget.** `maxAttempts` per node, hard budget per goal.
  Exhausting either escalates to the human rather than looping.
- **Irreversible effects never replay.** Tools declare `replay: "safe"` or not.
  Deploys, spends, sends, publishes are gated by a `beforeTool` hook that asks a
  human (or a standing grant), and the answer is memoized so a crash doesn't
  re-ask or re-do.
- **The brief is a contract.** A worker that cannot produce a valid `Report`
  must `escalate`. Free-text "done" is not a completion.

---

## 5. What the conductor actually runs (no separate daemon needed)

"Supervisor" is not a service that polls. It is a small set of durable tasks in
the same harness:

1. **`goal.plan`** — manager task: read the goal, emit plan nodes + briefs.
2. **`node.schedule`** — pure logic: when a node's deps settle and the budget and
   concurrency allow, dispatch. `waiting` on its dep tasks with `failFast`.
3. **`node.run`** — one per worker: create the worktree env, create the owned
   worker conversation with the brief, submit it, wait, then settle.
4. **`node.settle`** — validate the report, record artifacts, update the board,
   release dependents or escalate.
5. **`node.escalate`** — create a Decision; wake the manager; if the manager
   can't decide, route it to the human inbox and park the node (not `blocked`
   forever — `awaiting_decision` with a deadline and an owner).
6. **`goal.report`** — final summary, cost, open questions.
7. **`budget.tick`** / **lease reaper** — durable timers, so even a fully idle
   harness notices an expired lease or a blown budget.

Because these are Pi Durable tasks, the whole conductor can die and resume, and
the ownership tree guarantees that aborting a goal cleans up every worker
conversation and worktree it started, bottom-up.

---

## 6. Human-in-the-loop

The inbox is the operator's whole job:

- **Decision cards**, not notifications: question, context (links to the node,
  the attempt, the transcript), options, recommendation, deadline, and "what
  happens if you do nothing".
- Delivered where the operator is: NagaBot chat (web/phone) and push (ntfy — the
  machine already has `ntfy-test.sh`; a Telegram bot container already runs).
- **Approval gates** for irreversible actions, implemented as `beforeTool` hooks,
  so the gate is enforced in the harness, not by trusting the prompt.
- **Standing grants** ("this goal may merge its own worktrees", "may spend up to
  X") so unattended overnight goals are possible without endless prompts.
- **Takeover**: from any node, pause the worker, read the transcript, steer it,
  edit the brief, reassign it, or finish it by hand. The board and the chat are
  the same object seen two ways.

---

## 7. Delivery phases (and the tasks they become on the board)

Each phase is independently demonstrable; none is a rewrite of the previous.

**A. Prove the core (spike).** A Pi Durable app with: a manager conversation, a
`delegate` tool that spawns one owned worker conversation in a git worktree,
crash-resume demonstrated, and the goal/plan written to documents. No UI.
*This is the de-risking step — after it, everything else is product work.*

**B. Conductor task graph.** `goal.plan → node.schedule → node.run →
node.settle → node.escalate → goal.report`, with leases, `maxAttempts`,
concurrency and budget caps, and the lease reaper.

**C. Board projection.** Conductors writes goals/nodes/artifacts/timeline into
Nexus (small schema addition: `parent_id`, `deps`, `artifact`, `timeline`);
Nexus renders a **Goal tree view** (the DAG) next to the flat kanban, which
becomes a lens.

**D. Human gates + inbox.** `beforeTool` approval hook with memo; Decision
documents; inbox UI; ntfy/Telegram delivery; standing grants; `nx decide`.

**E. Front door.** NagaBot becomes a client of the conductor: create a goal,
watch the tree, read transcripts, answer decisions, steer — from web/phone/CLI.

**F. Herdr bridge.** Promote a worker to a visible pane; drive a non-pi harness
(Claude Code, Cursor's CLI, agy) through `agent start/prompt/wait/read`; and the
reverse: a pane agent that `nx claim`s work gets adopted as a worker conversation
so panes and durable workers are one population.

**G. Evidence-based routing.** Record model/effort/runtime/cost/outcome per node;
turn it into a routing policy ("docs → flash, refactors → the strong model").

**H. Polish.** Per-role prompt/extension packages, goal templates, replay-safe
tool audit, compaction tuning, operator preferences.

---

## 8. Decisions I am proposing (needed before Phase A)

1. **Build the conductor as a Pi Durable app**, in a new service next to Nexus
   (own process + own SQLite + own compose service), not inside the Next.js app
   and not inside NagaBot's sandbox.
2. **Nexus stays the human ledger/UI; the conductor owns orchestration state.**
   The conductor writes the board through the existing REST API.
3. **Workers are durable conversations by default**; Herdr panes are opt-in for
   visibility and for non-pi harnesses.
4. **One worktree + branch per task**, merged only by a reviewer/human gate.
5. **The manager is a role, not a pane**; NagaBot is the front door, not the
   brain.
6. **No free-form agent-to-agent chat.** Documents are the protocol.

## 9. Open questions for the operator

1. Goal ownership: one long-lived Manager per operator, or one per goal?
2. Default autonomy: may an unattended goal merge its own worktrees, or always
   require a human merge gate?
3. Where should the conductor live — new sibling folder `conductor/`, or a
   service inside the Nexus repo (`nexus/conductor/`)?
4. Is Cursor in scope for orchestrated work at all, or is pi-family (harness
   conversations) plus Claude Code/Agy via panes enough?
5. Budget defaults: per-goal token/cost ceiling and max concurrent workers.
