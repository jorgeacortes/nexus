import { describe, expect, it } from "vitest";

import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import { CompleteTaskUseCase } from "@/application/tasks/complete-task";
import { ReviewRequiresDoneError, TaskNotFoundError } from "@/application/tasks/errors";
import { ReviewTaskUseCase } from "@/application/tasks/review-task";
import type { FinishedTaskDispatchPort } from "@/domain/tasks/finished-task-dispatch";
import type { LiveAgentPort } from "@/domain/tasks/live-agents";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

const noAgents: LiveAgentPort = { list: async () => [] };
const noDispatch: FinishedTaskDispatchPort = { endOpenForTask: async () => {} };

/** A repo with one `done` task, the only state a review is meaningful on. */
async function doneTask() {
  const repo = new DrizzleTaskRepository(createTestDb());
  const task = await repo.save({ title: "finish me", status: "ready" });
  await new ClaimTaskUseCase(repo, noAgents).execute(task.id, { paneId: "wR:p1" });
  await new CompleteTaskUseCase(repo, noDispatch).execute(task.id, { notes: "commit deadbeef" });
  return { repo, id: task.id };
}

describe("ReviewTaskUseCase", () => {
  it("stamps reviewedAt on a done task and clears needs-human", async () => {
    const { repo, id } = await doneTask();
    await repo.update(id, { needsHuman: true, needsHumanReason: "waiting on the operator" });

    const reviewed = await new ReviewTaskUseCase(repo).execute(id, true);
    expect(reviewed.status).toBe("done");
    expect(reviewed.reviewedAt).toBeInstanceOf(Date);
    expect(reviewed.needsHuman).toBe(false);
    expect(reviewed.needsHumanReason).toBeNull();

    const reread = await repo.findById(id);
    expect(reread?.reviewedAt).toBeInstanceOf(Date);
  });

  it("undoes a review without touching anything else", async () => {
    const { repo, id } = await doneTask();
    await new ReviewTaskUseCase(repo).execute(id, true);

    const cleared = await new ReviewTaskUseCase(repo).execute(id, false);
    expect(cleared.status).toBe("done");
    expect(cleared.reviewedAt).toBeNull();
    expect(cleared.completedAt).toBeInstanceOf(Date);
    expect((await repo.findById(id))?.reviewedAt).toBeNull();
  });

  it("rejects marking a task that is not done", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({ title: "not finished", status: "ready" });
    await expect(new ReviewTaskUseCase(repo).execute(task.id, true)).rejects.toThrow(ReviewRequiresDoneError);
    expect((await repo.findById(task.id))?.reviewedAt).toBeNull();
  });

  it("rejects an unknown task", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    await expect(new ReviewTaskUseCase(repo).execute("missing", true)).rejects.toThrow(TaskNotFoundError);
  });

  it("clears the review when the task is reopened out of done", async () => {
    const { repo, id } = await doneTask();
    await new ReviewTaskUseCase(repo).execute(id, true);
    const reopened = await repo.update(id, { status: "in_progress" });
    expect(reopened.reviewedAt).toBeNull();
  });
});
