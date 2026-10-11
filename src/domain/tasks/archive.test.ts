import { describe, expect, it } from "vitest";

import { ARCHIVE_AFTER_MS, archiveTask, isArchiveEligible, unarchiveTask } from "@/domain/tasks/archive";
import { claimTask, completeTask, createTask, type Task, TaskTransitionError } from "@/domain/tasks/task";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function doneTask(completedAt: Date, overrides: Partial<Task> = {}): Task {
  const created = completeTask(claimTask(createTask({ title: "finished work", status: "ready" }), { paneId: "wR:p1" }));
  return { ...created, completedAt, archivedAt: null, ...overrides };
}

describe("archive eligibility", () => {
  it("names the interval once, as 7 days", () => {
    expect(ARCHIVE_AFTER_MS).toBe(7 * DAY_MS);
  });

  it("archives a task completed 8 days ago", () => {
    const task = doneTask(new Date(NOW.getTime() - 8 * DAY_MS));
    expect(isArchiveEligible(task, NOW)).toBe(true);
    const archived = archiveTask(task, NOW);
    expect(archived.status).toBe("done");
    expect(archived.archivedAt).toEqual(NOW);
    expect(archived.completedAt).toEqual(task.completedAt);
    expect(archived.completionNotes).toBe(task.completionNotes);
  });

  it("does not archive a task completed 6 days ago", () => {
    const task = doneTask(new Date(NOW.getTime() - 6 * DAY_MS));
    expect(isArchiveEligible(task, NOW)).toBe(false);
    expect(() => archiveTask(task, NOW)).toThrow(TaskTransitionError);
  });

  it("does not archive a task completed exactly 7 days ago", () => {
    const task = doneTask(new Date(NOW.getTime() - ARCHIVE_AFTER_MS));
    expect(isArchiveEligible(task, NOW)).toBe(false);
  });

  it("does not archive a reopened task that still has a stale completedAt", () => {
    const reopened = doneTask(new Date(NOW.getTime() - 30 * DAY_MS), { status: "ready" });
    expect(reopened.completedAt).not.toBeNull();
    expect(isArchiveEligible(reopened, NOW)).toBe(false);
  });

  it("does not archive a task that is already archived", () => {
    const task = doneTask(new Date(NOW.getTime() - 30 * DAY_MS), { archivedAt: new Date(NOW.getTime() - DAY_MS) });
    expect(isArchiveEligible(task, NOW)).toBe(false);
  });
});

describe("unarchiveTask", () => {
  it("returns the task to ready and is not eligible for the next sweep", () => {
    const archived = archiveTask(doneTask(new Date(NOW.getTime() - 30 * DAY_MS)), NOW);
    const restored = unarchiveTask(archived, NOW);

    expect(restored.status).toBe("ready");
    expect(restored.archivedAt).toBeNull();
    expect(restored.completedAt).toBeNull();
    expect(restored.reviewedAt).toBeNull();
    expect(restored.title).toBe(archived.title);
    expect(restored.completionNotes).toBe(archived.completionNotes);
    expect(isArchiveEligible(restored, new Date(NOW.getTime() + 365 * DAY_MS))).toBe(false);
  });

  it("rejects a task that is not archived", () => {
    const task = doneTask(new Date(NOW.getTime() - DAY_MS));
    expect(() => unarchiveTask(task, NOW)).toThrow(TaskTransitionError);
  });
});
