import { type Job, jobNeedsHuman } from "@/domain/jobs/job";
import type { Project } from "@/domain/projects/project";
import type { Task } from "@/domain/tasks/task";

/** JSON-safe task shape passed from Server Components to Client Components. */
export type TaskDto = Omit<
  Task,
  "createdAt" | "updatedAt" | "claimedAt" | "completedAt" | "reviewedAt" | "archivedAt"
> & {
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  archivedAt: string | null;
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
    reviewedAt: task.reviewedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
  };
}

export function toProjectDto(project: Project): ProjectDto {
  return { ...project, createdAt: project.createdAt.toISOString() };
}

/** JSON-safe job. `needsHuman` is derived: a dead job is waiting on the operator. */
export type JobDto = Omit<Job, "nextRunAt" | "lastRunAt" | "leaseUntil" | "createdAt" | "updatedAt"> & {
  nextRunAt: string | null;
  lastRunAt: string | null;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
  needsHuman: boolean;
};

export function toJobDto(job: Job): JobDto {
  return {
    ...job,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    leaseUntil: job.leaseUntil?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    needsHuman: jobNeedsHuman(job),
  };
}
