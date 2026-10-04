import type { Project } from "@/domain/projects/project";
import type { Task } from "@/domain/tasks/task";

/** JSON-safe task shape passed from Server Components to Client Components. */
export type TaskDto = Omit<Task, "createdAt" | "updatedAt" | "claimedAt" | "completedAt"> & {
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

/** JSON-safe project shape passed from Server Components to Client Components. */
export type ProjectDto = Omit<Project, "createdAt"> & { createdAt: string };

export function toTaskDto(task: Task): TaskDto {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    claimedAt: task.claimedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

export function toProjectDto(project: Project): ProjectDto {
  return { ...project, createdAt: project.createdAt.toISOString() };
}
