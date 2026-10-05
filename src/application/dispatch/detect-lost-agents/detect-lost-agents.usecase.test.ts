import { describe, expect, it } from "vitest";

import {
  DetectLostAgentsUseCase,
  type LostAgentFinding,
  type LostAgentTaskPort,
} from "@/application/dispatch/detect-lost-agents";
import type { Dispatch } from "@/domain/dispatch/dispatch";
import type { DispatchRepository } from "@/domain/dispatch/dispatch.repository";
import type { HarnessPane, HarnessPort } from "@/domain/dispatch/harness";
import type { LostAgentTask } from "@/domain/dispatch/lost-agents";

const NOW = new Date("2026-10-05T18:00:00.000Z");

function dispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: "d1",
    taskId: "t1",
    workspaceId: "wR",
    tabId: "wR:t3",
    paneId: "wR:pH",
    agentName: "dsp-6-46e044bf",
    harness: "pi",
    leaseOwner: "host:1",
    leaseUntil: NOW,
    startedAt: NOW,
    endedAt: null,
    outcome: null,
    lastSeenStatus: "working",
    lastSeenAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function pane(paneId: string): HarnessPane {
  return {
    paneId,
    tabId: "wR:t3",
    workspaceId: "wR",
    agent: "pi",
    agentStatus: "working",
    cwd: "/tmp/dsp-smoke",
    focused: false,
    terminalTitle: "",
  };
}

/** A fake `HarnessPort`: only the two reads the sweep may make; writes throw. */
function fakeHarness(options: { workspaces?: string[]; panes?: HarnessPane[]; fail?: Error }): {
  port: HarnessPort;
  listPanesCalls: string[];
} {
  const listPanesCalls: string[] = [];
  const unused = () => {
    throw new Error("detection must never write to Herdr (close/spawn/prompt)");
  };
  return {
    listPanesCalls,
    port: {
      listWorkspaces: async () => {
        if (options.fail) throw options.fail;
        return (options.workspaces ?? ["wR"]).map((workspaceId) => ({
          workspaceId,
          label: "dsp-smoke",
          focused: false,
          tabCount: 1,
          paneCount: 1,
          agentStatus: "unknown",
          activeTabId: null,
        }));
      },
      listTabs: async () => [],
      listPanes: async (workspaceId) => {
        listPanesCalls.push(workspaceId);
        return options.panes ?? [];
      },
      getTab: async () => null,
      processes: async () => [],
      createWorkspace: unused,
      createTab: unused,
      renameTab: unused,
      startAgent: unused,
      closeTab: unused,
    },
  };
}

/** A fake ledger: `listOpen` returns a fixed set; writes record their calls. */
function fakeDispatches(open: Dispatch[]): {
  repo: DispatchRepository;
  finishes: Array<{ id: string; outcome: string }>;
  seen: Array<{ id: string; status: string }>;
} {
  const finishes: Array<{ id: string; outcome: string }> = [];
  const seen: Array<{ id: string; status: string }> = [];
  const unused = () => {
    throw new Error("detection only reads open rows and writes finish/recordSeen");
  };
  return {
    finishes,
    seen,
    repo: {
      listOpen: async () => open,
      findById: async (id) => open.find((row) => row.id === id) ?? null,
      findOpenByTaskId: async (taskId) => open.find((row) => row.taskId === taskId) ?? null,
      findOpenByTabId: async (tabId) => open.filter((row) => row.tabId === tabId),
      findByTaskId: async (taskId) => open.filter((row) => row.taskId === taskId),
      finish: async (id, outcome) => {
        finishes.push({ id, outcome });
        return dispatch({ id, outcome, endedAt: NOW });
      },
      recordSeen: async (id, input) => {
        seen.push({ id, status: input.status });
      },
      acquireLease: unused,
      recordPlacement: unused,
      recordStart: unused,
      finishOpenForTask: unused,
      finishOpenForTab: unused,
    },
  };
}

function fakeTasks(tasks: Record<string, LostAgentTask>): {
  port: LostAgentTaskPort;
  flags: Array<{ id: string; reason: string }>;
} {
  const flags: Array<{ id: string; reason: string }> = [];
  return {
    flags,
    port: {
      findById: async (id) => tasks[id] ?? null,
      flagNeedsHuman: async (id, reason) => {
        flags.push({ id, reason });
      },
    },
  };
}

function run(options: {
  open: Dispatch[];
  tasks?: Record<string, LostAgentTask>;
  panes?: HarnessPane[];
  fail?: Error;
}) {
  const harness = fakeHarness({ panes: options.panes, fail: options.fail });
  const dispatches = fakeDispatches(options.open);
  const tasks = fakeTasks(options.tasks ?? {});
  const useCase = new DetectLostAgentsUseCase({
    dispatches: dispatches.repo,
    tasks: tasks.port,
    harness: harness.port,
    now: () => NOW,
  });
  return { useCase, harness, dispatches, tasks };
}

