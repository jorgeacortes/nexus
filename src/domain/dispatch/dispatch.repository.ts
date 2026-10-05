/**
 * Port owned by the dispatch context: persistence for the `dispatches` ledger.
 * A repository (rows in SQLite), unlike `HarnessPort`, which is a gateway to an
 * external system.
 *
 * `acquireLease` is the one method that must be atomic — it is the idempotency
 * guard the whole flow rests on — so its implementation takes the lease in a
 * single SQLite transaction and refuses (throws `DispatchLeaseHeldError`) while
 * a live row exists for the task.
 */

import type { Dispatch, DispatchOutcome } from "@/domain/dispatch/dispatch";
import type { Harness } from "@/domain/tasks/task";

export type AcquireLeaseInput = {
  taskId: string;
  leaseOwner: string;
  /** The caller's clock, passed in so tests are deterministic. */
  now: Date;
  leaseUntil: Date;
};

export type RecordPlacementInput = {
  workspaceId: string;
  tabId: string | null;
  paneId: string;
};

export type RecordStartInput = {
  agentName: string;
  harness: Harness;
  startedAt: Date;
};

export interface DispatchRepository {
  /**
   * Takes the task's dispatch lease in one transaction. A stale, unstarted row
   * (its `leaseUntil` has passed) is ended as `expired` and superseded; a started
   * row or a live unstarted one raises `DispatchLeaseHeldError`.
   */
  acquireLease(input: AcquireLeaseInput): Promise<Dispatch>;
  /** Records the chosen place (workspace/tab/pane) as soon as it exists. */
  recordPlacement(id: string, input: RecordPlacementInput): Promise<Dispatch>;
  /** Records the started agent's unique name and harness. */
  recordStart(id: string, input: RecordStartInput): Promise<Dispatch>;
  /** Ends an open row with an outcome. Never touches Herdr. */
  finish(id: string, outcome: DispatchOutcome, endedAt: Date): Promise<Dispatch>;
  findById(id: string): Promise<Dispatch | null>;
  /** The live (open) dispatch for a task, if any. */
  findOpenByTaskId(taskId: string): Promise<Dispatch | null>;
  findByTaskId(taskId: string): Promise<Dispatch[]>;
}
