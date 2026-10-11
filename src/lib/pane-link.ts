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
