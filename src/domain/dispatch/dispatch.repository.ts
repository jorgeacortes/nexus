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

export type RecordSeenInput = {
  /** The pane's live agent status at this sighting. */
  status: string;
  seenAt: Date;
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
  /**
   * Ends the task's open row — if any — as `closed`, the success outcome: the
   * task reached `done`, so its work is over and the lease must stop being held
   * (DSP-8). Returns the ended row, or null when the task had none. A ledger
   * write only: it never touches Herdr. `failed` / `lost` / `expired` still go
   * through `finish`, so this adds only the success case.
   */
  finishOpenForTask(taskId: string, endedAt: Date): Promise<Dispatch | null>;
  /**
   * Ends every open row placed on the tab as `closed` and returns them. The
   * guarded close calls this once it has proved no pane in the tab holds live
   * work (DSP-8). A ledger write only: Herdr is already closed by then.
   */
  finishOpenForTab(tabId: string, endedAt: Date): Promise<Dispatch[]>;
  /**
   * Refreshes an open row's last observed agent status. A ledger write, never a
   * Herdr call: `detectLostAgents` runs it each sweep for panes still present so
   * a later sweep can name the status when the pane disappears.
   */
  recordSeen(id: string, input: RecordSeenInput): Promise<void>;
  /** Every open row (`endedAt` null), the candidate set for lost-agent detection. */
  listOpen(): Promise<Dispatch[]>;
  findById(id: string): Promise<Dispatch | null>;
  /** The live (open) dispatch for a task, if any. */
  findOpenByTaskId(taskId: string): Promise<Dispatch | null>;
  /**
   * Every open row placed on the tab (`endedAt` null). The guard's second join
   * (DSP-10): a dispatch that reached placement but crashed before writing
   * `tasks.herdr_pane_id` leaves no task pointing at its pane, yet its row still
   * names the tab. Ordered by `createdAt`, like `listOpen`.
   */
  findOpenByTabId(tabId: string): Promise<Dispatch[]>;
  findByTaskId(taskId: string): Promise<Dispatch[]>;
}
