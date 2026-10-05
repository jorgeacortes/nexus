import type { ProjectDto, TaskDto } from "@/lib/dto";

/**
 * The project filter narrows the one board in place — it never becomes a second
 * board, and the card's project tag stays the single source of truth. The
 * selection lives in `?project=` (not component state) so a narrowed board
 * survives a refresh and can be shared; `BoardClient` writes it with
 * `replaceState`, keeping the History stack clean while clicking through
 * projects.
 */
export const BOARD_PROJECT_PARAM = "project";

/** Filter key for tasks with no project, so the triage bucket is selectable too. */
export const NO_PROJECT_KEY = "none";

/** `null` = every project (the default); otherwise a project id or `NO_PROJECT_KEY`. */
export type ProjectFilter = string | null;

/** Reads `?project=`; an unknown value falls back to "all" rather than hiding everything. */
export function parseProjectFilter(raw: string | null, projects: ProjectDto[]): ProjectFilter {
  if (raw === null || raw === "" || raw === "all") return null;
  if (raw === NO_PROJECT_KEY) return NO_PROJECT_KEY;
  return projects.some((project) => project.id === raw) ? raw : null;
}

/** The filter key a task belongs to: its project id, or the no-project bucket. */
export function projectFilterKey(task: TaskDto): string {
  return task.projectId ?? NO_PROJECT_KEY;
}

/**
 * The "needs review" filter is a second, independent narrowing of the same
 * board: done tasks the operator has not personally verified yet. Like the
 * project filter it lives in the URL (`?review=needs-review`) so the queue
 * survives a refresh and can be shared.
 */
export const BOARD_REVIEW_PARAM = "review";

/** Filter key for the unreviewed queue. */
export const NEEDS_REVIEW_KEY = "needs-review";

/** `null` = every done task (the default); otherwise the needs-review queue. */
export type ReviewFilter = typeof NEEDS_REVIEW_KEY | null;

/** Reads `?review=`; any value other than the known key falls back to "all". */
export function parseReviewFilter(raw: string | null): ReviewFilter {
  return raw === NEEDS_REVIEW_KEY ? NEEDS_REVIEW_KEY : null;
}

/** A reviewed task is `done` with a `reviewedAt`; the queue is done without one. */
export function needsReview(task: TaskDto): boolean {
  return task.status === "done" && task.reviewedAt === null;
}

export function matchesReviewFilter(task: TaskDto, filter: ReviewFilter): boolean {
  return filter === null || needsReview(task);
}

/** How many tasks the needs-review filter would show, over every task. */
export function needsReviewCount(tasks: TaskDto[]): number {
  return tasks.filter(needsReview).length;
}

export function matchesProjectFilter(task: TaskDto, filter: ProjectFilter): boolean {
  return filter === null || projectFilterKey(task) === filter;
}

/**
 * Task counts per project (plus the no-project bucket) over *every* task, so a
 * filtered board still shows how much it is hiding.
 */
export function projectFilterCounts(tasks: TaskDto[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = projectFilterKey(task);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Builds the board URL for a project filter, preserving any unrelated query params. */
export function hrefWithProjectFilter(pathname: string, filter: ProjectFilter, current: URLSearchParams): string {
  const params = new URLSearchParams(current.toString());
  if (filter === null) {
    params.delete(BOARD_PROJECT_PARAM);
  } else {
    params.set(BOARD_PROJECT_PARAM, filter);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Builds the board URL for the needs-review filter, preserving any unrelated query params. */
export function hrefWithReviewFilter(pathname: string, filter: ReviewFilter, current: URLSearchParams): string {
  const params = new URLSearchParams(current.toString());
  if (filter === null) {
    params.delete(BOARD_REVIEW_PARAM);
  } else {
    params.set(BOARD_REVIEW_PARAM, filter);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
