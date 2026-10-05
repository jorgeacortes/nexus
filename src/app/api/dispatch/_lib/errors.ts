import { NextResponse } from "next/server";

import { MissingProjectFolderError, TabNotFoundError } from "@/application/dispatch/errors";
import { ProjectReferenceNotFoundError, TaskNotFoundError } from "@/application/tasks/errors";
import { TabCloseRefusedError } from "@/domain/dispatch/close-guard";
import {
  DispatchLeaseHeldError,
  DispatchNotDispatchableError,
  DispatchRequiresProjectError,
  DispatchSpawnError,
} from "@/domain/dispatch/dispatch";
import { TaskTransitionError, TaskValidationError } from "@/domain/tasks/task";

/**
 * Maps dispatch-context errors to HTTP statuses so `nx dispatch` reports them
 * like every other task command: 404 missing (task or tab), 400 unusable input,
 * 409 a held lease, a forbidden status or a **refused close** (the tab is still
 * open), 502 when a spawn failed after touching Herdr (the message names the
 * orphan tab).
 */
export function dispatchErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof TaskNotFoundError || error instanceof TabNotFoundError) {
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
    error instanceof TabCloseRefusedError ||
    error instanceof TaskTransitionError
  ) {
    return NextResponse.json({ data: null, error: message }, { status: 409 });
  }
  if (error instanceof DispatchSpawnError) {
    return NextResponse.json({ data: null, error: message }, { status: 502 });
  }
  return NextResponse.json({ data: null, error: message }, { status: 500 });
}
