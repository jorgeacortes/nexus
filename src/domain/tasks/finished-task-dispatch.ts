/**
 * Port owned by the tasks context: releases a finished task's dispatch lease.
 *
 * A `dispatches` row holds its task's lease while it is open (DESIGN-dispatch.md
 * §2.2) and the lease is only released by an outcome. A task that reaches `done`
 * has no work left, so its open row must end as `closed`; without that the row
 * holds the lease forever and the finished task can never be dispatched again
 * (DSP-8). Implemented over the dispatch ledger by the composition root, which
 * is where the tasks context's "work is over" meets the dispatch context's
 * `closed` outcome.
 *
 * This is a ledger write only: it never touches Herdr, never closes a tab, and
 * never ends a dispatch whose task has not finished.
 */
export interface FinishedTaskDispatchPort {
  /**
   * Ends the task's open dispatch row as `closed`. No-op when the task has no
   * open row; idempotent, so a retry is harmless.
   */
  endOpenForTask(taskId: string): Promise<void>;
}
