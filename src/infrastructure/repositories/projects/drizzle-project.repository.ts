import { eq } from "drizzle-orm";

import {
  type CreateProjectInput,
  createProject,
  type Project,
  type UpdateProjectInput,
  updateProject,
} from "@/domain/projects/project";
import type { ProjectRepository } from "@/domain/projects/project.repository";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { projects } from "@/infrastructure/db/nexus/schema";

type ProjectRow = typeof projects.$inferSelect;

function toDomain(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folderPath,
    herdrWorkspaceId: row.herdrWorkspaceId,
    createdAt: new Date(row.createdAt),
  };
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: NexusDb) {}

  async findById(id: string): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? toDomain(row) : null;
  }

  async findAll(): Promise<Project[]> {
    return this.db.select().from(projects).orderBy(projects.name).all().map(toDomain);
  }

  async save(input: CreateProjectInput): Promise<Project> {
    const project = createProject(input);
    this.db
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        folderPath: project.folderPath,
        herdrWorkspaceId: project.herdrWorkspaceId,
        createdAt: project.createdAt.toISOString(),
      })
      .run();
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Project ${id} not found`);
    }
    const updated = updateProject(existing, input);
    this.db
      .update(projects)
      .set({
        name: updated.name,
        folderPath: updated.folderPath,
        herdrWorkspaceId: updated.herdrWorkspaceId,
      })
      .where(eq(projects.id, id))
      .run();
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }
}
