import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ArchiveTasksUseCase } from "@/application/tasks/archive-tasks";
import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import type { Clock } from "@/application/tasks/clock";
import { ListTasksUseCase } from "@/application/tasks/list-tasks";
import { UnarchiveTaskUseCase } from "@/application/tasks/unarchive-task";
import { ARCHIVE_AFTER_MS } from "@/domain/tasks/archive";
import type { LiveAgentPort } from "@/domain/tasks/live-agents";
import { TaskTransitionError } from "@/domain/tasks/task";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { tasks } from "@/infrastructure/db/nexus/schema";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const clock: Clock = { now: () => NOW };
const noAgents: LiveAgentPort = { list: async () => [] };

function age(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function finish(repo: DrizzleTaskRepository, title: string, projectId: string | null = "p1"): Promise<string> {
  const saved = await repo.save({
    title,
    projectId,
    status: "ready",
    assignee: "agent",
    agentName: "cursor",
    harness: "cursor",
    model: "grok-4.7",
    effort: "high",
  });
  await repo.claim(saved.id, { paneId: "wR:p1" });
  await repo.complete(saved.id, { notes: `${title} notes` });
  return saved.id;
}

function setCompletedAt(db: NexusDb, id: string, completedAt: Date): void {
  db.update(tasks).set({ completedAt: completedAt.toISOString() }).where(eq(tasks.id, id)).run();
}

describe("ArchiveTasksUseCase", () => {
  it("archives a task completed 8 days ago and leaves a 6-day task on the board", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const oldId = await finish(repo, "old");
    const recentId = await finish(repo, "recent");
    setCompletedAt(db, oldId, age(8));
    setCompletedAt(db, recentId, age(6));

    const result = await new ArchiveTasksUseCase(repo, clock).execute();

    expect(result.archived.map((task) => task.id)).toEqual([oldId]);
    expect(result.archived[0]?.archivedAt).toEqual(NOW);
    expect(result.archived[0]?.completionNotes).toBe("old notes");

    const listed = await new ListTasksUseCase(repo, new ArchiveTasksUseCase(repo, clock)).execute();
    expect(listed.map((task) => task.id)).toEqual([recentId]);
    expect((await repo.findById(recentId))?.archivedAt).toBeNull();
    expect((await repo.findArchived()).map((task) => task.id)).toEqual([oldId]);
  });

  it("does not archive a task completed exactly 7 days ago", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const id = await finish(repo, "boundary");
    setCompletedAt(db, id, new Date(NOW.getTime() - ARCHIVE_AFTER_MS));

    const result = await new ArchiveTasksUseCase(repo, clock).execute();

    expect(result.archived).toEqual([]);
    expect((await repo.findById(id))?.archivedAt).toBeNull();
  });

  it("does not archive a reopened task, even with a stale completedAt", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const id = await finish(repo, "reopened");
    setCompletedAt(db, id, age(30));
    const reopened = await repo.update(id, { status: "ready" });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.archivedAt).toBeNull();

    // A row that skipped the domain and kept the old completion stamp still
    // must not archive while its status is not done.
    db.update(tasks)
      .set({ status: "ready", completedAt: age(30).toISOString(), archivedAt: null })
      .where(eq(tasks.id, id))
      .run();

    const result = await new ArchiveTasksUseCase(repo, clock).execute();
    expect(result.archived).toEqual([]);
    expect((await repo.findById(id))?.archivedAt).toBeNull();
    expect((await repo.findAll()).map((task) => task.id)).toContain(id);
  });

  it("does not re-archive a task that was unarchived", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const id = await finish(repo, "bring back");
    setCompletedAt(db, id, age(30));
    await new ArchiveTasksUseCase(repo, clock).execute();

    const restored = await new UnarchiveTaskUseCase(repo, clock).execute(id);
    expect(restored.status).toBe("ready");
    expect(restored.archivedAt).toBeNull();
    expect(restored.completedAt).toBeNull();

    const again = await new ArchiveTasksUseCase(repo, clock).execute();
    expect(again.archived).toEqual([]);
    expect((await repo.findById(id))?.status).toBe("ready");
    expect(await repo.findArchived()).toEqual([]);
    expect((await repo.findAll()).map((task) => task.id)).toContain(id);
  });

  it("leaves archived tasks out of the default list and out of per-project lists", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const oldId = await finish(repo, "counted out", "p1");
    const recentId = await finish(repo, "still here", "p1");
    const otherId = await finish(repo, "other project", "p2");
    setCompletedAt(db, oldId, age(8));
    setCompletedAt(db, recentId, age(2));
    setCompletedAt(db, otherId, age(1));

    const listed = await new ListTasksUseCase(repo, new ArchiveTasksUseCase(repo, clock)).execute();

    expect(listed.map((task) => task.id).sort()).toEqual([otherId, recentId].sort());
    expect((await repo.findByProjectId("p1")).map((task) => task.id)).toEqual([recentId]);
    expect((await repo.findAll()).some((task) => task.id === oldId)).toBe(false);

    const archivedOnly = await new ListTasksUseCase(repo, new ArchiveTasksUseCase(repo, clock)).execute({
      archived: "only",
    });
    expect(archivedOnly.map((task) => task.id)).toEqual([oldId]);
  });

  it("rejects a claim of an archived task", async () => {
    const db = createTestDb();
    const repo = new DrizzleTaskRepository(db);
    const id = await finish(repo, "do not claim");
    setCompletedAt(db, id, age(8));
    await new ArchiveTasksUseCase(repo, clock).execute();

    await expect(new ClaimTaskUseCase(repo, noAgents).execute(id, { paneId: "wR:p2" })).rejects.toThrow(
      TaskTransitionError,
    );
    await expect(new ClaimTaskUseCase(repo, noAgents).execute(id, { paneId: "wR:p2" })).rejects.toThrow(
      /archived and cannot be claimed/,
    );
    expect((await repo.findById(id))?.status).toBe("done");
    expect((await repo.findById(id))?.archivedAt).toEqual(NOW);
  });
});
