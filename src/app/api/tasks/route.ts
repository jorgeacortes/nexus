import { NextResponse } from "next/server";
import { z } from "zod";

import { CreateTaskUseCase } from "@/application/tasks/create-task";
import { ProjectReferenceNotFoundError } from "@/application/tasks/errors";
import type { ArchivedFilter } from "@/application/tasks/list-tasks";
import { ASSIGNEE_TYPES, HARNESSES, TASK_PRIORITIES, TASK_STATUSES, TaskValidationError } from "@/domain/tasks/task";
import { listTasks, projectReference, taskRepo } from "@/infrastructure/container";

const createTaskSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().min(1, "Task title is required"),
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
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const needsHuman = url.searchParams.get("needsHuman");
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const archived = archiveFilter(url.searchParams.get("archived"));
    // The sweep runs inside the list read, so a done card older than 7 days
    // leaves before this response is built. No timer.
    let tasks = await listTasks.execute({
      projectId: projectId || undefined,
      archived,
    });
    if (needsHuman === "true") {
      tasks = tasks.filter((task) => task.needsHuman);
    }
    if (status) {
      tasks = tasks.filter((task) => task.status === status);
    }
    if (priority) {
      tasks = tasks.filter((task) => task.priority === priority);
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

function archiveFilter(value: string | null): ArchivedFilter {
  if (value === "only" || value === "include") return value;
  return "exclude";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(", ");
}