describe("DetectLostAgentsUseCase", () => {
  it("flags a vanished agent whose task is unfinished and ends the dispatch as lost", async () => {
    const { useCase, dispatches, tasks } = run({
      open: [dispatch()],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "in_progress" } },
      panes: [],
    });

    const result = await useCase.execute();

    expect(result.available).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.live).toBe(0);
    expect(result.lost).toHaveLength(1);
    expect(dispatches.finishes).toEqual([{ id: "d1", outcome: "lost" }]);
    expect(tasks.flags).toHaveLength(1);
    const finding = result.lost[0] as LostAgentFinding;
    expect(finding.paneId).toBe("wR:pH");
    expect(finding.lastSeenStatus).toBe("working");
    // The reason names the pane, the tab, the agent, the last status and the task.
    expect(tasks.flags[0]?.reason).toContain("wR:pH");
    expect(tasks.flags[0]?.reason).toContain("tab wR:t3");
    expect(tasks.flags[0]?.reason).toContain('agent "dsp-6-46e044bf" (pi)');
    expect(tasks.flags[0]?.reason).toContain("last seen working");
    expect(tasks.flags[0]?.reason).toContain("in_progress");
    expect(tasks.flags[0]?.reason).toBe(finding.reason);
  });

  it("leaves a live agent untouched and refreshes its last-seen status", async () => {
    const { useCase, dispatches, tasks, harness } = run({
      open: [dispatch()],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "in_progress" } },
      panes: [pane("wR:pH")],
    });

    const result = await useCase.execute();

    expect(result.lost).toEqual([]);
    expect(result.live).toBe(1);
    expect(dispatches.finishes).toEqual([]);
    expect(tasks.flags).toEqual([]);
    expect(dispatches.seen).toEqual([{ id: "d1", status: "working" }]);
    expect(harness.listPanesCalls).toEqual(["wR"]);
  });

  it("ends a vanished agent's row as closed when its task is already done", async () => {
    const { useCase, dispatches, tasks } = run({
      open: [dispatch()],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "done" } },
      panes: [],
    });

    const result = await useCase.execute();

    expect(result.lost).toEqual([]);
    expect(result.completed).toBe(1);
    // The work is over, so the row must not hold the task's lease forever (DSP-8).
    expect(dispatches.finishes).toEqual([{ id: "d1", outcome: "closed" }]);
    expect(tasks.flags).toEqual([]);
  });

  it("ignores a dispatch that already ended with an outcome", async () => {
    const { useCase, dispatches, tasks } = run({
      open: [dispatch({ endedAt: NOW, outcome: "closed" })],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "in_progress" } },
      panes: [],
    });

    const result = await useCase.execute();

    expect(result.checked).toBe(0);
    expect(result.lost).toEqual([]);
    expect(dispatches.finishes).toEqual([]);
    expect(tasks.flags).toEqual([]);
  });

  it("ignores a lease-only attempt that never started an agent", async () => {
    const { useCase, dispatches } = run({
      open: [dispatch({ startedAt: null, paneId: null, agentName: null, lastSeenStatus: null, lastSeenAt: null })],
      panes: [],
    });

    const result = await useCase.execute();

    expect(result.checked).toBe(0);
    expect(result.lost).toEqual([]);
    expect(dispatches.finishes).toEqual([]);
  });

  it("ends a vanished agent whose task is missing, but flags nothing", async () => {
    const { useCase, dispatches, tasks } = run({ open: [dispatch()], tasks: {}, panes: [] });

    const result = await useCase.execute();

    expect(dispatches.finishes).toEqual([{ id: "d1", outcome: "lost" }]);
    expect(tasks.flags).toEqual([]);
    expect(result.lost).toHaveLength(1);
    expect(result.lost[0]?.reason).toContain("its task is missing");
  });

  it("flags nothing when the live snapshot cannot be read", async () => {
    const { useCase, dispatches, tasks } = run({
      open: [dispatch()],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "in_progress" } },
      fail: new Error("herdr socket unavailable"),
    });

    const result = await useCase.execute();

    expect(result.available).toBe(false);
    expect(result.reason).toContain("herdr socket unavailable");
    expect(result.lost).toEqual([]);
    expect(dispatches.finishes).toEqual([]);
    expect(dispatches.seen).toEqual([]);
    expect(tasks.flags).toEqual([]);
  });

  it("reports an unknown last status instead of inventing one", async () => {
    const { useCase, tasks } = run({
      open: [dispatch({ lastSeenStatus: null, lastSeenAt: null })],
      tasks: { t1: { id: "t1", title: "DSP-6 detection", status: "blocked" } },
      panes: [],
    });

    const result = await useCase.execute();

    expect(result.lost[0]?.reason).toContain("last status was never recorded");
    expect(tasks.flags[0]?.reason).not.toContain("last seen");
  });
});
