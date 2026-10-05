import { beforeEach, describe, expect, it } from "vitest";

import { DispatchTaskUseCase } from "@/application/dispatch/dispatch-task";
import { EnsureWorkspaceUseCase } from "@/application/dispatch/ensure-workspace";
import {
  DispatchLeaseHeldError,
  DispatchNotDispatchableError,
  DispatchRequiresProjectError,
  DispatchSpawnError,
} from "@/domain/dispatch/dispatch";
import type {
  HarnessPane,
  HarnessPort,
  HarnessTab,
  HarnessTabCreated,
  HarnessWorkspace,
} from "@/domain/dispatch/harness";
import type { DispatchProject } from "@/domain/dispatch/project-workspace";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { DrizzleDispatchRepository } from "@/infrastructure/repositories/dispatch/drizzle-dispatch.repository";
import { DrizzleProjectRepository } from "@/infrastructure/repositories/projects/drizzle-project.repository";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

const FOLDER = "/tmp/dsp-smoke";
const NOW = new Date("2026-10-05T18:00:00.000Z");

function workspace(workspaceId: string, label: string): HarnessWorkspace {
  return { workspaceId, label, focused: false, tabCount: 1, paneCount: 1, agentStatus: "unknown", activeTabId: null };
}

function tab(tabId: string, workspaceId: string, label: string): HarnessTab {
  return { tabId, workspaceId, label, focused: false, paneCount: 1, agentStatus: "unknown" };
}

function pane(paneId: string, workspaceId: string, overrides: Partial<HarnessPane> = {}): HarnessPane {
  return {
    paneId,
    tabId: `${workspaceId}:t1`,
    workspaceId,
    agent: null,
    agentStatus: "unknown",
    cwd: FOLDER,
    focused: false,
    terminalTitle: "",
    ...overrides,
  };
}

type HarnessCalls = {
  createWorkspace: Array<{ label: string; cwd: string | null }>;
  listPanes: string[];
  createTab: Array<{ workspaceId: string; label: string; cwd: string | null }>;
  renameTab: Array<{ tabId: string; label: string }>;
  startAgent: Array<{ name: string; kind: string; paneId: string; timeoutMs: number | undefined }>;
  closeTab: string[];
};

/** A fake `HarnessPort`: records every call, mints workspace/tab/pane ids. */
function fakeHarness(options: { workspaces?: HarnessWorkspace[]; panes?: HarnessPane[]; failStart?: Error }): {
  port: HarnessPort;
  calls: HarnessCalls;
  startedPanes: string[];
} {
  const calls: HarnessCalls = {
    createWorkspace: [],
    listPanes: [],
    createTab: [],
    renameTab: [],
    startAgent: [],
    closeTab: [],
  };
  const startedPanes: string[] = [];
  let createdWorkspaces = 0;
  let createdTabs = 0;
  return {
    calls,
    startedPanes,
    port: {
      listWorkspaces: async () => options.workspaces ?? [],
      listTabs: async (workspaceId) => [tab(`${workspaceId}:t1`, workspaceId, "dsp-smoke")],
      listPanes: async (workspaceId) => {
        calls.listPanes.push(workspaceId);
        return options.panes ?? [];
      },
      getTab: async () => null,
      processes: async () => [],
      createWorkspace: async (label, cwd) => {
        calls.createWorkspace.push({ label, cwd });
        createdWorkspaces += 1;
        return workspace(`wNew${createdWorkspaces}`, label);
      },
      createTab: async (workspaceId, label, cwd): Promise<HarnessTabCreated> => {
        calls.createTab.push({ workspaceId, label, cwd });
        createdTabs += 1;
        const tabId = `${workspaceId}:t${createdTabs}`;
        const rootPane = pane(`${workspaceId}:p${createdTabs}`, workspaceId);
        return { tab: tab(tabId, workspaceId, label), rootPane };
      },
      renameTab: async (tabId, label) => {
        calls.renameTab.push({ tabId, label });
      },
      startAgent: async (name, kind, paneId, startOptions) => {
        calls.startAgent.push({ name, kind, paneId, timeoutMs: startOptions?.timeoutMs });
        if (options.failStart) throw options.failStart;
        startedPanes.push(paneId);
      },
      closeTab: async (tabId) => {
        calls.closeTab.push(tabId);
      },
    },
  };
}

