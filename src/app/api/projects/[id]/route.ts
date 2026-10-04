import { NextResponse } from "next/server";
import { z } from "zod";

import { DeleteProjectUseCase } from "@/application/projects/delete-project";
import { ProjectNotFoundError } from "@/application/projects/errors";
import { UpdateProjectUseCase } from "@/application/projects/update-project";
import { projectRepo } from "@/infrastructure/container";

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  folderPath: z.string().nullable().optional(),
  herdrWorkspaceId: z.string().nullable().optional(),
});

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  const project = await projectRepo.findById(id);
  if (!project) {
    return NextResponse.json({ data: null, error: `Project ${id} not found.` }, { status: 404 });
  }
  return NextResponse.json({ data: project, error: null });
}

export async function PATCH(request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  try {
    const parsed = updateProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const project = await new UpdateProjectUseCase(projectRepo).execute(id, parsed.data);
    return NextResponse.json({ data: project, error: null });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ data: null, error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { data: null, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  try {
    await new DeleteProjectUseCase(projectRepo).execute(id);
    return NextResponse.json({ data: { id }, error: null });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ data: null, error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { data: null, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
