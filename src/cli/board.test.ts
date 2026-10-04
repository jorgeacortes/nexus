import { describe, expect, it } from "vitest";

import { buildBoardRows } from "@/cli/board";
import type { LiveAgent, Project, Task } from "@/cli/types";

function agent(overrides: Partial<LiveAgent> = {}): LiveAgent {
  return {
    paneId: "wR:p1",
    tabId: "wR:t1",
    workspaceId: "wR",
    workspaceLabel: "nexus",
    tabLabel: "1",
    agentKind: "pi",
    harness: "pi",
    status: "working",
    cwd: "/home/sandbox/ws/biznagatec-ws/nexus",
    terminalTitle: "π - nexus",
    model: null,
    effort: null,
    topic: null,
    focused: false,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-nexus",
    name: "nexus",
    folderPath: "/home/sandbox/ws/biznagatec-ws/nexus",
    herdrWorkspaceId: "wR",
    createdAt: "2026-10-04T08:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "p-nexus",
    title: "ship the board",
    description: null,
    status: "ready",
    priority: "normal",
    assignee: null,
    agentName: null,
    harness: null,
    model: null,
    effort: null,
    herdrPaneId: null,
    needsHuman: false,
    needsHumanReason: null,
    claimedAt: null,
    completedAt: null,
    completionNotes: null,
    createdAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
    ...overrides,
  };
}

describe("buildBoardRows", () => {
  it("links a claimed task to the agent's pane", () => {
    const claimed = task({ status: "in_progress", herdrPaneId: "wR:p1", assignee: "agent" });
    const rows = buildBoardRows({ tasks: [claimed], projects: [project()], agents: [agent({ topic: "working it" })] });

    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe("nexus");
    expect(rows[0].agent).toContain("wR:p1");
    expect(rows[0].status).toContain("working");
    expect(rows[0].task).toContain("#11111111 ship the board");
    expect(rows[0].taskStatus).toBe("in_progress");
    expect(rows[0].topic).toBe("working it");
  });

  it("shows unclaimed non-done tasks as their own rows and hides done ones", () => {
    const ready = task({ id: "aaaaaaaa-0000-4000-8000-000000000000", status: "ready" });
    const done = task({ id: "bbbbbbbb-0000-4000-8000-000000000000", status: "done" });
    const rows = buildBoardRows({ tasks: [ready, done], projects: [project()], agents: [] });

    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe("");
    expect(rows[0].task).toContain("#aaaaaaaa");
    expect(rows[0].taskStatus).toBe("ready");
  });

  it("falls back to the project matching the agent's cwd", () => {
    const rows = buildBoardRows({ tasks: [], projects: [project()], agents: [agent({ status: "idle" })] });
    expect(rows[0].project).toBe("nexus");
    expect(rows[0].task).toBe("");
  });

  it("uses the [#id] topic as a display-only hint and does not repeat the task", () => {
    const hinted = task({ id: "cccccccc-1111-4111-8111-111111111111", status: "ready" });
    const rows = buildBoardRows({
      tasks: [hinted],
      projects: [project()],
      agents: [agent({ terminalTitle: "π [#cccccccc] the board", cwd: "/tmp/elsewhere", workspaceLabel: "wR" })],
    });

    // The agent row carries the hint (marked with ~); no separate unclaimed row.
    expect(rows).toHaveLength(1);
    expect(rows[0].task).toContain("#cccccccc");
    expect(rows[0].task).toContain("~");
  });

  it("sorts by project, then working agents first", () => {
    const idle = agent({ paneId: "wR:p2", status: "idle", cwd: "/home/sandbox/ws/biznagatec-ws/nexus" });
    const working = agent({ paneId: "wR:p1", status: "working" });
    const rows = buildBoardRows({ tasks: [], projects: [project()], agents: [idle, working] });

    expect(rows.map((row) => row.status)).toEqual([
      expect.stringContaining("working"),
      expect.stringContaining("idle"),
    ]);
  });
});
