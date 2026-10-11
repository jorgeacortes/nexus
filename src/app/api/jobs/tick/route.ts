import { NextResponse } from "next/server";
import { readJobsTickEnv } from "@/application/jobs/jobs-tick";
import { runDueJobs } from "@/application/jobs/run-due-jobs.usecase";
import { jobRunner } from "@/infrastructure/container";

import { jobFailure } from "../http";

/**
 * One tick, even when `JOBS_ENABLED` is off. That switch stops the compose
 * loop. An explicit tick is the operator asking for a run.
 */
export async function POST() {
  try {
    const env = readJobsTickEnv(process.env);
    const limit = env.ok ? env.config.concurrency : 1;
    const report = await runDueJobs(jobRunner, { now: new Date(), limit });
    return NextResponse.json({ data: report, error: null });
  } catch (error) {
    return jobFailure(error);
  }
}
