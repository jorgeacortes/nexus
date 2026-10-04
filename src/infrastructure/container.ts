import type { ProjectRepository } from "@/domain/projects/project.repository";
import type { ProjectReferencePort } from "@/domain/tasks/project-reference";
import type { TaskRepository } from "@/domain/tasks/task.repository";
import { db } from "@/infrastructure/db/nexus/db";
import { HerdrClient, type HerdrPort } from "@/infrastructure/herdr/herdr-client";
import { DrizzleProjectRepository } from "@/infrastructure/repositories/projects/drizzle-project.repository";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";

/**
 * Composition root: the only place that wires contexts together. Routes and
 * pages import ready-made repositories/clients from here.
 */
export const projectRepo: ProjectRepository = new DrizzleProjectRepository(db);
export const taskRepo: TaskRepository = new DrizzleTaskRepository(db);
export const herdrClient: HerdrPort = new HerdrClient();

/** Adapts the projects repository to the lookup port the tasks context declares. */
export const projectReference: ProjectReferencePort = {
  exists: async (projectId) => (await projectRepo.findById(projectId)) !== null,
};
