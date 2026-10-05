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
    await expect(repo.save({ title: "bad", assignee: "agent", model: "grok-4.6", effort: "max" })).rejects.toThrow(
      /not valid/,
    );
  });

  it("persists claim and completion transitions", async () => {
    const saved = await repo.save({ title: "flow" });
    const claimed = await repo.claim(saved.id, { paneId: "wR:p1", agentName: "pi" });
    expect(claimed.status).toBe("in_progress");
    expect(claimed.claimedAt).toBeInstanceOf(Date);

    const reread = await repo.findById(saved.id);
    expect(reread?.herdrPaneId).toBe("wR:p1");
    expect(reread?.claimedAt).toBeInstanceOf(Date);

    await expect(repo.claim(saved.id, { paneId: "wP:p4" })).rejects.toThrow(/already claimed/);

    const done = await repo.complete(saved.id, { notes: "PR #7" });
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.completionNotes).toBe("PR #7");
  });

  it("round-trips reviewedAt and clears it when the task leaves done", async () => {
    const saved = await repo.save({ title: "review me" });
    await repo.claim(saved.id, { paneId: "wR:p1" });
    await repo.complete(saved.id, {});

    const reviewedAt = new Date("2026-10-04T08:00:00.000Z");
    const reviewed = await repo.update(saved.id, { reviewedAt });
    expect(reviewed.reviewedAt?.toISOString()).toBe(reviewedAt.toISOString());

    const reread = await repo.findById(saved.id);
    expect(reread?.reviewedAt?.toISOString()).toBe(reviewedAt.toISOString());

    const moved = await repo.update(saved.id, { status: "in_progress" });
    expect(moved.reviewedAt).toBeNull();
    expect((await repo.findById(saved.id))?.reviewedAt).toBeNull();
  });

  it("persists priority on save and update", async () => {
    const saved = await repo.save({ title: "prio", priority: "blocker" });
    expect(saved.priority).toBe("blocker");

    const reread = await repo.findById(saved.id);
    expect(reread?.priority).toBe("blocker");

    const updated = await repo.update(saved.id, { priority: "high" });
    expect(updated.priority).toBe("high");

    const rereadUpdated = await repo.findById(saved.id);
    expect(rereadUpdated?.priority).toBe("high");
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
