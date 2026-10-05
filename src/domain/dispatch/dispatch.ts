/**
 * The `dispatch` aggregate: one row per dispatch attempt for a task.
 *
 * Nexus owns the ledger, Herdr owns terminal topology. A dispatch row is the
 * bridge: it takes a **lease** on the task before any topology is touched, then
 * records the placement (workspace/tab/pane) and the started agent. That buys
 * three things the plain task row cannot: idempotency (one live dispatch per
 * task, so two racing callers cannot spawn two agents), the tab → task join the
 * future close guard needs, and history.
 *
 * A row is **open** until `endedAt` is set. While it is open it holds the task's
 * lease: `leasedUntil` bounds how long an *unstarted* attempt may hold it (a
 * crash between lease and start), and once `startedAt` is set the lease no longer
 * expires on its own — the agent is live and only an explicit outcome ends it.
 * Ending a lease **never touches Herdr**: it is a ledger fact, not a teardown.
 */

import type { Harness } from "@/domain/tasks/task";

/** Terminal dispositions a dispatch row can end with. `null` means it is still live. */
export const DISPATCH_OUTCOMES = ["failed", "expired", "closed", "lost"] as const;
export type DispatchOutcome = (typeof DISPATCH_OUTCOMES)[number];

/** Statuses a task can be dispatched from. */
export const DISPATCHABLE_STATUSES = ["backlog", "ready"] as const;

export type Dispatch = {
  id: string;
  taskId: string;
  workspaceId: string | null;
  tabId: string | null;
  paneId: string | null;
  /** The unique Herdr agent name the dispatcher started (`<slug>-<short-id>`). */
  agentName: string | null;
  harness: Harness | null;
  leaseOwner: string;
  leaseUntil: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  outcome: DispatchOutcome | null;
  createdAt: Date;
};

/** True while the row holds the task's lease (see the module comment). */
export function isLeaseHeld(dispatch: Pick<Dispatch, "startedAt" | "leaseUntil">, now: Date): boolean {
  return dispatch.startedAt !== null || dispatch.leaseUntil.getTime() > now.getTime();
}

/** Raised when a dispatch lease is already held: the caller must not spawn a second agent. */
export class DispatchLeaseHeldError extends Error {
  constructor(taskId: string, held: Pick<Dispatch, "id" | "leaseOwner" | "startedAt" | "leaseUntil">) {
    const state = held.startedAt
      ? `its agent was started at ${held.startedAt.toISOString()}`
      : `it is leased until ${held.leaseUntil.toISOString()}`;
    super(`Task ${taskId} already has a live dispatch (${held.id}, owner ${held.leaseOwner}): ${state}.`);
    this.name = "DispatchLeaseHeldError";
  }
}

/** Raised when a task is dispatched from a status that forbids it. */
export class DispatchNotDispatchableError extends Error {
  constructor(status: string) {
    super(`A task in "${status}" cannot be dispatched (only ${DISPATCHABLE_STATUSES.join(" / ")}).`);
    this.name = "DispatchNotDispatchableError";
  }
}

/** Raised when a task has no project, so there is nowhere to place its agent. */
export class DispatchRequiresProjectError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} has no project, so dispatch has no workspace to place its agent in.`);
    this.name = "DispatchRequiresProjectError";
  }
}

/**
 * Raised when a spawn fails after the dispatcher has already touched topology.
 * The message names the tab/pane so the orphan is visible, not silent; the row
 * is recorded as a failed dispatch and the task is flagged for the operator.
 */
export class DispatchSpawnError extends Error {
  constructor(
    taskId: string,
    detail: string,
    readonly orphan: { tabId: string | null; paneId: string | null },
  ) {
    const where = orphan.tabId ? `; it left tab ${orphan.tabId}${orphan.paneId ? ` (pane ${orphan.paneId})` : ""}` : "";
    super(`Dispatch of task ${taskId} failed: ${detail}${where}`);
    this.name = "DispatchSpawnError";
  }
}
