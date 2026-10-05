/**
 * Where a dispatched agent runs: the pure choices the dispatcher makes before it
 * touches Herdr. Kept in the domain so they are unit-tested without a socket.
 *
 * Placement rule (DESIGN-dispatch.md §3.1): reuse a bare shell pane already in
 * the project's workspace when one sits in the task's folder, otherwise create a
 * tab per task. A pane already running an agent is never reused — Herdr cannot
 * start a second agent in it. Either way the tab the agent lands in is labelled
 * with the task (see `taskTabLabel`), never left as Herdr's `1`.
 */

import type { HarnessPane } from "@/domain/dispatch/harness";
import type { Harness } from "@/domain/tasks/task";

/** Herdr agent kind for each Nexus harness (the inverse of `harnessFromAgentKind`). */
const AGENT_KIND_BY_HARNESS: Record<Harness, string> = {
  pi: "pi",
  claude_code: "claude",
  cursor: "cursor",
  agy: "agy",
};

/** Herdr requires `[a-z][a-z0-9_-]{0,31}` for an agent name (max 32 chars). */
export const MAX_AGENT_NAME_LENGTH = 32;

/**
 * How long a task-derived Herdr tab label may be. Herdr caps nothing itself
 * (`tab.create`/`tab.rename` take an unbounded string; verified against protocol
 * 22), so an operator-authored title of any length would otherwise reach the tab
 * bar: the operator's own labels are 4–16 chars, while one task here slugged to
 * 88. The cap keeps the label scannable; it is not a protocol requirement.
 */
export const MAX_TAB_LABEL_LENGTH = 48;

/** The Herdr `--kind` to start for a task's recorded harness; pi when it has none. */
export function agentKindForHarness(harness: Harness | null | undefined): string {
  return harness ? AGENT_KIND_BY_HARNESS[harness] : "pi";
}

/** Expands `~` and drops a trailing slash, so two spellings of a folder compare equal. */
export function expandHome(folder: string): string {
  const home = process.env.HOME ?? "";
  const expanded = folder.startsWith("~/") && home ? `${home}/${folder.slice(2)}` : folder;
  return expanded.replace(/\/+$/, "");
}

/** A Herdr-safe slug from a task title: lowercase, `[^a-z0-9]` → `-`, never empty. */
export function taskSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "task" : slug;
}

/**
 * The Herdr tab label for a task: its slug, capped so an operator-authored title
 * of any length stays scannable. A cut is marked with `…` and taken at the last
 * `-` boundary, so the label does not end mid-word when it does not have to.
 */
export function taskTabLabel(title: string): string {
  const slug = taskSlug(title);
  if (slug.length <= MAX_TAB_LABEL_LENGTH) return slug;
  const cut = slug.slice(0, MAX_TAB_LABEL_LENGTH - 1);
  const boundary = cut.lastIndexOf("-");
  return `${boundary > 0 ? cut.slice(0, boundary) : cut}…`;
}

/**
 * The unique Herdr agent name for a task: `<task-slug>-<short-id>`. The short id
 * keeps it unique among live agents; the slug makes it readable. Truncation
 * happens before the suffix so the id is never cut, and a leading non-letter is
 * prefixed so the name satisfies Herdr's `[a-z]` start.
 */
export function agentNameForTask(task: { id: string; title: string }): string {
  const short = task.id.replace(/-/g, "").slice(0, 8);
  const suffix = `-${short}`;
  let slug = taskSlug(task.title);
  if (!/^[a-z]/.test(slug)) slug = `task-${slug}`;
  const room = MAX_AGENT_NAME_LENGTH - suffix.length;
  slug = slug.slice(0, room).replace(/-+$/g, "");
  return `${slug}${suffix}`;
}

export type Placement = { kind: "reuse"; pane: HarnessPane } | { kind: "new_tab" };

function inFolder(cwd: string | null, folder: string | null): boolean {
  if (folder === null) return true;
  return cwd !== null && expandHome(cwd) === expandHome(folder);
}

/**
 * The deterministic placement for a task in a workspace. Only a pane with no
 * live agent (`agent === null`, a bare shell) and a cwd inside the task's folder
 * is reusable; ties break on pane id so the choice is reproducible in tests.
 */
export function choosePlacement(panes: readonly HarnessPane[], folder: string | null): Placement {
  const reusable = panes
    .filter((pane) => pane.agent === null && inFolder(pane.cwd, folder))
    .sort((a, b) => a.paneId.localeCompare(b.paneId));
  const [first] = reusable;
  return first ? { kind: "reuse", pane: first } : { kind: "new_tab" };
}
