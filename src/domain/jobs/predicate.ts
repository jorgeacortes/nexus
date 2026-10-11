/** A ready task that nobody has claimed, and that has sat that way for a day. */
export const STALE_READY_TASK_MS = 24 * 60 * 60 * 1000;

export type ReadyTaskFact = {
  status: string;
  claimedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
};

export function hasStaleReadyTask(tasks: readonly ReadyTaskFact[], now: Date): boolean {
  const cutoff = now.getTime() - STALE_READY_TASK_MS;
  return tasks.some(
    (task) =>
      task.status === "ready" &&
      task.claimedAt === null &&
      task.archivedAt === null &&
      task.updatedAt.getTime() <= cutoff,
  );
}
