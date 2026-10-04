import { NextResponse } from "next/server";

import {
  AgentUnreachableError,
  NoEligibleAgentError,
  ProjectReferenceNotFoundError,
  TaskNotFoundError,
} from "@/application/tasks/errors";
import { TaskAlreadyClaimedError, TaskTransitionError, TaskValidationError } from "@/domain/tasks/task";

/**
 * Maps task-context errors to HTTP statuses so every route under `/api/tasks`
 * reports them the same way: 404 missing, 400 invalid input, 409 conflicting
 * state (double claim, invalid transition, unsatisfiable dispatch), 502 when an
 * agent pane cannot be reached.
 */
export function taskErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof TaskNotFoundError) {
    return NextResponse.json({ data: null, error: message }, { status: 404 });
  }
  if (error instanceof TaskValidationError || error instanceof ProjectReferenceNotFoundError) {
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }
  if (
    error instanceof TaskAlreadyClaimedError ||
    error instanceof TaskTransitionError ||
    error instanceof NoEligibleAgentError
  ) {
    return NextResponse.json({ data: null, error: message }, { status: 409 });
  }
  if (error instanceof AgentUnreachableError) {
    return NextResponse.json({ data: null, error: message }, { status: 502 });
  }
  return NextResponse.json({ data: null, error: message }, { status: 500 });
}
