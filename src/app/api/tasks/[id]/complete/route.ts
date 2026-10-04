import { NextResponse } from "next/server";
import { z } from "zod";

import { CompleteTaskUseCase } from "@/application/tasks/complete-task";
import { taskRepo } from "@/infrastructure/container";

import { taskErrorResponse } from "../../_lib/errors";

const completeSchema = z.object({ notes: z.string().nullable().optional() });

/** Completes a task: `in_progress` → `done` (`blocked` force-closes it). */
export async function POST(request: Request, context: RouteContext<"/api/tasks/[id]/complete">) {
  const { id } = await context.params;
  try {
    const parsed = completeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const task = await new CompleteTaskUseCase(taskRepo).execute(id, parsed.data);
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
