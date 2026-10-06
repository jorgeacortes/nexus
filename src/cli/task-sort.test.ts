import { describe, expect, it } from "vitest";

import { compareTasks, DEFAULT_TASK_SORT } from "@/cli/task-sort";
import type { Task } from "@/cli/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "p-nexus",
    title: "ship the board",
    description: null,
    status: "ready",
    priority: "normal",
    assignee: null,
    agentName: null,
    harness: null,
    model: null,
    effort: null,
    herdrPaneId: null,
    needsHuman: false,
    needsHumanReason: null,
    claimedAt: null,
    completedAt: null,
    reviewedAt: null,
    completionNotes: null,
    createdAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
    ...overrides,
  };
}

describe("CLI task ordering", () => {
  it("defaults to last activity, not priority", () => {
    const fresh = task({ id: "b", priority: "normal", updatedAt: "2026-10-05T00:00:00.000Z" });
    const staleBlocker = task({ id: "a", priority: "blocker", updatedAt: "2026-09-01T00:00:00.000Z" });
    expect(DEFAULT_TASK_SORT).toBe("activity");
    expect([staleBlocker, fresh].sort(compareTasks)).toEqual([fresh, staleBlocker]);
  });

  it("uses priority as the activity tiebreak", () => {
    const at = "2026-10-05T00:00:00.000Z";
    const normal = task({ id: "a", priority: "normal", updatedAt: at });
    const blocker = task({ id: "b", priority: "blocker", updatedAt: at });
    expect([normal, blocker].sort(compareTasks)).toEqual([blocker, normal]);
  });

  it("can sort by priority first, newest activity second", () => {
    const olderBlocker = task({ id: "a", priority: "blocker", updatedAt: "2026-09-01T00:00:00.000Z" });
    const newerBlocker = task({ id: "b", priority: "blocker", updatedAt: "2026-10-05T00:00:00.000Z" });
    const high = task({ id: "c", priority: "high", updatedAt: "2026-10-06T00:00:00.000Z" });
    expect([high, olderBlocker, newerBlocker].sort((a, b) => compareTasks(a, b, "priority"))).toEqual([
      newerBlocker,
      olderBlocker,
      high,
    ]);
  });
});
