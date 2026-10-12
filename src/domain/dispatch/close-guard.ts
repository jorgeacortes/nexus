/**
 * The close guard: the pure rule that decides whether a Herdr tab may be closed
 * (DESIGN-dispatch.md). It lives in the domain so it is unit-tested without
 * a socket, and the application layer only resolves the facts (the tab's panes,
 * the task each pane owns, the foreground processes of an agent-less pane) and
 * then obeys the verdict.
 *
 * Herdr cannot be made to refuse a raw `tab.close` (the method takes only
 * `tab_id`; there is no pre-close hook), so this guard protects every close path
 * *we* control and `nx dispatch close` is the sanctioned one. The incident it
 * exists for: a `/tmp` script closed a tab whose agent was still `working`, with
 * ~2400 lines of uncommitted work.
 *
 * A tab is protected when **any** pane in it matches:
 *
 * | pane state | close |
 * | --- | --- |
 * | agent `working` / `blocked` / `unknown` | refuse |
 * | agent `idle` **and** the pane owns a task that is not `done` | refuse |
 * | agent `idle`, owns no task, or its task is `done` | allow |
 * | agent `done` | allow |
 * | no recognized agent but a foreground process | refuse |
 * | bare prompt, no agent, no foreground process | allow |
 * | an open, lease-held ledger row on the tab whose task is not `done` | refuse |
 *
 * The last row is the ledger's other direction (DSP-10): a dispatch that reached
 * placement but never wrote `tasks.herdr_pane_id` leaves the pane-level join
 * blind, while its open row still names the tab. A row whose *unstarted* lease
 * has lapsed is not held and does not block — the bare shell such a crash left
 * has nothing to lose, and `acquireLease` would supersede that row anyway.
 *
 * A status Herdr reports outside its enum is treated as `unknown` (refuse): the
 * failure mode of this guard must be "leave the tab open", never "kill work".
 */

import type { HarnessPane, HarnessProcess } from "@/domain/dispatch/harness";

/** The slice of a task the guard needs to judge an idle pane. */
export type CloseGuardTask = {
  id: string;
  title: string;
  status: string;
};

/**
 * One open ledger row placed on the tab (DESIGN-dispatch.md), the guard's
 * second join. It is only resolved from the ledger when the row still holds its
 * lease (`isLeaseHeld`), so a row that reached placement and then died unstarted
 * is not treated as live work.
 */
export type CloseGuardDispatch = {
  id: string;
  taskId: string;
  /** The pane the row placed the agent in; null if placement recorded none. */
  paneId: string | null;
  /** The row's task, resolved for its status; null when it cannot be read. */
  task: CloseGuardTask | null;
};

/** Everything the guard knows about one pane in the tab. */
export type ClosePaneFacts = {
  pane: HarnessPane;
  /** The task the pane is assigned to (`tasks.herdr_pane_id`), or null. */
  task: CloseGuardTask | null;
  /** Foreground processes besides the pane's own shell; empty for a bare prompt. */
  processes: readonly HarnessProcess[];
};

/** Why one pane forbids the close; the fields the refusal message names. */
export type CloseBlock = {
  /**
   * The pane that forbids the close, or null for a tab-level block (an open
   * ledger row, which names the tab rather than a live pane).
   */
  paneId: string | null;
  /** The live agent kind, or null for a pane with no recognized agent. */
  agent: string | null;
  /** The pane's agent status, or "unknown" when it is not a Herdr agent. */
  status: string;
  reason: string;
};

export type TabCloseAssessment = {
  closeable: boolean;
  /** Every pane that forbids the close; empty when `closeable` is true. */
  blocks: CloseBlock[];
};

const KNOWN_STATUSES = new Set(["idle", "working", "blocked", "done"]);

/** Herdr's agent status, with anything unexpected collapsing to `unknown`. */
function effectiveStatus(raw: string): string {
  return KNOWN_STATUSES.has(raw) ? raw : "unknown";
}

/** Whether the pane runs an agent Nexus recognizes (a non-empty agent kind). */
export function hasLiveAgent(pane: Pick<HarnessPane, "agent">): boolean {
  return pane.agent !== null && pane.agent.trim() !== "";
}

function blockFor(facts: ClosePaneFacts): CloseBlock | null {
  const { pane, task, processes } = facts;

  if (hasLiveAgent(pane)) {
    const agent = (pane.agent as string).trim();
    const status = effectiveStatus(pane.agentStatus);
    if (status === "done") {
      return null;
    }
    if (status === "idle") {
      if (task === null || task.status === "done") {
        return null;
      }
      return {
        paneId: pane.paneId,
        agent,
        status,
        reason: `agent "${agent}" is idle but owns task ${task.id} "${task.title}" (${task.status})`,
      };
    }
    return {
      paneId: pane.paneId,
      agent,
      status,
      reason: `agent "${agent}" is ${status}`,
    };
  }

  const foreground = processes[0];
  if (foreground) {
    const what = foreground.cmdline?.trim() || foreground.name || `pid ${foreground.pid}`;
    return {
      paneId: pane.paneId,
      agent: null,
      status: effectiveStatus(pane.agentStatus),
      reason: `no recognized agent, but a foreground process is running (${what}, pid ${foreground.pid})`,
    };
  }

  return null;
}

/**
 * An open ledger row protects the tab while the task it names is not `done`.
 * This is deliberately independent of the pane's own state: the row is the
 * ledger's proof that a dispatch owns the tab, so it blocks even a pane whose
 * agent is `done` or whose pane-level task is invisible.
 */
function blockForDispatch(dispatch: CloseGuardDispatch): CloseBlock | null {
  if (dispatch.task?.status === "done") {
    return null;
  }
  const target = dispatch.task
    ? `task ${dispatch.task.id} "${dispatch.task.title}" (${dispatch.task.status})`
    : `task ${dispatch.taskId}, whose row could not be read`;
  return {
    paneId: dispatch.paneId,
    agent: null,
    status: "unknown",
    reason: `open dispatch ${dispatch.id} placed on this tab owns ${target}, which is not done`,
  };
}

/** Evaluates one tab: closeable only when no pane and no open ledger row protects it. */
export function assessTabClose(
  facts: readonly ClosePaneFacts[],
  openDispatches: readonly CloseGuardDispatch[] = [],
): TabCloseAssessment {
  const blocks = [
    ...facts.map((entry) => blockFor(entry)),
    ...openDispatches.map((row) => blockForDispatch(row)),
  ].filter((block): block is CloseBlock => block !== null);
  return { closeable: blocks.length === 0, blocks };
}

/**
 * Raised when the guard refuses a close. The message names the tab and, for each
 * protected pane, the pane id, its agent and its status — so the refusal is
 * attributable, not a bare non-zero exit. **No action was taken**: the tab is
 * still open.
 */
export class TabCloseRefusedError extends Error {
  constructor(
    readonly tab: { tabId: string; label: string },
    readonly blocks: readonly CloseBlock[],
  ) {
    const label = tab.label ? ` "${tab.label}"` : "";
    const details = blocks
      .map((block) => (block.paneId ? `  • pane ${block.paneId}: ${block.reason}` : `  • tab: ${block.reason}`))
      .join("\n");
    super(
      `Refusing to close tab ${tab.tabId}${label}: ${blocks.length} blocker(s) still hold live work.\n${details}\n` +
        "No action was taken; the tab is still open. Close it from Herdr only if you are certain.",
    );
    this.name = "TabCloseRefusedError";
  }
}
