import type { DispatchRepository } from "@/domain/dispatch/dispatch.repository";
import type { HarnessPane, HarnessPort } from "@/domain/dispatch/harness";
import { assessVanishedAgent, isTrackedAgentDispatch, type LostAgentTask } from "@/domain/dispatch/lost-agents";
import type { Harness } from "@/domain/tasks/task";

/**
 * The narrow read/write the sweep needs from the tasks context. A port, not the
 * whole `TaskRepository`, so the use case is unit-tested against a fake and never
 * touches SQLite itself (the same shape as the close guard's `PaneTaskPort`).
 */
export interface LostAgentTaskPort {
  findById(id: string): Promise<LostAgentTask | null>;
  /** Flags the task for the operator; routed through the normal task update. */
  flagNeedsHuman(id: string, reason: string): Promise<void>;
}

/** One vanished agent: the ledger row that was ended and the task that was flagged. */
export type LostAgentFinding = {
  dispatchId: string;
  taskId: string;
  taskTitle: string | null;
  tabId: string | null;
  paneId: string;
  agentName: string | null;
  harness: Harness | null;
  lastSeenStatus: string | null;
  lastSeenAt: string | null;
  reason: string;
};

export type DetectLostAgentsResult = {
  /**
   * False when the live snapshot could not be read. **Nothing is flagged** then:
   * "Herdr is unreachable" must never read as "every agent vanished" (the same
   * rule the Servers collector follows).
   */
  available: boolean;
  /** Why the snapshot was unreadable; null when `available`. */
  reason: string | null;
  /** Open, started dispatches examined this sweep. */
  checked: number;
  /** Panes still live whose last-seen status was refreshed. */
  live: number;
  /** Vanished panes whose task is already `done`: ended as `closed`, not flagged. */
  completed: number;
  lost: LostAgentFinding[];
};

export type DetectLostAgentsDeps = {
  dispatches: DispatchRepository;
  tasks: LostAgentTaskPort;
  harness: HarnessPort;
  /** The caller's clock, passed in so tests are deterministic. */
  now?: () => Date;
};

type PaneSnapshot = { available: true; panes: Map<string, HarnessPane> } | { available: false; reason: string };

/**
 * The one-shot lost-agent sweep of DESIGN-dispatch.md, run by
 * `nx dispatch detect` / `POST /api/dispatch/detect`. **No timer lives here**:
 * it runs exactly once per call.
 *
 * Candidates are the ledger's open, started rows (DSP-4): an agent Nexus itself
 * placed and has not seen end. A row whose pane is still in the live snapshot is
 * left open and its status recorded; a row whose pane is gone is judged by
 * `assessVanishedAgent` (a `done` task is never a loss), ended as `lost`, and —
 * when the task still exists — flagged `needsHuman` with the reason.
 *
 * Each sweep is also the observation point: it refreshes `last_seen_status` for
 * live panes, which is what lets a later sweep name the last status in the
 * reason. That is a Nexus ledger write, never a Herdr call. Herdr is read only:
 * nothing here closes, spawns or prompts anything.
 */
export class DetectLostAgentsUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: DetectLostAgentsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(): Promise<DetectLostAgentsResult> {
    const now = this.now();
    const tracked = (await this.deps.dispatches.listOpen()).filter(isTrackedAgentDispatch);
    const snapshot = await this.readPanes();
    if (!snapshot.available) {
      return {
        available: false,
        reason: snapshot.reason,
        checked: tracked.length,
        live: 0,
        completed: 0,
        lost: [],
      };
    }

    const lost: LostAgentFinding[] = [];
    let live = 0;
    let completed = 0;
    for (const dispatch of tracked) {
      const pane = snapshot.panes.get(dispatch.paneId) ?? null;
      if (pane) {
        live += 1;
        await this.deps.dispatches.recordSeen(dispatch.id, { status: pane.agentStatus, seenAt: now });
        continue;
      }
      const task = await this.deps.tasks.findById(dispatch.taskId);
      const verdict = assessVanishedAgent({ dispatch, task, lastSeenStatus: dispatch.lastSeenStatus });
      if (!verdict.lost) {
        completed += 1;
        // The task is done and the pane is gone: the work is over, so the row
        // ends as `closed` rather than holding the lease forever (DSP-8).
        await this.deps.dispatches.finish(dispatch.id, "closed", now);
        continue;
      }
      // Flag first, then end the row: a crash between the two leaves the row
      // open, so the next sweep re-judges it and re-flags (idempotently).
      // Ending first would strand the task unflagged forever.
      if (task) {
        await this.deps.tasks.flagNeedsHuman(task.id, verdict.reason);
      }
      await this.deps.dispatches.finish(dispatch.id, "lost", now);
      lost.push({
        dispatchId: dispatch.id,
        taskId: dispatch.taskId,
        taskTitle: task?.title ?? null,
        tabId: dispatch.tabId,
        paneId: dispatch.paneId,
        agentName: dispatch.agentName,
        harness: dispatch.harness,
        lastSeenStatus: dispatch.lastSeenStatus,
        lastSeenAt: dispatch.lastSeenAt ? dispatch.lastSeenAt.toISOString() : null,
        reason: verdict.reason,
      });
    }

    return { available: true, reason: null, checked: tracked.length, live, completed, lost };
  }

  /**
   * Every pane in the live Herdr topology, keyed by pane id. The dispatch context
   * only has per-workspace reads, so this composes `listWorkspaces` +
   * `listPanes` — the same live state the 5 s snapshot reads, through the same
   * port. A read failure is reported, never treated as an empty host.
   */
  private async readPanes(): Promise<PaneSnapshot> {
    try {
      const workspaces = await this.deps.harness.listWorkspaces();
      const paneLists = await Promise.all(
        workspaces.map((workspace) => this.deps.harness.listPanes(workspace.workspaceId)),
      );
      return { available: true, panes: new Map(paneLists.flat().map((pane) => [pane.paneId, pane])) };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : "the live Herdr snapshot is unavailable",
      };
    }
  }
}
