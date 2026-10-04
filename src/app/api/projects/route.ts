import { NextResponse } from "next/server";
import { z } from "zod";

import { CreateProjectUseCase } from "@/application/projects/create-project";
import { projectRepo } from "@/infrastructure/container";

const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  folderPath: z.string().nullable().optional(),
  herdrWorkspaceId: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const projects = await projectRepo.findAll();
    return NextResponse.json({ data: projects, error: null });
  } catch (error) {
    return NextResponse.json({ data: null, error: messageOf(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ data: null, error: issuesOf(parsed.error) }, { status: 400 });
    }
    const project = await new CreateProjectUseCase(projectRepo).execute(parsed.data);
    return NextResponse.json({ data: project, error: null }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ data: null, error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(", ");
}
