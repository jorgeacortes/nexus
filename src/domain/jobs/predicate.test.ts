import { describe, expect, it } from "vitest";

import { hasStaleReadyTask, type ReadyTaskFact } from "@/domain/jobs/predicate";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const STALE = new Date("2026-10-10T11:00:00.000Z");
const FRESH = new Date("2026-10-11T11:00:00.000Z");

function task(overrides: Partial<ReadyTaskFact> = {}): ReadyTaskFact {
  return {
    status: "ready",
    claimedAt: null,
    archivedAt: null,
    updatedAt: STALE,
    ...overrides,
  };
}

describe("hasStaleReadyTask", () => {
  it("is true for an unclaimed ready task older than a day", () => {
    expect(hasStaleReadyTask([task()], NOW)).toBe(true);
  });

  it("ignores fresh, claimed, archived, and non-ready tasks", () => {
    expect(hasStaleReadyTask([task({ updatedAt: FRESH })], NOW)).toBe(false);
    expect(hasStaleReadyTask([task({ claimedAt: NOW })], NOW)).toBe(false);
    expect(hasStaleReadyTask([task({ archivedAt: NOW })], NOW)).toBe(false);
    expect(hasStaleReadyTask([task({ status: "backlog" })], NOW)).toBe(false);
  });
});
