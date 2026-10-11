import { describe, expect, it } from "vitest";

import { CreateProjectUseCase } from "@/application/projects/create-project";
import { DuplicateProjectNameError } from "@/application/projects/errors";
import { DrizzleProjectRepository } from "@/infrastructure/repositories/projects/drizzle-project.repository";
import { createTestDb } from "@/test-support/db";

function useCase() {
  const projects = new DrizzleProjectRepository(createTestDb());
  return { projects, create: new CreateProjectUseCase(projects) };
}

describe("CreateProjectUseCase", () => {
  it("refuses a second add with the same name and leaves the existing row unchanged", async () => {
    const { projects, create } = useCase();
    const first = await create.execute({
      name: "joma",
      folderPath: "/tmp/old",
      herdrWorkspaceId: "wV",
    });

    await expect(create.execute({ name: "joma", folderPath: "/tmp/new", herdrWorkspaceId: "wW" })).rejects.toThrow(
      DuplicateProjectNameError,
    );

    const rows = await projects.findAll();
    expect(rows).toEqual([
      {
        id: first.id,
        name: "joma",
        folderPath: "/tmp/old",
        herdrWorkspaceId: "wV",
        createdAt: first.createdAt,
      },
    ]);
  });

  it("matches the trimmed name case-insensitively, whatever the folder is", async () => {
    const { projects, create } = useCase();
    await create.execute({ name: "Joma", folderPath: "/tmp/a", herdrWorkspaceId: "wV" });

    await expect(
      create.execute({ name: "  joma  ", folderPath: "/somewhere/else", herdrWorkspaceId: "wW" }),
    ).rejects.toThrow(
      'A project named "Joma" already exists. Use `nx project edit` to change its folder or workspace.',
    );

    expect(await projects.findAll()).toHaveLength(1);
  });

  it("still creates a project whose name differs, even in the same folder", async () => {
    const { projects, create } = useCase();
    await create.execute({ name: "joma", folderPath: "/tmp/shared" });
    await create.execute({ name: "crm", folderPath: "/tmp/shared" });
    expect((await projects.findAll()).map((project) => project.name).sort()).toEqual(["crm", "joma"]);
  });
});
