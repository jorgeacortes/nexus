import { NextResponse } from "next/server";
import { z } from "zod";

import { DispatchTaskUseCase } from "@/application/tasks/dispatch-task";
import { agentPrompt, liveAgents, projectReference, taskRepo } from "@/infrastructure/container";

import { taskErrorResponse } from "../../_lib/errors";

const dispatchSchema = z.object({
  paneId: z.string().nullable().optional(),
  target: z.literal("auto").nullable().optional(),
});

/**
 * The declarative push: prompt a Herdr pane to work this task. `paneId` wins;
 * `target: "auto"` resolves the idle agent pane inside the project folder.
 */
export async function POST(request: Request, context: RouteContext<"/api/tasks/[id]/dispatch">) {
  const { id } = await context.params;
  try {
    const parsed = dispatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const task = await new DispatchTaskUseCase(taskRepo, projectReference, agentPrompt, liveAgents).execute(
      id,
      parsed.data,
    );
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
