import { NextResponse } from "next/server";
import { z } from "zod";
import { AssignTaskUseCase } from "@/application/tasks/assign-task";
import { DeleteTaskUseCase } from "@/application/tasks/delete-task";
import { ProjectReferenceNotFoundError, ReviewRequiresDoneError, TaskNotFoundError } from "@/application/tasks/errors";
import { FlagNeedsHumanUseCase } from "@/application/tasks/flag-needs-human";
import { MoveTaskUseCase } from "@/application/tasks/move-task";
import { ReviewTaskUseCase } from "@/application/tasks/review-task";
import { UpdateTaskUseCase } from "@/application/tasks/update-task";
import {
  ASSIGNEE_TYPES,
  HARNESSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  TaskValidationError,
} from "@/domain/tasks/task";
import { projectReference, taskRepo } from "@/infrastructure/container";

const patchTaskSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee: z.enum(ASSIGNEE_TYPES).nullable().optional(),
  agentName: z.string().nullable().optional(),
  harness: z.enum(HARNESSES).nullable().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  herdrPaneId: z.string().nullable().optional(),
  needsHuman: z.boolean().optional(),
  needsHumanReason: z.string().nullable().optional(),
  reviewed: z.boolean().optional(),
});

export async function GET(_request: Request, context: RouteContext<"/api/tasks/[id]">) {
  const { id } = await context.params;
  const task = await taskRepo.findById(id);
  if (!task) {
    return NextResponse.json({ data: null, error: `Task ${id} not found.` }, { status: 404 });
  }
  return NextResponse.json({ data: task, error: null });
}

export async function PATCH(request: Request, context: RouteContext<"/api/tasks/[id]">) {
  const { id } = await context.params;
  try {
    const parsed = patchTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const existing = await taskRepo.findById(id);
    if (!existing) {
      return NextResponse.json({ data: null, error: `Task ${id} not found.` }, { status: 404 });
    }

    let task: Task = existing;
    if (
      body.projectId !== undefined ||
      body.title !== undefined ||
      body.description !== undefined ||
      body.priority !== undefined
    ) {
      task = await new UpdateTaskUseCase(taskRepo, projectReference).execute(id, {
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        priority: body.priority,
      });
    }
    if (
      body.assignee !== undefined ||
      body.agentName !== undefined ||
      body.harness !== undefined ||
      body.model !== undefined ||
      body.effort !== undefined ||
      body.herdrPaneId !== undefined
    ) {
      task = await new AssignTaskUseCase(taskRepo).execute(id, {
        assignee: body.assignee !== undefined ? body.assignee : existing.assignee,
        agentName: body.agentName !== undefined ? body.agentName : existing.agentName,
        harness: body.harness !== undefined ? body.harness : existing.harness,
        model: body.model !== undefined ? body.model : existing.model,
        effort: body.effort !== undefined ? body.effort : existing.effort,
        herdrPaneId: body.herdrPaneId !== undefined ? body.herdrPaneId : existing.herdrPaneId,
      });
    }
    if (body.status !== undefined) {
      task = await new MoveTaskUseCase(taskRepo).execute(id, body.status);
    }
    if (body.needsHuman !== undefined) {
      task = await new FlagNeedsHumanUseCase(taskRepo).execute(id, body.needsHuman, body.needsHumanReason ?? null);
    }
    if (body.reviewed !== undefined) {
      task = await new ReviewTaskUseCase(taskRepo).execute(id, body.reviewed);
    }
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/tasks/[id]">) {
  const { id } = await context.params;
  try {
    await new DeleteTaskUseCase(taskRepo).execute(id);
    return NextResponse.json({ data: { id }, error: null });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof TaskNotFoundError) {
    return NextResponse.json({ data: null, error: error.message }, { status: 404 });
  }
  if (
    error instanceof TaskValidationError ||
    error instanceof ProjectReferenceNotFoundError ||
    error instanceof ReviewRequiresDoneError
  ) {
    return NextResponse.json({ data: null, error: error.message }, { status: 400 });
  }
  return NextResponse.json(
    { data: null, error: error instanceof Error ? error.message : "Unknown error" },
    { status: 500 },
  );
}
