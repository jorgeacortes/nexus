import { describe, expect, it } from "vitest";

import { ReadTopologyUseCase } from "@/application/dispatch/read-topology";
import type { HarnessPane, HarnessPort, HarnessTab, HarnessWorkspace } from "@/domain/dispatch/harness";

function workspace(workspaceId: string, label: string): HarnessWorkspace {
  return {
    workspaceId,
    label,
    focused: false,
    tabCount: 0,
    paneCount: 0,
    agentStatus: "unknown",
    activeTabId: null,
  };
}

function tab(tabId: string, workspaceId: string): HarnessTab {
  return { tabId, workspaceId, label: tabId, focused: false, paneCount: 0, agentStatus: "unknown" };
}

function pane(paneId: string, tabId: string, workspaceId: string): HarnessPane {
  return {
    paneId,
    tabId,
    workspaceId,
    agent: null,
    agentStatus: "unknown",
    cwd: null,
    focused: false,
    terminalTitle: "",
  };
}

/**
 * A fake `HarnessPort`: no socket, no spawn. The write methods throw so a read
 * use case that reached for them would fail loudly.
 */
function fakeHarness(parts: {
  workspaces?: HarnessWorkspace[];
  tabs?: Record<string, HarnessTab[]>;
  panes?: Record<string, HarnessPane[]>;
}): { port: HarnessPort; tabCalls: string[]; paneCalls: string[] } {
  const tabCalls: string[] = [];
  const paneCalls: string[] = [];
  const unused = () => {
    throw new Error("write method is not part of a read flow");
  };
  return {
    tabCalls,
    paneCalls,
    port: {
      listWorkspaces: async () => parts.workspaces ?? [],
      listTabs: async (workspaceId) => {
        tabCalls.push(workspaceId);
        return parts.tabs?.[workspaceId] ?? [];
      },
      listPanes: async (workspaceId) => {
        paneCalls.push(workspaceId);
        return parts.panes?.[workspaceId] ?? [];
      },
      processes: async () => [],
      createWorkspace: unused,
      createTab: unused,
      startAgent: unused,
      closeTab: unused,
    },
  };
}

describe("ReadTopologyUseCase", () => {
  it("groups panes under tabs under their workspace", async () => {
    const { port, tabCalls, paneCalls } = fakeHarness({
      workspaces: [workspace("wR", "nexus"), workspace("wK", "valua")],
      tabs: { wR: [tab("wR:t1", "wR"), tab("wR:t2", "wR")], wK: [tab("wK:t1", "wK")] },
      panes: {
        wR: [pane("wR:p1", "wR:t1", "wR"), pane("wR:p2", "wR:t1", "wR"), pane("wR:p3", "wR:t2", "wR")],
        wK: [],
      },
    });

    const topology = await new ReadTopologyUseCase(port).execute();

    expect(topology.map((entry) => entry.workspaceId)).toEqual(["wR", "wK"]);
    expect(topology[0].tabs.map((entry) => [entry.tabId, entry.panes.map((p) => p.paneId)])).toEqual([
      ["wR:t1", ["wR:p1", "wR:p2"]],
      ["wR:t2", ["wR:p3"]],
    ]);
    expect(topology[1].tabs[0].panes).toEqual([]);
    expect(tabCalls).toEqual(["wR", "wK"]);
    expect(paneCalls).toEqual(["wR", "wK"]);
  });

  it("reads only the workspaces the port reports", async () => {
    const { port, tabCalls, paneCalls } = fakeHarness({ workspaces: [] });

    expect(await new ReadTopologyUseCase(port).execute()).toEqual([]);
    expect(tabCalls).toEqual([]);
    expect(paneCalls).toEqual([]);
  });
});
