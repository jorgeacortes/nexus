import { describe, expect, it } from "vitest";

import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import { CompleteTaskUseCase } from "@/application/tasks/complete-task";
import { TaskNotFoundError } from "@/application/tasks/errors";
import { TaskAlreadyClaimedError, TaskTransitionError } from "@/domain/tasks/task";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

describe("ClaimTaskUseCase", () => {
  it("claims a task for a pane", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "claim me", status: "ready" });
    const claimed = await new ClaimTaskUseCase(repo).execute(task.id, { paneId: "wR:p1", agentName: "pi" });
    expect(claimed.status).toBe("in_progress");
    expect(claimed.agentName).toBe("pi");
  });

  it("rejects a second pane's claim", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "claimed" });
    await new ClaimTaskUseCase(repo).execute(task.id, { paneId: "wR:p1" });
    await expect(new ClaimTaskUseCase(repo).execute(task.id, { paneId: "wP:p4" })).rejects.toThrow(
      TaskAlreadyClaimedError,
    );
  });

  it("rejects an unknown task", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    await expect(new ClaimTaskUseCase(repo).execute("missing", { paneId: "wR:p1" })).rejects.toThrow(TaskNotFoundError);
  });
});

describe("CompleteTaskUseCase", () => {
  it("completes a claimed task with notes", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "finish me" });
    await new ClaimTaskUseCase(repo).execute(task.id, { paneId: "wR:p1" });
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
