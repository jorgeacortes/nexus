import { NextResponse } from "next/server";
import { z } from "zod";
import { TaskNotFoundError } from "@/application/tasks/errors";
import { AgentUnreachableError, ResolveTaskUseCase } from "@/application/tasks/resolve-task";
import { agentPrompt, taskRepo } from "@/infrastructure/container";

const resolveSchema = z.object({ message: z.string().nullable().optional() });

/**
 * Resolves a task awaiting human action. Terminal harnesses with a linked pane
 * get an `agent.prompt` back through Herdr; Cursor is cleared by hand.
 */
export async function POST(request: Request, context: RouteContext<"/api/tasks/[id]/resolve">) {
  const { id } = await context.params;
  try {
    const parsed = resolveSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const task = await new ResolveTaskUseCase(taskRepo, agentPrompt).execute(id, parsed.data);
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      return NextResponse.json({ data: null, error: error.message }, { status: 404 });
    }
    if (error instanceof AgentUnreachableError) {
      return NextResponse.json({ data: null, error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { data: null, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
