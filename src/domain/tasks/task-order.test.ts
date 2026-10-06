import { describe, expect, it } from "vitest";

import { compareTasks, DEFAULT_TASK_SORT, sortTasks, type TaskOrderable } from "./task-order";

let nextId = 0;

const task = (overrides: Partial<TaskOrderable> = {}): TaskOrderable => ({
  id: `task-${String(nextId++).padStart(2, "0")}`,
  priority: "normal",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("compareTasks", () => {
  it("defaults to last activity, ignoring priority", () => {
    const fresh = task({ priority: "normal", updatedAt: "2026-10-05T00:00:00.000Z" });
    const staleBlocker = task({ priority: "blocker", updatedAt: "2026-09-01T00:00:00.000Z" });
    expect(DEFAULT_TASK_SORT).toBe("activity");
    expect([staleBlocker, fresh].sort(compareTasks)).toEqual([fresh, staleBlocker]);
  });

  it("breaks an activity tie by priority, blocker first", () => {
    const at = "2026-10-05T00:00:00.000Z";
    const normal = task({ priority: "normal", updatedAt: at });
    const blocker = task({ priority: "blocker", updatedAt: at });
    expect([normal, blocker].sort(compareTasks)).toEqual([blocker, normal]);
  });

  it("sorts by priority first when asked, newest activity second", () => {
    const olderBlocker = task({ priority: "blocker", updatedAt: "2026-09-01T00:00:00.000Z" });
    const newerBlocker = task({ priority: "blocker", updatedAt: "2026-10-05T00:00:00.000Z" });
    const high = task({ priority: "high", updatedAt: "2026-10-06T00:00:00.000Z" });
    expect(sortTasks([high, olderBlocker, newerBlocker], "priority")).toEqual([newerBlocker, olderBlocker, high]);
  });

  it("falls back to the id so identical timestamps stay stable", () => {
    const at = "2026-10-05T00:00:00.000Z";
    const a = task({ id: "aaa", priority: "normal", updatedAt: at });
    const b = task({ id: "bbb", priority: "normal", updatedAt: at });
    expect(compareTasks(a, b)).toBeLessThan(0);
    expect(compareTasks(b, a)).toBeGreaterThan(0);
    expect(compareTasks(a, a)).toBe(0);
  });

  it("accepts Date and ISO-string timestamps alike", () => {
    const asDate = task({ updatedAt: new Date("2026-10-05T00:00:00.000Z") });
    const asString = task({ updatedAt: "2026-10-04T00:00:00.000Z" });
    expect(compareTasks(asDate, asString)).toBeLessThan(0);
  });

  it("treats a missing priority as normal", () => {
    const at = "2026-10-05T00:00:00.000Z";
    const unset = task({ priority: null, updatedAt: at });
    const high = task({ priority: "high", updatedAt: at });
    expect(compareTasks(high, unset)).toBeLessThan(0);
  });
});

describe("sortTasks", () => {
  it("returns a sorted copy and leaves the input alone", () => {
    const older = task({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = task({ updatedAt: "2026-06-01T00:00:00.000Z" });
    const input = [older, newer];
    const sorted = sortTasks(input);
    expect(sorted).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });
});
