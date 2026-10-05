export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task ${id} not found.`);
    this.name = "TaskNotFoundError";
  }
}

/**
 * Raised when a task is marked reviewed before it is `done`. "Agent finished"
 * (`done`) and "operator verified" (`reviewedAt`) are independent facts, and a
 * review is only meaningful on a finished task.
 */
export class ReviewRequiresDoneError extends Error {
  constructor(status: string) {
    super(`Only a done task can be marked reviewed (this task is "${status}").`);
    this.name = "ReviewRequiresDoneError";
  }
}

export class ProjectReferenceNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} does not exist.`);
    this.name = "ProjectReferenceNotFoundError";
  }
}

/** Raised when an agent pane cannot be reached over the Herdr socket. */
export class AgentUnreachableError extends Error {
  constructor(paneId: string, cause: unknown) {
    super(`Could not reach the agent on pane ${paneId}: ${cause instanceof Error ? cause.message : "unknown error"}`);
    this.name = "AgentUnreachableError";
  }
}

/**
 * Raised when `assign --to auto` cannot find an idle agent whose cwd sits inside
 * the task's project folder. Dispatch never silently crosses projects.
 */
export class NoEligibleAgentError extends Error {
  constructor(detail: string) {
    super(`No idle agent available for auto-dispatch: ${detail}`);
    this.name = "NoEligibleAgentError";
  }
}
