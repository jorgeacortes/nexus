/**
 * Which task a Herdr pane is actually on, and how a card may use that link.
 *
 * A finished task keeps `herdrPaneId` as provenance. The pane's current task is
 * the `in_progress` one that names it; live status, model, and effort belong to
 * that card alone. This module imports nothing so `nx` can load it by a
 * relative path — the CLI resolves no `@/` alias.
 */

export type PaneOwnedTask = {
  id: string;
  status: string;
  herdrPaneId: string | null;
};

/**
 * Map each pane to the `in_progress` task that owns it.
 * A later in-progress task for the same pane replaces an earlier one; tasks in
 * any other status never count, so a done card cannot steal the pane.
 */
export function currentTaskByPane<T extends PaneOwnedTask>(tasks: readonly T[]): Map<string, T> {
  const current = new Map<string, T>();
  for (const task of tasks) {
    if (task.status === "in_progress" && task.herdrPaneId) {
      current.set(task.herdrPaneId, task);
    }
  }
  return current;
}

/** What a card may render for the pane id stored on the task. */
export type LinkedPaneState = "current" | "reused" | "offline" | "none";

/**
 * Live facts (status dot, model, effort) are shown only while this task is the
 * pane's current task and the pane is still in the snapshot. A live pane that
 * belongs to some other task — or to none — is `reused`. A recorded pane that
 * is absent from the snapshot is `offline`. No pane id is `none`.
 */
export function linkedPaneState(
  task: PaneOwnedTask,
  currentByPane: ReadonlyMap<string, { id: string }>,
  paneOnline: boolean,
): LinkedPaneState {
  if (!task.herdrPaneId) return "none";
  if (!paneOnline) return "offline";
  return currentByPane.get(task.herdrPaneId)?.id === task.id ? "current" : "reused";
}
