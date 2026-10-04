import { NextResponse } from "next/server";
import { z } from "zod";

import { CreateTaskUseCase } from "@/application/tasks/create-task";
import { ProjectReferenceNotFoundError } from "@/application/tasks/errors";
import { ASSIGNEE_TYPES, HARNESSES, TASK_STATUSES, TaskValidationError } from "@/domain/tasks/task";
import { projectReference, taskRepo } from "@/infrastructure/container";

const createTaskSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().min(1, "Task title is required"),
  description: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.enum(ASSIGNEE_TYPES).nullable().optional(),
  agentName: z.string().nullable().optional(),
  harness: z.enum(HARNESSES).nullable().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  herdrPaneId: z.string().nullable().optional(),
  needsHuman: z.boolean().optional(),
  needsHumanReason: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const needsHuman = url.searchParams.get("needsHuman");
    let tasks = projectId ? await taskRepo.findByProjectId(projectId) : await taskRepo.findAll();
    if (needsHuman === "true") {
      tasks = tasks.filter((task) => task.needsHuman);
    }
    return NextResponse.json({ data: tasks, error: null });
  } catch (error) {
    return NextResponse.json({ data: null, error: messageOf(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ data: null, error: issuesOf(parsed.error) }, { status: 400 });
    }
    const task = await new CreateTaskUseCase(taskRepo, projectReference).execute(parsed.data);
    return NextResponse.json({ data: task, error: null }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskValidationError || error instanceof ProjectReferenceNotFoundError) {
      return NextResponse.json({ data: null, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: null, error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(", ");
}
