/**
 * `nx task list` ordering, mirroring the board's `compareTasks`.
 *
 * Kept separate from `src/domain/tasks/task-order.ts` on purpose: the CLI is a
 * standalone HTTP client whose only runtime imports are relative (it resolves no
 * `@/` alias), so it cannot reach into the app's domain code. This duplicates
 * the small comparator the way `nx.ts` already duplicates the status and
 * priority vocabularies.
 */

export const TASK_SORTS = ["activity", "priority"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const DEFAULT_TASK_SORT: TaskSort = "activity";

const PRIORITY_ORDER: Record<string, number> = { blocker: 0, high: 1, normal: 2, low: 3, someday: 4 };

type Orderable = { id: string; priority: string; updatedAt: string };

function priorityRank(priority: string): number {
  return PRIORITY_ORDER[priority] ?? PRIORITY_ORDER.normal;
}

function activityAt(task: Orderable): number {
  return new Date(task.updatedAt).getTime();
}

/** Last activity first (priority as tiebreak), or priority first when asked. */
export function compareTasks(a: Orderable, b: Orderable, sort: TaskSort = DEFAULT_TASK_SORT): number {
  if (sort === "priority") {
    return (
      priorityRank(a.priority) - priorityRank(b.priority) || activityAt(b) - activityAt(a) || a.id.localeCompare(b.id)
    );
  }
  return (
    activityAt(b) - activityAt(a) || priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id)
  );
}
