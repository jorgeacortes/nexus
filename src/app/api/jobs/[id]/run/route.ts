import { NextResponse } from "next/server";
import { runJobNow } from "@/application/jobs/run-due-jobs.usecase";
import { jobRepo, jobRunner } from "@/infrastructure/container";
import { toJobDto } from "@/lib/dto";

import { jobFailure } from "../../http";

/** Run this job now. A dead job is revived first. A paused job is refused. */
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/run">) {
  const { id } = await context.params;
  try {
    const run = await runJobNow(jobRunner, id, new Date());
    const job = await jobRepo.findById(id);
    return NextResponse.json({ data: { run, job: job ? toJobDto(job) : null }, error: null });
  } catch (error) {
    return jobFailure(error);
  }
}
