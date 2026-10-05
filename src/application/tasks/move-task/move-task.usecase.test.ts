import { describe, expect, it } from "vitest";
import { TaskNotFoundError } from "@/application/tasks/errors";
import { MoveTaskUseCase } from "@/application/tasks/move-task";
import type { FinishedTaskDispatchPort } from "@/domain/tasks/finished-task-dispatch";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

function fakeDispatch(): { port: FinishedTaskDispatchPort; ended: string[] } {
  const ended: string[] = [];
  return {
    ended,
    port: {
      endOpenForTask: async (taskId) => {
        ended.push(taskId);
      },
    },
  };
}

describe("MoveTaskUseCase", () => {
  it("ends the task's open dispatch as closed when dragged to done", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "move me", status: "ready" });
    const dispatch = fakeDispatch();

    const moved = await new MoveTaskUseCase(repo, dispatch.port).execute(task.id, "done");

    expect(moved.status).toBe("done");
    expect(dispatch.ended).toEqual([task.id]);
  });

  it("leaves the dispatch ledger alone for a move to any other column", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "still open", status: "ready" });
    const dispatch = fakeDispatch();

    await new MoveTaskUseCase(repo, dispatch.port).execute(task.id, "in_progress");

    expect(dispatch.ended).toEqual([]);
  });

  it("rejects an unknown task", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    await expect(new MoveTaskUseCase(repo, fakeDispatch().port).execute("missing", "done")).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });
});
