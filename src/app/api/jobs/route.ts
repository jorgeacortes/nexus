import { NextResponse } from "next/server";
import { z } from "zod";

import { createJob, listJobs } from "@/application/jobs/manage-job";
import { JOB_KINDS, JOB_PREDICATES, TARGET_MODES } from "@/domain/jobs/job";
import { jobRepo, projectReference } from "@/infrastructure/container";
import { toJobDto } from "@/lib/dto";

import { jobFailure, jobJson, zodMessage } from "./http";

const createSchema = z.object({
  name: z.string().min(1, "A job needs a name."),
  prompt: z.string().min(1, "A job needs a prompt."),
  kind: z.enum(JOB_KINDS).optional(),
  predicate: z.enum(JOB_PREDICATES).nullable().optional(),
  dailyRunCap: z.number().int().positive().nullable().optional(),
  schedule: z.string().nullable().optional(),
  intervalSeconds: z.number().int().positive().nullable().optional(),
  timezone: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  targetPaneId: z.string().nullable().optional(),
  targetMode: z.enum(TARGET_MODES).optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  timeoutSeconds: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
});

const deps = { jobs: jobRepo, projects: projectReference };

export async function GET() {
  try {
    const jobs = await listJobs(deps);
    return NextResponse.json({ data: jobs.map(toJobDto), error: null });
  } catch (error) {
    return jobFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ data: null, error: zodMessage(parsed.error) }, { status: 400 });
    }
    const job = await createJob(deps, parsed.data);
    return jobJson(job, 201);
  } catch (error) {
    return jobFailure(error);
  }
}