describe("DispatchTaskUseCase", () => {
  let db: NexusDb;
  let taskRepo: DrizzleTaskRepository;
  let dispatchRepo: DrizzleDispatchRepository;
  let projectRepo: DrizzleProjectRepository;
  let project: DispatchProject;

  beforeEach(async () => {
    db = createTestDb();
    taskRepo = new DrizzleTaskRepository(db);
    dispatchRepo = new DrizzleDispatchRepository(db);
    projectRepo = new DrizzleProjectRepository(db);
    const saved = await projectRepo.save({ name: "dsp-smoke", folderPath: FOLDER });
    project = {
      id: saved.id,
      name: saved.name,
      folderPath: saved.folderPath,
      herdrWorkspaceId: saved.herdrWorkspaceId,
    };
  });

  function build(options: { harness?: ReturnType<typeof fakeHarness>; failStart?: Error } = {}) {
    const harness = options.harness ?? fakeHarness({ failStart: options.failStart });
    const prompts: Array<{ paneId: string; text: string }> = [];
    const projects = {
      find: async (id: string): Promise<DispatchProject | null> => {
        const found = await projectRepo.findById(id);
        return found
          ? { id: found.id, name: found.name, folderPath: found.folderPath, herdrWorkspaceId: found.herdrWorkspaceId }
          : null;
      },
      setWorkspaceId: async (id: string, workspaceId: string) => {
        await projectRepo.update(id, { herdrWorkspaceId: workspaceId });
      },
    };
    const agentPrompt: AgentPromptPort = {
      prompt: async (paneId, text) => {
        prompts.push({ paneId, text });
      },
    };
    const liveAgents: LiveAgentPort = {
      list: async (): Promise<LiveAgentInfo[]> =>
        harness.startedPanes.map((paneId) => ({
          paneId,
          agentKind: "pi",
          status: "idle",
          cwd: FOLDER,
          model: "deepseek-v4.1-flash",
          effort: "high",
        })),
    };
    const useCase = new DispatchTaskUseCase({
      tasks: taskRepo,
      dispatches: dispatchRepo,
      harness: harness.port,
      projects,
      ensureWorkspace: new EnsureWorkspaceUseCase(harness.port, projects),
      agentPrompt,
      liveAgents,
      leaseOwner: "test:1",
      now: () => NOW,
      startTimeoutMs: 15_000,
    });
    return { useCase, harness, prompts };
  }

  async function readyTask(overrides: { projectId?: string | null; status?: "ready" | "done"; title?: string } = {}) {
    return taskRepo.save({
      projectId: overrides.projectId === undefined ? project.id : overrides.projectId,
      title: overrides.title ?? "Smoke: reply OK",
      description: "Reply with the single word OK, then stop.",
      status: overrides.status ?? "ready",
    });
  }

  it("leases, ensures the workspace, creates a tab, starts the agent and assigns the task", async () => {
    const task = await readyTask();
    const { useCase, harness, prompts } = build();

    const result = await useCase.execute(task.id);

    expect(harness.calls.createWorkspace).toEqual([{ label: "dsp-smoke", cwd: FOLDER }]);
    expect(harness.calls.createTab).toEqual([{ workspaceId: "wNew1", label: "smoke-reply-ok", cwd: FOLDER }]);
    // A created tab is born with the task's label, so it is never renamed.
    expect(harness.calls.renameTab).toEqual([]);
    expect(harness.calls.startAgent).toHaveLength(1);
    expect(harness.calls.startAgent[0]?.kind).toBe("pi");
    expect(harness.calls.startAgent[0]?.timeoutMs).toBe(15_000);
    expect(harness.calls.startAgent[0]?.paneId).toBe("wNew1:p1");
    expect(harness.calls.startAgent[0]?.name).toMatch(/^smoke-reply-ok-[0-9a-f]{8}$/);

    expect(result.placement).toBe("created_tab");
    expect(result.workspaceOutcome).toBe("created");
    expect(result.dispatch.tabId).toBe("wNew1:t1");
    expect(result.dispatch.paneId).toBe("wNew1:p1");
    expect(result.dispatch.startedAt).not.toBeNull();
    expect(result.dispatch.endedAt).toBeNull();

    // The workspace id is persisted back onto the project.
    expect((await projectRepo.findById(project.id))?.herdrWorkspaceId).toBe("wNew1");

    // The brief is the shared dispatch prompt, pushed into the started pane.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.paneId).toBe("wNew1:p1");
    expect(prompts[0]?.text).toContain(`nx claim ${task.id}`);

    // The task records its pane and the live agent identity, never a pane id as a name.
    const updated = await taskRepo.findById(task.id);
    expect(updated?.assignee).toBe("agent");
    expect(updated?.herdrPaneId).toBe("wNew1:p1");
    expect(updated?.agentName).toBe("pi");
    expect(updated?.harness).toBe("pi");
  });

  it("reuses an idle bare pane already in the project's workspace instead of creating a tab", async () => {
    const task = await readyTask();
    const existing = pane("wR:p4", "wR");
    const harness = fakeHarness({ workspaces: [workspace("wR", "dsp-smoke")], panes: [existing] });
    const { useCase } = build({ harness });

    const result = await useCase.execute(task.id);

    expect(harness.calls.createTab).toEqual([]);
    expect(harness.calls.startAgent[0]?.paneId).toBe("wR:p4");
    expect(result.placement).toBe("reused_pane");
    expect(result.workspaceOutcome).toBe("matched");
    expect(result.dispatch.tabId).toBe("wR:t1");
    // The reused tab (Herdr's `1`) is renamed to the task, never left bare.
    expect(harness.calls.renameTab).toEqual([{ tabId: "wR:t1", label: "smoke-reply-ok" }]);
  });

  it("does not relabel a reused tab that already holds another pane", async () => {
    const task = await readyTask();
    const harness = fakeHarness({
      workspaces: [workspace("wR", "dsp-smoke")],
      panes: [pane("wR:p4", "wR"), pane("wR:p5", "wR", { agent: "claude", agentStatus: "working", tabId: "wR:t1" })],
    });
    const { useCase } = build({ harness });

    const result = await useCase.execute(task.id);

    expect(result.placement).toBe("reused_pane");
    expect(harness.calls.renameTab).toEqual([]);
  });

  it("caps the tab label for a long title", async () => {
    const task = await readyTask({ title: "a".repeat(120) });
    const { useCase, harness } = build();

    await useCase.execute(task.id);

    const label = harness.calls.createTab[0]?.label ?? "";
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.endsWith("…")).toBe(true);
  });

  it("refuses a second dispatch of the same task by the lease, before any topology", async () => {
    const task = await readyTask();
    const { useCase, harness } = build();

    await useCase.execute(task.id);
    const createdAfterFirst = harness.calls.createTab.length;

    await expect(useCase.execute(task.id)).rejects.toBeInstanceOf(DispatchLeaseHeldError);
    expect(harness.calls.createTab).toHaveLength(createdAfterFirst);
    expect(harness.calls.startAgent).toHaveLength(1);
    expect(harness.calls.closeTab).toEqual([]);
  });

  it("supersedes a stale unstarted lease and records it as expired", async () => {
    const task = await readyTask();
    const stale = await dispatchRepo.acquireLease({
      taskId: task.id,
      leaseOwner: "crashed:9",
      now: new Date("2026-10-05T17:00:00.000Z"),
      leaseUntil: new Date("2026-10-05T17:05:00.000Z"),
    });
    const { useCase } = build();

    const result = await useCase.execute(task.id);

    expect(result.dispatch.id).not.toBe(stale.id);
    expect((await dispatchRepo.findById(stale.id))?.outcome).toBe("expired");
  });

  it("records a failed dispatch and flags the orphaned tab when the spawn fails", async () => {
    const task = await readyTask();
    const { useCase, harness } = build({ failStart: new Error("herdr agent.start failed: name taken") });

    const failure = (await useCase.execute(task.id).catch((error: unknown) => error)) as DispatchSpawnError;
    expect(failure).toBeInstanceOf(DispatchSpawnError);
    expect(failure.message).toContain("tab wNew1:t1");

    expect(harness.calls.closeTab).toEqual([]);
    const rows = await dispatchRepo.findByTaskId(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "failed", tabId: "wNew1:t1", paneId: "wNew1:p1", startedAt: null });
    expect(rows[0]?.endedAt).not.toBeNull();

    const flagged = await taskRepo.findById(task.id);
    expect(flagged?.needsHuman).toBe(true);
    expect(flagged?.needsHumanReason).toContain("wNew1:t1");

    // The failed row ended, so the lease is free for a retry.
    expect(await dispatchRepo.findOpenByTaskId(task.id)).toBeNull();
  });

  it("never creates topology when the project has no folder", async () => {
    const noFolder = await projectRepo.save({ name: "nowhere" });
    const task = await taskRepo.save({ projectId: noFolder.id, title: "no folder", status: "ready" });
    const { useCase, harness } = build();

    await expect(useCase.execute(task.id)).rejects.toThrow(/no folder path/);
    expect(harness.calls.createWorkspace).toEqual([]);
    expect(harness.calls.createTab).toEqual([]);
    // The attempt is still recorded, as a failed dispatch.
    expect((await dispatchRepo.findByTaskId(task.id))[0]?.outcome).toBe("failed");
  });

  it("refuses a task that is not backlog/ready and a task with no project", async () => {
    const { useCase } = build();
    const done = await readyTask({ status: "done" });
    await expect(useCase.execute(done.id)).rejects.toBeInstanceOf(DispatchNotDispatchableError);

    const orphan = await taskRepo.save({ title: "no project", status: "ready" });
    await expect(useCase.execute(orphan.id)).rejects.toBeInstanceOf(DispatchRequiresProjectError);
  });
});
