import type { HarnessPane, HarnessPort, HarnessTab, HarnessWorkspace } from "@/domain/dispatch/harness";

/** A tab with the panes Herdr reports under it. */
export interface HarnessTabView extends HarnessTab {
  panes: HarnessPane[];
}

/** A workspace with its tabs, each with its panes: the live topology as one tree. */
export interface HarnessWorkspaceView extends HarnessWorkspace {
  tabs: HarnessTabView[];
}

/**
 * Read-only view of the live Herdr topology the dispatch context places work on.
 * It depends only on `HarnessPort`, so it is unit-tested against a fake — no
 * socket, no process spawn — and the placement/close flows read through the same
 * port.
 */
export class ReadTopologyUseCase {
  constructor(private readonly harness: HarnessPort) {}

  async execute(): Promise<HarnessWorkspaceView[]> {
    const workspaces = await this.harness.listWorkspaces();
    return Promise.all(workspaces.map((workspace) => this.readWorkspace(workspace)));
  }

  private async readWorkspace(workspace: HarnessWorkspace): Promise<HarnessWorkspaceView> {
    const [tabs, panes] = await Promise.all([
      this.harness.listTabs(workspace.workspaceId),
      this.harness.listPanes(workspace.workspaceId),
    ]);
    const panesByTab = new Map<string, HarnessPane[]>();
    for (const pane of panes) {
      const list = panesByTab.get(pane.tabId) ?? [];
      list.push(pane);
      panesByTab.set(pane.tabId, list);
    }
    return { ...workspace, tabs: tabs.map((tab) => ({ ...tab, panes: panesByTab.get(tab.tabId) ?? [] })) };
  }
}
