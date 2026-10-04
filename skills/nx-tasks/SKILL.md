---
name: nx-tasks
description: Take, work, and finish Nexus tasks from a Herdr pane with the `nx` CLI. Use when the operator says "take task #N", "work the board", "what's left on <project>", asks for task status, or when you need to claim/complete/flag work.
---

# Nexus tasks (`nx`)

Nexus owns the task board; `nx` is a thin HTTP client over `NEXUS_URL` (default
`http://localhost:3100`). **Never edit task rows directly** — always go through `nx`.

## The loop

1. `nx task list` — or `nx task list <project> --status ready` — to find work.
2. `nx claim <id>` — **before doing anything else.** This records your pane as the
   owner and moves the task to `in_progress`; it is what tells the board you are on it.
3. Do the work.
4. `nx done <id> --notes "<commit / PR / artifact>"` — **always**, with the reference.

`nx task show <id>` prints the whole card. A task id may be abbreviated to any
unique prefix. Add `--json` to any command for scripting.

## Rules

- Always claim before starting, always `done` when finished.
- Work one task at a time. A claim on a task another pane holds is rejected — that
  is intended; do not retry or force it.
- Prefix your first reply with `[#<short-id>]` so the mission-control board can
  associate this pane with the task even before the claim lands.
- If you need the operator, do not park the status: `nx need <id> --reason "..."`.
- `blocked` means the work cannot move forward right now — never use it just to stop.
- Create work with `nx task add <project> "<title>" --status ready` (a `ready`
  task is one an agent can claim).

## Errors

`nx` exits non-zero and prints one line: unknown project/task, already claimed,
invalid transition. Read it and adjust; do not retry blindly.
