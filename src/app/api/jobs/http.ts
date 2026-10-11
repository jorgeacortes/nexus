import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { JobNotFoundError, JobNotRunnableError } from "@/application/jobs/run-due-jobs.usecase";
import type { Job } from "@/domain/jobs/job";
import { JobTransitionError, JobValidationError } from "@/domain/jobs/job";
import { toJobDto } from "@/lib/dto";

export function jobJson(job: Job, status = 200) {
  return NextResponse.json({ data: toJobDto(job), error: null }, { status });
}

export function jobFailure(error: unknown) {
  if (error instanceof JobNotFoundError) {
    return NextResponse.json({ data: null, error: error.message }, { status: 404 });
  }
  if (
    error instanceof JobValidationError ||
    error instanceof JobTransitionError ||
    error instanceof JobNotRunnableError
  ) {
    return NextResponse.json({ data: null, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ data: null, error: message }, { status: 500 });
}

export function zodMessage(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join(", ");
}
