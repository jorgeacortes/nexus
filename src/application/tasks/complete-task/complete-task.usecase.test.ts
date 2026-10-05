import { describe, expect, it } from "vitest";

import { CompleteTaskUseCase } from "@/application/tasks/complete-task";
import { DispatchLeaseHeldError } from "@/domain/dispatch/dispatch";
import type { FinishedTaskDispatchPort } from "@/domain/tasks/finished-task-dispatch";
import { TaskTransitionError } from "@/domain/tasks/task";
import { DrizzleDispatchRepository } from "@/infrastructure/repositories/dispatch/drizzle-dispatch.repository";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

const NOW = new Date("2026-10-05T18:00:00.000Z");
const TTL = new Date("2026-10-05T18:05:00.000Z");

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

/** The composition root's adapter, against the real ledger. */
function realDispatch(dispatches: DrizzleDispatchRepository): FinishedTaskDispatchPort {
  return {
    endOpenForTask: async (taskId) => {
      await dispatches.finishOpenForTask(taskId, NOW);
    },
  };
}

describe("CompleteTaskUseCase", () => {
  it("ends the task's open dispatch as closed when it completes", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "finish me" });
    await repo.claim(task.id, { paneId: "wR:p1" });
    const dispatch = fakeDispatch();

    const done = await new CompleteTaskUseCase(repo, dispatch.port).execute(task.id, { notes: "commit deadbeef" });

    expect(done.status).toBe("done");
    expect(dispatch.ended).toEqual([task.id]);
  });

  it("touches nothing when the transition is rejected", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "not started" });
    const dispatch = fakeDispatch();

    await expect(new CompleteTaskUseCase(repo, dispatch.port).execute(task.id)).rejects.toBeInstanceOf(
      TaskTransitionError,
    );
    expect(dispatch.ended).toEqual([]);
  });

  it("frees the lease so a completed task can be dispatched again", async () => {
    const db = createTestDb();
    const tasks = new DrizzleTaskRepository(db);
    const dispatches = new DrizzleDispatchRepository(db);
    const task = await tasks.save({ title: "dispatch, complete, dispatch again", status: "ready" });

    const first = await dispatches.acquireLease({
      taskId: task.id,
      leaseOwner: "host:1",
      now: NOW,
      leaseUntil: TTL,
    });
    await dispatches.recordPlacement(first.id, { workspaceId: "wR", tabId: "wR:t1", paneId: "wR:p1" });
    await dispatches.recordStart(first.id, { agentName: "smoke-46e044bf", harness: "pi", startedAt: NOW });
    await tasks.claim(task.id, { paneId: "wR:p1" });

    await new CompleteTaskUseCase(tasks, realDispatch(dispatches)).execute(task.id, { notes: "done" });

    // The first row ended as the success outcome, and the lease is free.
    expect((await dispatches.findById(first.id))?.outcome).toBe("closed");
    const second = await dispatches.acquireLease({
      taskId: task.id,
      leaseOwner: "host:2",
      now: NOW,
      leaseUntil: TTL,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("still refuses a second lease while the task's agent is running", async () => {
    const db = createTestDb();
    const tasks = new DrizzleTaskRepository(db);
    const dispatches = new DrizzleDispatchRepository(db);
    const task = await tasks.save({ title: "still running", status: "ready" });

    const first = await dispatches.acquireLease({
      taskId: task.id,
      leaseOwner: "host:1",
      now: NOW,
      leaseUntil: TTL,
    });
    await dispatches.recordStart(first.id, { agentName: "smoke-46e044bf", harness: "pi", startedAt: NOW });

    // No completion happened, so the running dispatch still holds the lease.
    await expect(
      dispatches.acquireLease({ taskId: task.id, leaseOwner: "host:2", now: NOW, leaseUntil: TTL }),
    ).rejects.toBeInstanceOf(DispatchLeaseHeldError);
  });
});
