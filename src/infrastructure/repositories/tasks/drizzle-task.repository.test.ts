import { beforeEach, describe, expect, it } from "vitest";

import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { DrizzleProjectRepository } from "@/infrastructure/repositories/projects/drizzle-project.repository";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

describe("DrizzleTaskRepository", () => {
  let db: NexusDb;
  let repo: DrizzleTaskRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new DrizzleTaskRepository(db);
  });

  it("round-trips a task with an agent assignment", async () => {
    const saved = await repo.save({
      title: "implement TAVILY support",
      description: "wire the search provider",
      assignee: "agent",
      agentName: "pi-1",
      harness: "pi",
      model: "gpt-5.6-luna",
      effort: "xhigh",
      herdrPaneId: "wR:p1",
    });

    const found = await repo.findById(saved.id);
    expect(found).not.toBeNull();
    expect(found?.title).toBe("implement TAVILY support");
    expect(found?.assignee).toBe("agent");
    expect(found?.harness).toBe("pi");
    expect(found?.model).toBe("gpt-5.6-luna");
    expect(found?.effort).toBe("xhigh");
    expect(found?.herdrPaneId).toBe("wR:p1");
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("finds a task by its Herdr pane id", async () => {
    await repo.save({ title: "linked", assignee: "agent", herdrPaneId: "wP:p4" });
    const found = await repo.findByHerdrPaneId("wP:p4");
    expect(found?.title).toBe("linked");
    expect(await repo.findByHerdrPaneId("nope")).toBeNull();
  });

  it("filters by project and flags", async () => {
    await repo.save({ title: "a", projectId: "p1" });
    await repo.save({ title: "b", projectId: "p1", needsHuman: true, needsHumanReason: "review" });
    await repo.save({ title: "c" });

    const byProject = await repo.findByProjectId("p1");
    expect(byProject.map((task) => task.title).sort()).toEqual(["a", "b"]);

    const flagged = (await repo.findAll()).filter((task) => task.needsHuman);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.needsHumanReason).toBe("review");
  });

  it("updates status and assignment, then deletes", async () => {
    const saved = await repo.save({ title: "move me" });
    const moved = await repo.update(saved.id, { status: "in_progress" });
    expect(moved.status).toBe("in_progress");

    const assigned = await repo.update(saved.id, { assignee: "me" });
    expect(assigned.assignee).toBe("me");

    await repo.delete(saved.id);
    expect(await repo.findById(saved.id)).toBeNull();
  });

  it("rejects an invalid (model, effort) pair at the repository boundary", async () => {
    await expect(repo.save({ title: "bad", assignee: "agent", model: "gpt-5.6-luna", effort: "max" })).rejects.toThrow(
      /not valid/,
    );
  });
});

describe("DrizzleProjectRepository", () => {
  it("round-trips a project", async () => {
    const db = createTestDb();
    const repo = new DrizzleProjectRepository(db);
    const saved = await repo.save({ name: "crm development", folderPath: "~/ws/biznagatec-crm" });
    const found = await repo.findById(saved.id);
    expect(found?.folderPath).toBe("~/ws/biznagatec-crm");

    const updated = await repo.update(saved.id, { name: "CRM" });
    expect(updated.name).toBe("CRM");
    expect(await repo.findAll()).toHaveLength(1);

    await repo.delete(saved.id);
    expect(await repo.findById(saved.id)).toBeNull();
  });
});
