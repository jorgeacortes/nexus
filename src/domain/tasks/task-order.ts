/**
 * Task ordering: one comparator shared by the board and any in-app list, so a
 * recently touched card floats to the top of its column instead of sitting
 * under a high-priority task nobody has looked at for a week.
 *
 * "Last activity" (`updatedAt` desc) is the default; priority is the tiebreak,
 * so a blocker still wins when two tasks were touched in the same instant. The
 * "priority" sort flips the two, preserving the previous planning view. The id
 * is the final tiebreak so equal timestamps never reorder on every render.
 */

import { TASK_PRIORITY_ORDER, type TaskPriority } from "@/domain/tasks/task";

export const TASK_SORTS = ["activity", "priority"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** The order the board uses unless a `?sort=` says otherwise. */
export const DEFAULT_TASK_SORT: TaskSort = "activity";

/** The fields ordering reads; satisfied by both the domain task and its DTO. */
export type TaskOrderable = {
  id: string;
  priority: TaskPriority | null;
  updatedAt: Date | string;
};

function priorityRank(priority: TaskPriority | null): number {
  return TASK_PRIORITY_ORDER[priority ?? "normal"] ?? TASK_PRIORITY_ORDER.normal;
}

function activityAt(task: TaskOrderable): number {
  return new Date(task.updatedAt).getTime();
}

export function compareTasks(a: TaskOrderable, b: TaskOrderable, sort: TaskSort = DEFAULT_TASK_SORT): number {
  if (sort === "priority") {
    return (
      priorityRank(a.priority) - priorityRank(b.priority) || activityAt(b) - activityAt(a) || a.id.localeCompare(b.id)
    );
  }
  return (
    activityAt(b) - activityAt(a) || priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id)
  );
}

/** A sorted copy; the caller keeps its own array. */
export function sortTasks<T extends TaskOrderable>(tasks: readonly T[], sort: TaskSort = DEFAULT_TASK_SORT): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, sort));
}
