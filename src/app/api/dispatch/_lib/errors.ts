import { NextResponse } from "next/server";

import { MissingProjectFolderError } from "@/application/dispatch/errors";
import { ProjectReferenceNotFoundError, TaskNotFoundError } from "@/application/tasks/errors";
import {
  DispatchLeaseHeldError,
  DispatchNotDispatchableError,
  DispatchRequiresProjectError,
  DispatchSpawnError,
} from "@/domain/dispatch/dispatch";
import { TaskTransitionError, TaskValidationError } from "@/domain/tasks/task";

/**
 * Maps dispatch-context errors to HTTP statuses so `nx dispatch` reports them
 * like every other task command: 404 missing, 400 unusable input, 409 a held
 * lease or a forbidden status, 502 when a spawn failed after touching Herdr (the
 * message names the orphan tab).
 */
export function dispatchErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof TaskNotFoundError) {
    return NextResponse.json({ data: null, error: message }, { status: 404 });
  }
  if (
    error instanceof TaskValidationError ||
    error instanceof ProjectReferenceNotFoundError ||
    error instanceof DispatchRequiresProjectError ||
    error instanceof MissingProjectFolderError
  ) {
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }
  if (
    error instanceof DispatchLeaseHeldError ||
    error instanceof DispatchNotDispatchableError ||
    error instanceof TaskTransitionError
  ) {
    return NextResponse.json({ data: null, error: message }, { status: 409 });
  }
  if (error instanceof DispatchSpawnError) {
    return NextResponse.json({ data: null, error: message }, { status: 502 });
  }
  return NextResponse.json({ data: null, error: message }, { status: 500 });
}
