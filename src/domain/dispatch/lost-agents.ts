/**
 * Lost-agent detection: the control for the one close path Nexus does not own.
 *
 * Herdr cannot be made to refuse a raw `herdr tab close` (DESIGN-dispatch.md §1,
 * §3.3), so a pane can vanish out from under an agent that was `working`. Nexus
 * already polls the live snapshot every 5 s, so the remaining control is
 * detection: the dispatcher's ledger says which agents it started, and an open
 * row whose pane is no longer in the snapshot is an agent that vanished without
 * an outcome.
 *
 * This module is the pure rule. The application layer resolves the facts (the
 * ledger's open rows, the live panes, the task each row names) and obeys the
 * verdict. Detection is read-only with respect to Herdr: it never closes, spawns
 * or prompts anything — it only ends the ledger row and flags the task.
 *
 * Two guards against false alarms:
 * - Only rows **this dispatcher started** are candidates (`startedAt` set and
 *   `endedAt` null). A pane nobody dispatched is not a lost agent, however it
 *   disappeared.
 * - A task already `done` is not a loss: its tab may have been closed by the
 *   guarded path (DSP-5), and a finished task needs no operator.
 */

import type { Dispatch } from "@/domain/dispatch/dispatch";

/** The slice of a task detection reads and flags. */
export type LostAgentTask = {
  id: string;
  title: string;
  status: string;
};

/** A dispatch detection watches: started, not ended, and placed on a pane. */
export function isTrackedAgentDispatch(dispatch: Dispatch): dispatch is Dispatch & { paneId: string } {
  return dispatch.endedAt === null && dispatch.startedAt !== null && dispatch.paneId !== null;
}

export type VanishedAgentAssessment = { lost: false; why: "task_done" } | { lost: true; reason: string };

/** `agent "name" (harness)`, degrading honestly when the ledger never named one. */
function describeAgent(dispatch: Dispatch): string {
  const agent = dispatch.agentName?.trim() || "an unnamed agent";
  return dispatch.harness ? `agent "${agent}" (${dispatch.harness})` : `agent "${agent}"`;
}

/**
 * The reason recorded on the task, naming every fact the operator needs to find
 * the work: the agent, the pane and tab it ran in, the last status seen for it,
 * and the task's own status. "unknown" is stated, never implied.
 */
export function lostAgentReason(input: {
  dispatch: Dispatch;
  task: LostAgentTask | null;
  lastSeenStatus: string | null;
}): string {
  const { dispatch, task, lastSeenStatus } = input;
  const where = dispatch.tabId ? `pane ${dispatch.paneId} of tab ${dispatch.tabId}` : `pane ${dispatch.paneId}`;
  const taskPart = task ? `task ${task.id} "${task.title}" is ${task.status}` : "its task is missing";
  const seen = lastSeenStatus?.trim()
    ? `it was last seen ${lastSeenStatus.trim()}`
    : "its last status was never recorded";
  return `${describeAgent(dispatch)} vanished from the Herdr snapshot: ${where} is gone, ${seen}, and ${taskPart}.`;
}

/**
 * Judges one open dispatch whose pane is no longer in the snapshot. A `done`
 * task is never a lost agent (the guarded close may have ended it cleanly);
 * anything else is, and gets the reason above.
 */
export function assessVanishedAgent(input: {
  dispatch: Dispatch;
  task: LostAgentTask | null;
  lastSeenStatus: string | null;
}): VanishedAgentAssessment {
  if (input.task !== null && input.task.status === "done") {
    return { lost: false, why: "task_done" };
  }
  return { lost: true, reason: lostAgentReason(input) };
}
