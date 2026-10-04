---
name: nx-tasks
description: Take, create, and finish Nexus tasks with the `nx` CLI — the task board for this machine. Use when the operator says "take task #N", "work the board", "what's left on <project>", asks for board or task status, or when you need to claim, complete, create, or flag a task, or dispatch one to a Herdr pane.
---

# Nexus tasks (`nx`)

Nexus is the task board for this machine. `nx` is a thin HTTP client; the wrapper
is on PATH at `~/.local/bin/nx`. It finds the board by itself — `NEXUS_URL`, then
`~/.config/nexus/env`, then a probe of the local ports (the Docker instance on
`HOST_PORT`, default 3210, before the dev server on 3100) — and prints which board
it reached, so you never pass a URL. **Never edit task rows directly** — always go
through `nx`.

## The loop: taking work

1. `nx task list` — or `nx task list <project> --status ready` — to find work.
2. `nx claim <id>` — **before doing anything else.** This records your pane as the
   owner (`$HERDR_PANE_ID`, auto-detected, never typed) and moves the task to
   `in_progress`; it is what tells the board you are on it.
3. Do the work.
4. `nx done <id> --notes "<commit / PR / artifact>"` — **always**, with the reference.

`nx task show <id>` prints the whole card. A task id may be abbreviated to any
unique prefix, and `--json` works on every command.

## Other commands

- `nx ping` / `nx doctor` — which board you are on, and what every candidate
  answered. Run `nx ping` when a command says no board answered.
- `nx board [--watch]` — the live join of tasks × Herdr agents (read-only).
- `nx task add <project> "<title>" --status ready` — create work; `ready` means an
  agent can claim it, `backlog` (default) means not yet.
- `nx task edit <id> [--title <text>] [--description <text>] [--status <status>] [--project <name>] [--priority <level>]` —
  update fields on an existing task.
- `nx project list` / `nx project add <name> --folder <path> --workspace <id>`.
- `nx need <id> --reason "..."` — flag that this needs the operator.
- `nx assign <id> --to <pane-id|auto>` — push the task's prompt into a Herdr pane
  (operator action; `auto` = the idle pane inside the project folder).

## Two things that look like failures but are not

- A probed board with **no projects** refuses writes
  (`refusing to write to a probed board`). That guard exists because the empty dev
  database lives one port away; if the board really is new, pass `--force`.
- Nothing answering means no board is running: start one (`pnpm docker:up`, or
  `pnpm dev` in the Nexus repo) or set `NEXUS_URL`. Do not guess a port.

## Rules

- Always claim before starting, always `done` when finished.
- Work one task at a time. A claim on a task another pane holds is rejected — that
  is intended; do not retry or force it.
- Prefix your first reply with `[#<short-id>]` so the board can associate this pane
  with the task even before the claim lands.
- If you need the operator, do not park the status: `nx need <id> --reason "..."`.
- `blocked` means the work cannot move forward right now — never use it just to stop.

## Errors

`nx` exits non-zero and prints one line: unknown project/task, already claimed,
invalid transition, or `cannot reach Nexus`. Read it and adjust; `nx doctor` lists
the boards that answer. If Nexus is unreachable, report it — do not retry blindly
or guess a port.
