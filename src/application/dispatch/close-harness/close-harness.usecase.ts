import { TabNotFoundError } from "@/application/dispatch/errors";
import {
  assessTabClose,
  type CloseGuardTask,
  type ClosePaneFacts,
  hasLiveAgent,
  TabCloseRefusedError,
} from "@/domain/dispatch/close-guard";
import type { HarnessPane, HarnessPort, HarnessTab } from "@/domain/dispatch/harness";

/**
 * The read the guard needs from the tasks context: the task a pane is assigned
 * to (`tasks.herdr_pane_id`). A narrow port, so the use case is unit-tested
 * against a fake and never touches SQLite itself.
 */
export interface PaneTaskPort {
  findByHerdrPaneId(paneId: string): Promise<CloseGuardTask | null>;
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
 * when the pane has no recognized agent — the pane's foreground processes, then
 * asks `assessTabClose`. A refusal throws `TabCloseRefusedError` **before**
 * `closeTab`, so no protected tab is ever touched; the adapter's `closeTab`
 * stays dumb and this is the only place the decision is made.
 */
export class CloseHarnessUseCase {
  constructor(
    private readonly harness: HarnessPort,
    private readonly tasks: PaneTaskPort,
  ) {}

  async execute(tabId: string): Promise<CloseHarnessResult> {
    const tab = await this.harness.getTab(tabId);
    if (!tab) {
      throw new TabNotFoundError(tabId);
    }
    const panes = (await this.harness.listPanes(tab.workspaceId)).filter((pane) => pane.tabId === tabId);
    const facts = await Promise.all(panes.map((pane) => this.factsFor(pane)));
    const assessment = assessTabClose(facts);
    if (!assessment.closeable) {
      throw new TabCloseRefusedError(tab, assessment.blocks);
    }
    await this.harness.closeTab(tabId);
    return { tab, paneCount: panes.length };
  }

  private async factsFor(pane: HarnessPane): Promise<ClosePaneFacts> {
    const task = await this.tasks.findByHerdrPaneId(pane.paneId);
    const processes = hasLiveAgent(pane) ? [] : await this.harness.processes(pane.paneId);
    return { pane, task, processes };
  }
}
