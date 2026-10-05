import { describe, expect, it } from "vitest";
import { EnsureWorkspaceUseCase } from "@/application/dispatch/ensure-workspace";
import { MissingProjectFolderError } from "@/application/dispatch/errors";
import type { HarnessPane, HarnessPort, HarnessWorkspace } from "@/domain/dispatch/harness";
import type { DispatchProject, ProjectWorkspacePort } from "@/domain/dispatch/project-workspace";

function workspace(workspaceId: string, label: string): HarnessWorkspace {
  return {
    workspaceId,
    label,
    focused: false,
    tabCount: 1,
    paneCount: 1,
    agentStatus: "unknown",
    activeTabId: null,
  };
}

function pane(workspaceId: string, cwd: string | null): HarnessPane {
  return {
    paneId: `${workspaceId}:p1`,
    tabId: `${workspaceId}:t1`,
    workspaceId,
    agent: null,
    agentStatus: "unknown",
    cwd,
    focused: false,
    terminalTitle: "",
  };
}

function project(overrides: Partial<DispatchProject> = {}): DispatchProject {
  return {
    id: "p1",
    name: "nexus",
    folderPath: "/home/sandbox/ws/biznagatec-ws/nexus",
    herdrWorkspaceId: null,
    ...overrides,
  };
}

/**
 * A fake `HarnessPort`: no socket, no spawn. `createWorkspace` records the call
 * and mints a new id, so a test can assert both the branch taken and the id that
 * was persisted.
 */
function fakeHarness(parts: { workspaces?: HarnessWorkspace[]; panes?: Record<string, HarnessPane[]> }): {
  port: HarnessPort;
  created: Array<{ label: string; cwd: string | null }>;
  paneCalls: string[];
} {
  const created: Array<{ label: string; cwd: string | null }> = [];
  const paneCalls: string[] = [];
  const unused = () => {
    throw new Error("write method is not part of this flow");
  };
  return {
    created,
    paneCalls,
    port: {
      listWorkspaces: async () => parts.workspaces ?? [],
      listTabs: async () => [],
      getTab: async () => null,
      listPanes: async (workspaceId) => {
        paneCalls.push(workspaceId);
        return parts.panes?.[workspaceId] ?? [];
      },
      processes: async () => [],
      createWorkspace: async (label, cwd) => {
        created.push({ label, cwd });
        return workspace(`wNew${created.length}`, label);
      },
      createTab: unused,
      startAgent: unused,
      closeTab: unused,
    },
  };
}

function fakeProjects(): { port: ProjectWorkspacePort; writes: Array<{ projectId: string; workspaceId: string }> } {
  const writes: Array<{ projectId: string; workspaceId: string }> = [];
  return {
    writes,
    port: {
      setWorkspaceId: async (projectId, workspaceId) => {
        writes.push({ projectId, workspaceId });
      },
    },
  };
}

describe("EnsureWorkspaceUseCase", () => {
  it("uses the stored id when the live snapshot has it, without writing or creating", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wR", "nexus"), workspace("wK", "valua")] });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(
      project({ herdrWorkspaceId: "wR" }),
    );

    expect(result).toEqual({ workspace: workspace("wR", "nexus"), outcome: "stored", matchedBy: null });
    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([]);
  });

  it("adopts a live workspace whose label matches the project and persists its id", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wR", "nexus")] });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project());

    expect(result).toEqual({ workspace: workspace("wR", "nexus"), outcome: "matched", matchedBy: "label" });
    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wR" }]);
  });

  it("matches label case-insensitively and ignores surrounding whitespace", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wR", "  NeXuS  ")] });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project());

    expect(result.workspace.workspaceId).toBe("wR");
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wR" }]);
  });

  it("matches a live workspace whose panes run in the project folder when no label matches", async () => {
    const harness = fakeHarness({
      workspaces: [workspace("wF", "some other label")],
      panes: { wF: [pane("wF", "/home/sandbox/ws/biznagatec-ws/nexus")] },
    });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project());

    expect(result).toEqual({ workspace: workspace("wF", "some other label"), outcome: "matched", matchedBy: "folder" });
    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wF" }]);
  });

  it("repairs a dead stored id with a live label match instead of using or leaving it dangling", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wLive", "nexus")] });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(
      project({ herdrWorkspaceId: "wDead" }),
    );

    expect(result.workspace.workspaceId).toBe("wLive");
    expect(result.outcome).toBe("matched");
    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wLive" }]);
  });

  it("repairs a dead stored id with a folder match when no label matches", async () => {
    const harness = fakeHarness({
      workspaces: [workspace("wF", "renamed")],
      panes: { wF: [pane("wF", "/home/sandbox/ws/biznagatec-ws/nexus/")] },
    });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(
      project({ herdrWorkspaceId: "wDead" }),
    );

    expect(result.matchedBy).toBe("folder");
    expect(result.workspace.workspaceId).toBe("wF");
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wF" }]);
  });

  it("prefers, among label matches, the workspace whose panes run in the project folder", async () => {
    const harness = fakeHarness({
      workspaces: [workspace("wA", "nexus"), workspace("wB", "NEXUS")],
      panes: {
        wA: [pane("wA", "/tmp/elsewhere")],
        wB: [pane("wB", "/home/sandbox/ws/biznagatec-ws/nexus")],
      },
    });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project());

    expect(result.workspace.workspaceId).toBe("wB");
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wB" }]);
  });

  it("creates a workspace labelled for the project and persists the new id when nothing matches", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wOther", "valua")] });
    const projects = fakeProjects();

    const result = await new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project({ name: "joma" }));

    expect(result.outcome).toBe("created");
    expect(result.matchedBy).toBeNull();
    expect(harness.created).toEqual([{ label: "joma", cwd: "/home/sandbox/ws/biznagatec-ws/nexus" }]);
    expect(projects.writes).toEqual([{ projectId: "p1", workspaceId: "wNew1" }]);
  });

  it("refuses when nothing matches and the project has no folder to create in", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wOther", "valua")] });
    const projects = fakeProjects();

    await expect(
      new EnsureWorkspaceUseCase(harness.port, projects.port).execute(project({ folderPath: null })),
    ).rejects.toThrow(MissingProjectFolderError);

    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([]);
  });

  it("refuses a dead stored id when there is no match and no folder, rather than reusing it", async () => {
    const harness = fakeHarness({ workspaces: [] });
    const projects = fakeProjects();

    await expect(
      new EnsureWorkspaceUseCase(harness.port, projects.port).execute(
        project({ herdrWorkspaceId: "wDead", folderPath: null }),
      ),
    ).rejects.toThrow('Project "nexus" has no folder path');

    expect(harness.created).toEqual([]);
    expect(projects.writes).toEqual([]);
  });

  it("does not call listPanes when the stored id is live", async () => {
    const harness = fakeHarness({ workspaces: [workspace("wR", "nexus")] });

    await new EnsureWorkspaceUseCase(harness.port, fakeProjects().port).execute(project({ herdrWorkspaceId: "wR" }));

    expect(harness.paneCalls).toEqual([]);
  });
});
