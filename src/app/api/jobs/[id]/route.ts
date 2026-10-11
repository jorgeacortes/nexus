import { NextResponse } from "next/server";
import { z } from "zod";

import { editJob, pauseManagedJob, removeJob, resumeManagedJob } from "@/application/jobs/manage-job";
import { TARGET_MODES } from "@/domain/jobs/job";
import { jobRepo, projectReference } from "@/infrastructure/container";
import { toJobDto } from "@/lib/dto";

import { jobFailure, jobJson, zodMessage } from "../http";

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    schedule: z.string().nullable().optional(),
    intervalSeconds: z.number().int().positive().nullable().optional(),
    timezone: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    targetPaneId: z.string().nullable().optional(),
    targetMode: z.enum(TARGET_MODES).optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    timeoutSeconds: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    action: z.enum(["pause", "resume", "remove"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Pass a field to edit, or action pause, resume, or remove.",
  });

const deps = { jobs: jobRepo, projects: projectReference };

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  try {
    const job = await jobRepo.findById(id);
    if (!job) {
      return NextResponse.json({ data: null, error: `Job ${id} not found.` }, { status: 404 });
    }
    return NextResponse.json({ data: toJobDto(job), error: null });
  } catch (error) {
    return jobFailure(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ data: null, error: zodMessage(parsed.error) }, { status: 400 });
    }
    const { action, ...fields } = parsed.data;
    if (action === "remove") {
      await removeJob(deps, id);
      return NextResponse.json({ data: { id }, error: null });
    }
    if (action === "pause") {
      return jobJson(await pauseManagedJob(deps, id));
    }
    if (action === "resume") {
      return jobJson(await resumeManagedJob(deps, id));
    }
    return jobJson(await editJob(deps, id, fields));
  } catch (error) {
    return jobFailure(error);
  }
}
