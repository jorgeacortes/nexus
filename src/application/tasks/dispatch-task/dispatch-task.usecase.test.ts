import { describe, expect, it } from "vitest";

import { DispatchTaskUseCase } from "@/application/tasks/dispatch-task";
import { AgentUnreachableError, NoEligibleAgentError } from "@/application/tasks/errors";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

const FOLDER = "/home/sandbox/ws/biznagatec-ws/nexus";

function projectsWith(id = "p-nexus", folderPath: string | null = FOLDER): ProjectReferencePort {
  return {
    exists: async (ref) => ref === id,
    find: async (ref) => (ref === id ? { id, name: "nexus", folderPath } : null),
  };
}

const liveAgents = (agents: LiveAgentInfo[]): LiveAgentPort => ({ list: async () => agents });

function agent(paneId: string, status: string, cwd: string, agentKind = "pi"): LiveAgentInfo {
  return { paneId, agentKind, status, cwd, model: null, effort: null };
}

function recordingPrompt(): { port: AgentPromptPort; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    port: {
      prompt: async (paneId, text) => {
        calls.push([paneId, text]);
      },
    },
  };
}

function setup() {
  const tasks = new DrizzleTaskRepository(createTestDb());
  const { port, calls } = recordingPrompt();
  return { tasks, prompt: port, calls };
}

describe("DispatchTaskUseCase", () => {
  it("prompts an explicit pane and records the assignment pointers", async () => {
    const { tasks, prompt, calls } = setup();
    const task = await tasks.save({ title: "wire TAVILY", projectId: "p-nexus", status: "ready" });

    const dispatched = await new DispatchTaskUseCase(
      tasks,
      projectsWith(),
      prompt,
      liveAgents([agent("wR:p1", "idle", FOLDER)]),
    ).execute(task.id, { paneId: "wR:p1" });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("wR:p1");
    expect(calls[0][1]).toContain(`nx claim ${task.id}`);
    expect(calls[0][1]).toContain(`nx done ${task.id}`);
    expect(dispatched.assignee).toBe("agent");
    expect(dispatched.agentName).toBe("pi");
    expect(dispatched.harness).toBe("pi");
    expect(dispatched.herdrPaneId).toBe("wR:p1");
  });

  it("records the resolved harness and clears a stale identity for a non-live pane", async () => {
    const { tasks, prompt } = setup();
    const task = await tasks.save({
      title: "stale",
      projectId: "p-nexus",
      status: "ready",
      assignee: "agent",
      agentName: "pi",
      harness: "pi",
    });

    const dispatched = await new DispatchTaskUseCase(tasks, projectsWith(), prompt, liveAgents([])).execute(task.id, {
      paneId: "wR:p9",
    });

    expect(dispatched.agentName).toBeNull();
    expect(dispatched.harness).toBeNull();
    expect(dispatched.herdrPaneId).toBe("wR:p9");
  });

  it("drops a model the resolved harness cannot run", async () => {
    const { tasks, prompt } = setup();
    const task = await tasks.save({
      title: "cursor model on claude",
      projectId: "p-nexus",
      status: "ready",
      assignee: "agent",
      harness: "pi",
      model: "grok-4.6",
    });

    const dispatched = await new DispatchTaskUseCase(
      tasks,
      projectsWith(),
      prompt,
      liveAgents([agent("wR:p1", "idle", FOLDER, "claude")]),
    ).execute(task.id, { paneId: "wR:p1" });

    expect(dispatched.harness).toBe("claude_code");
    expect(dispatched.model).toBeNull();
    expect(dispatched.effort).toBeNull();
  });

  it("auto picks the idle pane inside the project folder", async () => {
    const { tasks, prompt, calls } = setup();
    const task = await tasks.save({ title: "auto work", projectId: "p-nexus", status: "ready" });

    const dispatched = await new DispatchTaskUseCase(
      tasks,
      projectsWith(),
      prompt,
      liveAgents([
        agent("wP:p4", "working", FOLDER),
        agent("wM:p1", "idle", "/tmp/elsewhere"),
        agent("wR:p1", "idle", `${FOLDER}/src`),
      ]),
    ).execute(task.id, { target: "auto" });

    expect(calls.map((call) => call[0])).toEqual(["wR:p1"]);
    expect(dispatched.herdrPaneId).toBe("wR:p1");
  });

  it("fails loudly when no idle pane sits in the project folder", async () => {
    const { tasks, prompt, calls } = setup();
    const task = await tasks.save({ title: "no one home", projectId: "p-nexus", status: "ready" });

    await expect(
      new DispatchTaskUseCase(
        tasks,
        projectsWith(),
        prompt,
        liveAgents([agent("wP:p4", "working", FOLDER), agent("wM:p1", "idle", "/tmp/elsewhere")]),
      ).execute(task.id, { target: "auto" }),
    ).rejects.toThrow(NoEligibleAgentError);
    expect(calls).toEqual([]);
  });

  it("fails auto when the project has no folder", async () => {
    const { tasks, prompt } = setup();
    const task = await tasks.save({ title: "no folder", projectId: "p-nexus", status: "ready" });

    await expect(
      new DispatchTaskUseCase(
        tasks,
        projectsWith("p-nexus", null),
        prompt,
        liveAgents([agent("wR:p1", "idle", FOLDER)]),
      ).execute(task.id, { target: "auto" }),
    ).rejects.toThrow(/no folder path/);
  });

  it("keeps the assignment untouched when the pane is unreachable", async () => {
    const { tasks } = setup();
    const task = await tasks.save({ title: "unreachable", projectId: "p-nexus", status: "ready" });
    const failing: AgentPromptPort = {
      prompt: async () => {
        throw new Error("socket down");
      },
    };

    await expect(
      new DispatchTaskUseCase(tasks, projectsWith(), failing, liveAgents([])).execute(task.id, { paneId: "wR:p1" }),
    ).rejects.toThrow(AgentUnreachableError);
    expect((await tasks.findById(task.id))?.herdrPaneId).toBeNull();
  });

  it("lets an explicit pane win over auto", async () => {
    const { tasks, prompt, calls } = setup();
    const task = await tasks.save({ title: "explicit", projectId: "p-nexus", status: "ready" });

    await new DispatchTaskUseCase(
      tasks,
      projectsWith(),
      prompt,
      liveAgents([agent("wP:p9", "idle", FOLDER), agent("wR:p1", "idle", FOLDER)]),
    ).execute(task.id, { paneId: "wP:p9", target: "auto" });

    expect(calls.map((call) => call[0])).toEqual(["wP:p9"]);
  });
});
