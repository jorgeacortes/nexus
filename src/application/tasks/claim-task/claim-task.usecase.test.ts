import { describe, expect, it } from "vitest";

import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import { CompleteTaskUseCase } from "@/application/tasks/complete-task";
import { TaskNotFoundError } from "@/application/tasks/errors";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";
import { TaskAlreadyClaimedError, TaskTransitionError } from "@/domain/tasks/task";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

function liveAgents(agents: LiveAgentInfo[] = []): LiveAgentPort {
  return { list: async () => agents };
}

function agent(paneId: string, agentKind: string): LiveAgentInfo {
  return { paneId, agentKind, status: "working", cwd: "/home/sandbox/ws/biznagatec-ws/nexus" };
}

describe("ClaimTaskUseCase", () => {
  it("records the live agent kind and harness, never the pane/tab id", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "claim me", status: "ready" });
    const claimed = await new ClaimTaskUseCase(repo, liveAgents([agent("wR:p1", "claude")])).execute(task.id, {
      paneId: "wR:p1",
    });
    expect(claimed.status).toBe("in_progress");
    expect(claimed.agentName).toBe("claude");
    expect(claimed.harness).toBe("claude_code");
    expect(claimed.herdrPaneId).toBe("wR:p1");
  });

  it("leaves the identity empty when the pane is not a live agent", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "bare shell", status: "ready" });
    const claimed = await new ClaimTaskUseCase(repo, liveAgents()).execute(task.id, { paneId: "wR:p1" });
    expect(claimed.harness).toBeNull();
    expect(claimed.agentName).toBeNull();
    expect(claimed.herdrPaneId).toBe("wR:p1");
  });

  it("still claims when Herdr is unreachable", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "herdr down", status: "ready" });
    const down: LiveAgentPort = {
      list: async () => {
        throw new Error("socket down");
      },
    };
    const claimed = await new ClaimTaskUseCase(repo, down).execute(task.id, { paneId: "wR:p1" });
    expect(claimed.status).toBe("in_progress");
    expect(claimed.agentName).toBeNull();
    expect(claimed.harness).toBeNull();
  });

  it("rejects a second pane's claim", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "claimed" });
    await new ClaimTaskUseCase(repo, liveAgents()).execute(task.id, { paneId: "wR:p1" });
    await expect(new ClaimTaskUseCase(repo, liveAgents()).execute(task.id, { paneId: "wP:p4" })).rejects.toThrow(
      TaskAlreadyClaimedError,
    );
  });

  it("rejects an unknown task", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    await expect(new ClaimTaskUseCase(repo, liveAgents()).execute("missing", { paneId: "wR:p1" })).rejects.toThrow(
      TaskNotFoundError,
    );
  });
});

describe("CompleteTaskUseCase", () => {
  it("completes a claimed task with notes", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "finish me" });
    await new ClaimTaskUseCase(repo, liveAgents()).execute(task.id, { paneId: "wR:p1" });
    const done = await new CompleteTaskUseCase(repo).execute(task.id, { notes: "commit deadbeef" });
    expect(done.status).toBe("done");
    expect(done.completionNotes).toBe("commit deadbeef");
  });

  it("rejects completing a backlog task", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "not started" });
    await expect(new CompleteTaskUseCase(repo).execute(task.id)).rejects.toThrow(TaskTransitionError);
  });
});
