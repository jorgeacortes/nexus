import { describe, expect, it } from "vitest";

import {
  type ClosedTabDispatchPort,
  CloseHarnessUseCase,
  type PaneTaskPort,
  type TabDispatchRow,
} from "@/application/dispatch/close-harness";
import { TabNotFoundError } from "@/application/dispatch/errors";
import type { CloseGuardTask } from "@/domain/dispatch/close-guard";
import { TabCloseRefusedError } from "@/domain/dispatch/close-guard";
import type { HarnessPane, HarnessPort, HarnessProcess, HarnessTab } from "@/domain/dispatch/harness";

const WORKSPACE = "wR";
const TAB = "wR:tA";
const NOW = new Date("2026-10-05T18:00:00.000Z");
const FUTURE = new Date("2026-10-05T18:05:00.000Z");

function tab(tabId = TAB, workspaceId = WORKSPACE, agentStatus = "unknown"): HarnessTab {
  return { tabId, workspaceId, label: "dsp-5-close-guard", focused: false, paneCount: 1, agentStatus };
}

function pane(overrides: Partial<HarnessPane> = {}): HarnessPane {
  return {
    paneId: "wR:pE",
    tabId: TAB,
    workspaceId: WORKSPACE,
    agent: null,
    agentStatus: "unknown",
    cwd: "/tmp/dsp-smoke",
    focused: false,
    terminalTitle: "",
    ...overrides,
  };
}

/** A fake `HarnessPort` + `PaneTaskPort` + dispatch ledger: records closings and every read. */
function fakeHarness(options: {
  tab?: HarnessTab | null;
  panes?: HarnessPane[];
  processes?: Record<string, HarnessProcess[]>;
  tasks?: Record<string, CloseGuardTask>;
  tasksById?: Record<string, CloseGuardTask>;
  openRows?: TabDispatchRow[];
}): {
  harness: HarnessPort;
  tasks: PaneTaskPort;
  dispatches: ClosedTabDispatchPort;
  closedTabs: string[];
  endedDispatchTabs: string[];
  processCalls: string[];
  taskCalls: string[];
  listOpenCalls: string[];
} {
  const closedTabs: string[] = [];
  const endedDispatchTabs: string[] = [];
  const processCalls: string[] = [];
  const taskCalls: string[] = [];
  const listOpenCalls: string[] = [];
  const unused = () => {
    throw new Error("write method is not part of the close flow");
  };
  const harness: HarnessPort = {
    listWorkspaces: async () => [],
    listTabs: async () => [],
    listPanes: async () => options.panes ?? [],
    getTab: async () => (options.tab === undefined ? tab() : options.tab),
    processes: async (paneId) => {
      processCalls.push(paneId);
      return options.processes?.[paneId] ?? [];
    },
    createWorkspace: unused,
    createTab: unused,
    renameTab: unused,
    startAgent: unused,
    closeTab: async (tabId) => {
      closedTabs.push(tabId);
    },
  };
  const tasks: PaneTaskPort = {
    findByHerdrPaneId: async (paneId) => {
      taskCalls.push(paneId);
      return options.tasks?.[paneId] ?? null;
    },
    findById: async (taskId) => options.tasksById?.[taskId] ?? null,
  };
  const dispatches: ClosedTabDispatchPort = {
    listOpenForTab: async (tabId) => {
      listOpenCalls.push(tabId);
      return options.openRows ?? [];
    },
    endOpenForTab: async (tabId) => {
      endedDispatchTabs.push(tabId);
    },
  };
  return { harness, tasks, dispatches, closedTabs, endedDispatchTabs, processCalls, taskCalls, listOpenCalls };
}

