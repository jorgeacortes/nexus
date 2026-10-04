---
name: nx-tasks
description: Take, create, and finish Nexus tasks with the `nx` CLI — the task board for this machine. Use when the operator says "take task #N", "work the board", "what's left on <project>", asks for board or task status, or when you need to claim, complete, create, or flag a task, or dispatch one to a Herdr pane.
---

# Nexus tasks (`nx`)

Nexus is the task board for this machine. `nx` is a thin HTTP client over
`NEXUS_URL` (default `http://localhost:3100`, the dev server; the Docker instance
is `http://localhost:3210` unless `HOST_PORT` changed). The wrapper is on PATH at
`~/.local/bin/nx`. **Never edit task rows directly** — always go through `nx`.

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

- `nx board [--watch]` — the live join of tasks × Herdr agents (read-only).
- `nx task add <project> "<title>" --status ready` — create work; `ready` means an
  agent can claim it, `backlog` (default) means not yet.
- `nx project list` / `nx project add <name> --folder <path> --workspace <id>`.
- `nx need <id> --reason "..."` — flag that this needs the operator.
- `nx assign <id> --to <pane-id|auto>` — push the task's prompt into a Herdr pane
  (operator action; `auto` = the idle pane inside the project folder).

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
invalid transition, or `cannot reach Nexus`. Read it and adjust; if Nexus is
unreachable, report it — do not retry blindly or guess a URL.
