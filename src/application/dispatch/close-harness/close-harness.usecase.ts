import { TabNotFoundError } from "@/application/dispatch/errors";
import {
  assessTabClose,
  type CloseGuardDispatch,
  type CloseGuardTask,
  type ClosePaneFacts,
  hasLiveAgent,
  TabCloseRefusedError,
} from "@/domain/dispatch/close-guard";
import { isLeaseHeld } from "@/domain/dispatch/dispatch";
import type { HarnessPane, HarnessPort, HarnessTab } from "@/domain/dispatch/harness";

/**
 * The read the guard needs from the tasks context. A narrow port, so the use case
 * is unit-tested against a fake and never touches SQLite itself. It answers both
 * joins: the task a pane is assigned to (`tasks.herdr_pane_id`) and the task an
 * open ledger row names (DSP-10).
 */
export interface PaneTaskPort {
  findByHerdrPaneId(paneId: string): Promise<CloseGuardTask | null>;
  /** The task a dispatch row names, so the guard can judge its status. */
  findById(taskId: string): Promise<CloseGuardTask | null>;
}

/** One open row placed on the tab, as the ledger reports it. */
export type TabDispatchRow = {
  id: string;
  taskId: string;
  paneId: string | null;
  startedAt: Date | null;
  leaseUntil: Date;
};

/**
 * The dispatch-ledger port of the guarded close. It reads the tab's open rows
 * (DSP-10) and, once the close is allowed, ends them as `closed` and releases
 * their leases (DSP-8). A narrow port — the same shape as `PaneTaskPort` — so the
 * use case is unit-tested against a fake.
 */
export interface ClosedTabDispatchPort {
  /**
   * Every open row placed on the tab. The use case only treats the lease-held
   * ones as live work (`isLeaseHeld`): a row that reached placement and died
   * unstarted stops blocking once its five-minute lease lapses.
   */
  listOpenForTab(tabId: string): Promise<TabDispatchRow[]>;
  /** Ends every open row for the tab as `closed`. No-op when the ledger has none. */
  endOpenForTab(tabId: string): Promise<void>;
}

export type CloseHarnessResult = {
  tab: HarnessTab;
  /** How many panes the guard evaluated before allowing the close. */
  paneCount: number;
};

/**
 * The guarded teardown of DESIGN-dispatch.md §3.2, run by `nx dispatch close`
 * and `POST /api/dispatch/close`.
 *
 * It resolves the tab's panes and, for each, the task the pane owns and — only
 * when the pane has no recognized agent — the pane's foreground processes. It
 * also resolves the ledger's open rows for the tab (DSP-10), the join that still
 * works when a dispatch crashed before writing `tasks.herdr_pane_id`, then asks
 * `assessTabClose`. A refusal throws `TabCloseRefusedError` **before**
 * `closeTab`, so no protected tab is ever touched; the adapter's `closeTab`
 * stays dumb and this is the only place the decision is made.
 */
export class CloseHarnessUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly harness: HarnessPort,
    private readonly tasks: PaneTaskPort,
    private readonly dispatches: ClosedTabDispatchPort,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  async execute(tabId: string): Promise<CloseHarnessResult> {
    const tab = await this.harness.getTab(tabId);
    if (!tab) {
      throw new TabNotFoundError(tabId);
    }
    const panes = (await this.harness.listPanes(tab.workspaceId)).filter((pane) => pane.tabId === tabId);
    const [facts, openDispatches] = await Promise.all([
      Promise.all(panes.map((pane) => this.factsFor(pane))),
      this.liveDispatchesFor(tabId),
    ]);
    const assessment = assessTabClose(facts, openDispatches);
    if (!assessment.closeable) {
      throw new TabCloseRefusedError(tab, assessment.blocks);
    }
    await this.harness.closeTab(tabId);
    // The tab is gone and the guard proved no pane held live work, so every
    // dispatch placed on it is finished: end its row as `closed` (DSP-8).
    await this.dispatches.endOpenForTab(tabId);
    return { tab, paneCount: panes.length };
  }

  private async factsFor(pane: HarnessPane): Promise<ClosePaneFacts> {
    const task = await this.tasks.findByHerdrPaneId(pane.paneId);
    const processes = hasLiveAgent(pane) ? [] : await this.harness.processes(pane.paneId);
    return { pane, task, processes };
  }

  /**
   * The ledger's tab → task join, resolved to each row's task status. Only rows
   * that still hold their lease count (`isLeaseHeld`): an unstarted attempt whose
   * lease lapsed is the same dead row `acquireLease` would supersede, so it must
   * not keep a bare shell hostage forever.
   */
  private async liveDispatchesFor(tabId: string): Promise<CloseGuardDispatch[]> {
    const rows = await this.dispatches.listOpenForTab(tabId);
    const now = this.now();
    return Promise.all(
      rows
        .filter((row) => isLeaseHeld(row, now))
        .map(async (row) => ({
          id: row.id,
          taskId: row.taskId,
          paneId: row.paneId,
          task: await this.tasks.findById(row.taskId),
        })),
    );
  }
}
