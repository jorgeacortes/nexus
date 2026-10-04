import type { Project } from "@/domain/projects/project";
import type { Task } from "@/domain/tasks/task";

/** JSON-safe task shape passed from Server Components to Client Components. */
export type TaskDto = Omit<Task, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

/** JSON-safe project shape passed from Server Components to Client Components. */
export type ProjectDto = Omit<Project, "createdAt"> & { createdAt: string };

export function toTaskDto(task: Task): TaskDto {
  return { ...task, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() };
}

export function toProjectDto(project: Project): ProjectDto {
  return { ...project, createdAt: project.createdAt.toISOString() };
}
