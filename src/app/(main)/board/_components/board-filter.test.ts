import { describe, expect, it } from "vitest";

import type { ProjectDto, TaskDto } from "@/lib/dto";

import {
  BOARD_PROJECT_PARAM,
  BOARD_REVIEW_PARAM,
  BOARD_SORT_PARAM,
  hrefWithProjectFilter,
  hrefWithReviewFilter,
  hrefWithSortFilter,
  matchesProjectFilter,
  matchesReviewFilter,
  NEEDS_REVIEW_KEY,
  NO_PROJECT_KEY,
  needsReviewCount,
  parseBoardSort,
  parseProjectFilter,
  parseReviewFilter,
  projectFilterCounts,
  projectFilterKey,
} from "./board-filter";

const project = (id: string, name = id): ProjectDto => ({
  id,
  name,
  folderPath: null,
  herdrWorkspaceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

let nextId = 0;

const task = (overrides: Partial<TaskDto> = {}): TaskDto => ({
  id: `task-${nextId++}`,
  projectId: null,
  title: "A task",
  description: null,
  status: "backlog",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const PROJECTS = [project("p1", "Alpha"), project("p2", "Beta")];

describe("parseProjectFilter", () => {
  it("treats a missing, empty or 'all' value as every project", () => {
    expect(parseProjectFilter(null, PROJECTS)).toBeNull();
    expect(parseProjectFilter("", PROJECTS)).toBeNull();
    expect(parseProjectFilter("all", PROJECTS)).toBeNull();
  });

  it("keeps a known project id and the no-project bucket", () => {
    expect(parseProjectFilter("p2", PROJECTS)).toBe("p2");
    expect(parseProjectFilter(NO_PROJECT_KEY, PROJECTS)).toBe(NO_PROJECT_KEY);
  });

  it("falls back to every project when the id is unknown", () => {
    expect(parseProjectFilter("deleted-project", PROJECTS)).toBeNull();
  });
});

describe("matchesProjectFilter", () => {
  const alpha = task({ projectId: "p1" });
  const loose = task({ projectId: null });

  it("matches everything when no filter is set", () => {
    expect(matchesProjectFilter(alpha, null)).toBe(true);
    expect(matchesProjectFilter(loose, null)).toBe(true);
  });

  it("matches only the selected project, and never the no-project bucket by accident", () => {
    expect(matchesProjectFilter(alpha, "p1")).toBe(true);
    expect(matchesProjectFilter(loose, "p1")).toBe(false);
    expect(matchesProjectFilter(loose, NO_PROJECT_KEY)).toBe(true);
  });

  it("uses the project id, not the name, as the filter key", () => {
    expect(projectFilterKey(alpha)).toBe("p1");
    expect(projectFilterKey(loose)).toBe(NO_PROJECT_KEY);
  });
});

describe("projectFilterCounts", () => {
  it("counts every task, including the no-project bucket", () => {
    const counts = projectFilterCounts([
      task({ projectId: "p1" }),
      task({ projectId: "p1" }),
      task({ projectId: "p2" }),
      task({ projectId: null }),
    ]);
    expect(counts.get("p1")).toBe(2);
    expect(counts.get("p2")).toBe(1);
    expect(counts.get(NO_PROJECT_KEY)).toBe(1);
    expect(counts.get("never-used")).toBeUndefined();
  });
});

describe("review filter", () => {
  it("parses only the known needs-review key", () => {
    expect(parseReviewFilter(NEEDS_REVIEW_KEY)).toBe(NEEDS_REVIEW_KEY);
    expect(parseReviewFilter(null)).toBeNull();
    expect(parseReviewFilter("reviewed")).toBeNull();
  });

  it("matches done tasks that have no reviewedAt", () => {
    const unreviewed = task({ status: "done", reviewedAt: null });
    const reviewed = task({ status: "done", reviewedAt: "2026-10-04T08:00:00.000Z" });
    const ready = task({ status: "ready" });

    expect(matchesReviewFilter(unreviewed, null)).toBe(true);
    expect(matchesReviewFilter(reviewed, null)).toBe(true);
    expect(matchesReviewFilter(unreviewed, NEEDS_REVIEW_KEY)).toBe(true);
    expect(matchesReviewFilter(reviewed, NEEDS_REVIEW_KEY)).toBe(false);
    expect(matchesReviewFilter(ready, NEEDS_REVIEW_KEY)).toBe(false);
  });

  it("counts the unreviewed queue over every task", () => {
    const count = needsReviewCount([
      task({ status: "done" }),
      task({ status: "done", reviewedAt: "2026-10-04T08:00:00.000Z" }),
      task({ status: "in_progress" }),
    ]);
    expect(count).toBe(1);
  });

  it("writes and clears the review param, preserving unrelated params", () => {
    expect(hrefWithReviewFilter("/board", NEEDS_REVIEW_KEY, new URLSearchParams())).toBe(
      `/board?${BOARD_REVIEW_PARAM}=${NEEDS_REVIEW_KEY}`,
    );
    const current = new URLSearchParams(`${BOARD_REVIEW_PARAM}=${NEEDS_REVIEW_KEY}&project=p1`);
    expect(hrefWithReviewFilter("/board", null, current)).toBe("/board?project=p1");
  });
});

describe("sort order", () => {
  it("defaults to last activity and only accepts the known priority key", () => {
    expect(parseBoardSort(null)).toBe("activity");
    expect(parseBoardSort("")).toBe("activity");
    expect(parseBoardSort("priority")).toBe("priority");
    expect(parseBoardSort("newest")).toBe("activity");
  });

  it("writes priority to the URL and drops the default", () => {
    expect(hrefWithSortFilter("/board", "priority", new URLSearchParams())).toBe(`/board?${BOARD_SORT_PARAM}=priority`);
    expect(hrefWithSortFilter("/board", "activity", new URLSearchParams())).toBe("/board");
  });

  it("preserves unrelated params and clears a stale sort", () => {
    const current = new URLSearchParams(`${BOARD_SORT_PARAM}=priority&project=p1`);
    expect(hrefWithSortFilter("/board", "activity", current)).toBe("/board?project=p1");
    expect(hrefWithSortFilter("/board", "priority", current)).toBe("/board?sort=priority&project=p1");
  });
});

describe("hrefWithProjectFilter", () => {
  it("adds the project parameter", () => {
    expect(hrefWithProjectFilter("/board", "p1", new URLSearchParams())).toBe(`/board?${BOARD_PROJECT_PARAM}=p1`);
  });

  it("drops the parameter for 'all' and preserves unrelated params", () => {
    const current = new URLSearchParams(`${BOARD_PROJECT_PARAM}=p1&view=compact`);
    expect(hrefWithProjectFilter("/board", null, current)).toBe("/board?view=compact");
    expect(hrefWithProjectFilter("/board", "p2", current)).toBe("/board?project=p2&view=compact");
  });

  it("returns a bare path when nothing is left in the query", () => {
    expect(hrefWithProjectFilter("/board", null, new URLSearchParams())).toBe("/board");
  });
});
