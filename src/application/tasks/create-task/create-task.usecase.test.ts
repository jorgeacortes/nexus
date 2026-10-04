import { describe, expect, it } from "vitest";

import { CreateTaskUseCase } from "@/application/tasks/create-task";
import { ProjectReferenceNotFoundError } from "@/application/tasks/errors";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

function projectsWith(ids: string[]): ProjectReferencePort {
  return {
    exists: async (id) => ids.includes(id),
    find: async (id) => (ids.includes(id) ? { id, name: id, folderPath: null } : null),
  };
}

describe("CreateTaskUseCase", () => {
  it("saves a task when the project exists", async () => {
    const tasks = new DrizzleTaskRepository(createTestDb());
    const task = await new CreateTaskUseCase(tasks, projectsWith(["p1"])).execute({
      title: "do the thing",
      projectId: "p1",
    });
    expect(task.projectId).toBe("p1");
    expect(await tasks.findById(task.id)).not.toBeNull();
  });

  it("rejects an unknown project id", async () => {
    const tasks = new DrizzleTaskRepository(createTestDb());
    await expect(
      new CreateTaskUseCase(tasks, projectsWith([])).execute({ title: "orphan", projectId: "missing" }),
    ).rejects.toThrow(ProjectReferenceNotFoundError);
  });
});
