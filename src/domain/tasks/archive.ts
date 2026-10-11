/**
 * Archive rules. A finished task leaves the board after `ARCHIVE_AFTER_MS`;
 * it is not deleted and it does not become a sixth status.
 *
 * The clock is an argument. This module does not call `Date.now()` or
 * `new Date()` — the sweep use case injects `now`, and tests pass a fixed one.
 */

import { type Task, TaskTransitionError } from "@/domain/tasks/task";

/** How long a `done` task stays on the board before the sweep archives it. */
export const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Completions strictly older than this instant are eligible. A task completed
 * exactly `ARCHIVE_AFTER_MS` ago is not yet older than the interval.
 */
export function completedBeforeArchive(now: Date): Date {
  return new Date(now.getTime() - ARCHIVE_AFTER_MS);
}

/**
 * Eligible when the task is `done`, its completion is older than
 * `ARCHIVE_AFTER_MS`, and it is not already archived. Status is required:
 * a reopened task that still carries a stale `completedAt` is not eligible.
 */
export function isArchiveEligible(task: Pick<Task, "status" | "completedAt" | "archivedAt">, now: Date): boolean {
  if (task.status !== "done" || task.archivedAt !== null || task.completedAt === null) return false;
  return task.completedAt.getTime() < completedBeforeArchive(now).getTime();
}

/** Stamps `archivedAt`. The row stays `done`; nothing else is cleared. */
export function archiveTask(task: Task, now: Date): Task {
  if (!isArchiveEligible(task, now)) {
    throw new TaskTransitionError(`Task ${task.id} is not eligible to archive.`);
  }
  return { ...task, archivedAt: now, updatedAt: now };
}

/**
 * Puts an archived task back on the board as `ready` and clears `archivedAt`
 * and `completedAt`. Clearing the completion is what stops the next sweep from
 * archiving it again — eligibility requires `done` and an old `completedAt`.
 * Review is cleared too, because the task is no longer `done`.
 */
export function unarchiveTask(task: Task, now: Date): Task {
  if (task.archivedAt === null) {
    throw new TaskTransitionError(`Task ${task.id} is not archived.`);
  }
  return {
    ...task,
    status: "ready",
    archivedAt: null,
    completedAt: null,
    reviewedAt: null,
    updatedAt: now,
  };
}