describe("CloseHarnessUseCase", () => {
  it("closes a tab whose agent is done and whose task is still open", async () => {
    const options = {
      tab: tab(TAB, WORKSPACE, "done"),
      panes: [pane({ agent: "pi", agentStatus: "done" })],
      tasks: { "wR:pE": { id: "t1", title: "done work", status: "in_progress" } },
    };
    const fake = fakeHarness(options);

    const result = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB);

    expect(fake.closedTabs).toEqual([TAB]);
    expect(result.paneCount).toBe(1);
    expect(result.tab.tabId).toBe(TAB);
    // The closed tab's open dispatch rows end as `closed` (DSP-8).
    expect(fake.endedDispatchTabs).toEqual([TAB]);
  });

  it("refuses a working agent and never calls closeTab", async () => {
    const options = { tab: tab(TAB, WORKSPACE, "working"), panes: [pane({ agent: "pi", agentStatus: "working" })] };
    const fake = fakeHarness(options);

    await expect(
      new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB),
    ).rejects.toBeInstanceOf(TabCloseRefusedError);
    expect(fake.closedTabs).toEqual([]);
    expect(fake.endedDispatchTabs).toEqual([]);
    expect(fake.taskCalls).toEqual(["wR:pE"]);
  });

  it("refuses an idle agent whose task is not done", async () => {
    const options = {
      tab: tab(TAB, WORKSPACE, "idle"),
      panes: [pane({ agent: "pi", agentStatus: "idle" })],
      tasks: { "wR:pE": { id: "5f7325b7", title: "Guard tab closes", status: "in_progress" } },
    };
    const fake = fakeHarness(options);

    const error = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches)
      .execute(TAB)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TabCloseRefusedError);
    expect((error as Error).message).toContain("in_progress");
    expect(fake.closedTabs).toEqual([]);
    expect(fake.endedDispatchTabs).toEqual([]);
  });

  it("closes an idle agent that owns no task", async () => {
    const options = { tab: tab(TAB, WORKSPACE, "idle"), panes: [pane({ agent: "pi", agentStatus: "idle" })] };
    const fake = fakeHarness(options);

    await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB);

    expect(fake.closedTabs).toEqual([TAB]);
    // The foreground-process read is only for panes with no recognized agent.
    expect(fake.processCalls).toEqual([]);
  });

  it("refuses a bare pane running a foreground process, and reads processes only for it", async () => {
    const options = {
      panes: [pane({ paneId: "wR:pE", agent: null }), pane({ paneId: "wR:pF", agent: "pi", agentStatus: "done" })],
      processes: { "wR:pE": [{ pid: 42, name: "npm", cmdline: "npm test", cwd: null }] },
    };
    const fake = fakeHarness(options);

    await expect(
      new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB),
    ).rejects.toBeInstanceOf(TabCloseRefusedError);
    expect(fake.processCalls).toEqual(["wR:pE"]);
    expect(fake.closedTabs).toEqual([]);
    expect(fake.endedDispatchTabs).toEqual([]);
  });

  it("closes a tab of bare prompt panes", async () => {
    const options = { panes: [pane({ paneId: "wR:pE", agent: null })] };
    const fake = fakeHarness(options);

    await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB);

    expect(fake.closedTabs).toEqual([TAB]);
    expect(fake.processCalls).toEqual(["wR:pE"]);
  });

  it("refuses an unknown tab and never calls closeTab", async () => {
    const fake = fakeHarness({ tab: null, panes: [] });

    await expect(
      new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute("wR:zz"),
    ).rejects.toBeInstanceOf(TabNotFoundError);
    expect(fake.closedTabs).toEqual([]);
    expect(fake.endedDispatchTabs).toEqual([]);
  });

  it("ignores panes that belong to another tab of the same workspace", async () => {
    const options = {
      tab: tab(TAB, WORKSPACE, "done"),
      panes: [
        pane({ paneId: "wR:pE", agent: "pi", agentStatus: "done" }),
        pane({ paneId: "wR:pX", tabId: "wR:t9", agent: "pi", agentStatus: "working" }),
      ],
    };
    const fake = fakeHarness(options);

    const result = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches).execute(TAB);

    expect(result.paneCount).toBe(1);
    expect(fake.closedTabs).toEqual([TAB]);
  });

  it("refuses a tab whose orphan dispatch row names a task that is not done", async () => {
    const options = {
      tab: tab(TAB, WORKSPACE, "idle"),
      panes: [pane({ agent: "pi", agentStatus: "idle" })],
      openRows: [{ id: "d-orphan", taskId: "5f7325b7", paneId: "wR:pE", startedAt: NOW, leaseUntil: FUTURE }],
      tasksById: { "5f7325b7": { id: "5f7325b7", title: "Orphaned dispatch", status: "in_progress" } },
    };
    const fake = fakeHarness(options);

    const error = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => NOW)
      .execute(TAB)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TabCloseRefusedError);
    expect((error as Error).message).toContain("d-orphan");
    expect((error as Error).message).toContain("in_progress");
    expect(fake.closedTabs).toEqual([]);
    expect(fake.endedDispatchTabs).toEqual([]);
    expect(fake.listOpenCalls).toEqual([TAB]);
  });

  it("refuses a live orphan row on an agent-less pane with no foreground process", async () => {
    const options = {
      panes: [pane({ agent: null })],
      openRows: [{ id: "d-shell", taskId: "t9", paneId: "wR:pE", startedAt: NOW, leaseUntil: FUTURE }],
      tasksById: { t9: { id: "t9", title: "Crashed dispatch", status: "ready" } },
    };
    const fake = fakeHarness(options);

    const error = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => NOW)
      .execute(TAB)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TabCloseRefusedError);
    expect((error as Error).message).toContain("d-shell");
    expect(fake.closedTabs).toEqual([]);
  });

  it("closes a tab whose only open dispatch row has a done task (DSP-8)", async () => {
    const options = {
      panes: [pane({ agent: null })],
      openRows: [{ id: "d-done", taskId: "t-done", paneId: "wR:pE", startedAt: NOW, leaseUntil: FUTURE }],
      tasksById: { "t-done": { id: "t-done", title: "Finished", status: "done" } },
    };
    const fake = fakeHarness(options);

    await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => NOW).execute(TAB);

    expect(fake.closedTabs).toEqual([TAB]);
    expect(fake.endedDispatchTabs).toEqual([TAB]);
  });

  it("refuses when the open row's task cannot be read", async () => {
    const options = {
      panes: [pane({ agent: null })],
      openRows: [{ id: "d-missing", taskId: "gone", paneId: "wR:pE", startedAt: NOW, leaseUntil: FUTURE }],
    };
    const fake = fakeHarness(options);

    const error = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => NOW)
      .execute(TAB)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TabCloseRefusedError);
    expect((error as Error).message).toContain("d-missing");
    expect((error as Error).message).toContain("could not be read");
    expect(fake.closedTabs).toEqual([]);
  });

  it("blocks while an unstarted row still holds its lease", async () => {
    const options = {
      panes: [pane({ agent: null })],
      openRows: [{ id: "d-lease", taskId: "t9", paneId: "wR:pE", startedAt: null, leaseUntil: FUTURE }],
      tasksById: { t9: { id: "t9", title: "In flight", status: "ready" } },
    };
    const fake = fakeHarness(options);

    const error = await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => NOW)
      .execute(TAB)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TabCloseRefusedError);
    expect((error as Error).message).toContain("d-lease");
  });

  it("does not let a lapsed unstarted row block a bare shell", async () => {
    const later = new Date("2026-10-05T18:30:00.000Z");
    const options = {
      panes: [pane({ agent: null })],
      openRows: [{ id: "d-stale", taskId: "t9", paneId: "wR:pE", startedAt: null, leaseUntil: FUTURE }],
      tasksById: { t9: { id: "t9", title: "Crashed dispatch", status: "ready" } },
    };
    const fake = fakeHarness(options);

    await new CloseHarnessUseCase(fake.harness, fake.tasks, fake.dispatches, () => later).execute(TAB);

    expect(fake.closedTabs).toEqual([TAB]);
    expect(fake.endedDispatchTabs).toEqual([TAB]);
  });
});
