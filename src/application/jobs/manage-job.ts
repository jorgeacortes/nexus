import { JobNotFoundError } from "@/application/jobs/run-due-jobs.usecase";
import {
  isJobKind,
  isJobPredicate,
  JOB_PREDICATES,
  type Job,
  type JobKind,
  JobValidationError,
  pauseJob,
  resumeJob,
  type TargetMode,
} from "@/domain/jobs/job";
import type { JobRepository } from "@/domain/jobs/job.repository";
import { nextRunAt, ScheduleError } from "@/domain/jobs/schedule";

export type JobProjectLookup = {
  exists(id: string): Promise<boolean>;
};

export type ManageJobDeps = {
  jobs: JobRepository;
  projects: JobProjectLookup;
};

export type CreateJobInput = {
  name: string;
  prompt: string;
  kind?: JobKind;
  predicate?: string | null;
  dailyRunCap?: number | null;
  schedule?: string | null;
  intervalSeconds?: number | null;
  timezone?: string | null;
  projectId?: string | null;
  targetPaneId?: string | null;
  targetMode?: TargetMode;
  maxRetries?: number;
  timeoutSeconds?: number | null;
  enabled?: boolean;
  now?: Date;
};

export type EditJobInput = {
  name?: string;
  prompt?: string;
  kind?: JobKind;
  predicate?: string | null;
  dailyRunCap?: number | null;
  schedule?: string | null;
  intervalSeconds?: number | null;
  timezone?: string | null;
  projectId?: string | null;
  targetPaneId?: string | null;
  targetMode?: TargetMode;
  maxRetries?: number;
  timeoutSeconds?: number | null;
  enabled?: boolean;
  now?: Date;
};

const DEFAULT_MAX_RETRIES = 3;

export async function listJobs(deps: ManageJobDeps): Promise<Job[]> {
  const rows = await deps.jobs.list();
  return rows.sort(compareJobs);
}

export async function createJob(deps: ManageJobDeps, input: CreateJobInput): Promise<Job> {
  const now = input.now ?? new Date();
  const name = requireText(input.name, "A job needs a name.");
  const prompt = requireText(input.prompt, "A job needs a prompt.");
  const kind = input.kind ?? "schedule";
  const schedule = blankToNull(input.schedule);
  const intervalSeconds = input.intervalSeconds ?? null;
  const predicate = requirePredicate(kind, input.predicate);
  if (kind !== "review" && !schedule && (intervalSeconds == null || intervalSeconds <= 0)) {
    throw new JobValidationError("A job needs a cron schedule or an interval greater than zero.");
  }
  const projectId = blankToNull(input.projectId);
  await requireProject(deps, projectId);
  const due =
    schedule || (intervalSeconds != null && intervalSeconds > 0)
      ? dueAt(schedule, intervalSeconds, input.timezone, now)
      : null;
  return deps.jobs.insert({
    id: crypto.randomUUID(),
    name,
    kind,
    schedule,
    intervalSeconds: schedule ? null : intervalSeconds,
    timezone: blankToNull(input.timezone),
    prompt,
    predicate,
    dailyRunCap: normalizeCap(input.dailyRunCap),
    projectId,
    targetPaneId: blankToNull(input.targetPaneId),
    targetMode: input.targetMode ?? "reuse",
    harness: null,
    model: null,
    effort: null,
    enabled: input.enabled ?? true,
    state: "active",
    nextRunAt: due,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    retryCount: 0,
    maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
    timeoutSeconds: input.timeoutSeconds ?? null,
    runCount: 0,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function editJob(deps: ManageJobDeps, id: string, input: EditJobInput): Promise<Job> {
  const current = await requireJob(deps, id);
  const now = input.now ?? new Date();
  const schedule = input.schedule === undefined ? current.schedule : blankToNull(input.schedule);
  const intervalSeconds = input.intervalSeconds === undefined ? current.intervalSeconds : input.intervalSeconds;
  const kind = input.kind ?? current.kind;
  const predicate = requirePredicate(kind, input.predicate === undefined ? current.predicate : input.predicate);
  if (kind !== "review" && !schedule && (intervalSeconds == null || intervalSeconds <= 0)) {
    throw new JobValidationError("A job needs a cron schedule or an interval greater than zero.");
  }
  const projectId = input.projectId === undefined ? current.projectId : blankToNull(input.projectId);
  await requireProject(deps, projectId);
  const scheduleChanged =
    schedule !== current.schedule ||
    intervalSeconds !== current.intervalSeconds ||
    (input.timezone !== undefined && blankToNull(input.timezone) !== current.timezone);
  const next = {
    ...current,
    name: input.name === undefined ? current.name : requireText(input.name, "A job needs a name."),
    prompt: input.prompt === undefined ? current.prompt : requireText(input.prompt, "A job needs a prompt."),
    kind,
    predicate,
    dailyRunCap: input.dailyRunCap === undefined ? current.dailyRunCap : normalizeCap(input.dailyRunCap),
    schedule,
    intervalSeconds: schedule ? null : intervalSeconds,
    timezone: input.timezone === undefined ? current.timezone : blankToNull(input.timezone),
    projectId,
    targetPaneId: input.targetPaneId === undefined ? current.targetPaneId : blankToNull(input.targetPaneId),
    targetMode: input.targetMode ?? current.targetMode,
    maxRetries: input.maxRetries ?? current.maxRetries,
    timeoutSeconds: input.timeoutSeconds === undefined ? current.timeoutSeconds : input.timeoutSeconds,
    enabled: input.enabled ?? current.enabled,
    nextRunAt: scheduleChanged
      ? dueAt(schedule, intervalSeconds, input.timezone ?? current.timezone, now)
      : current.nextRunAt,
    updatedAt: now,
  };
  return deps.jobs.update(next);
}

export async function pauseManagedJob(deps: ManageJobDeps, id: string, now = new Date()): Promise<Job> {
  const current = await requireJob(deps, id);
  return deps.jobs.update(pauseJob(current, now));
}

export async function resumeManagedJob(deps: ManageJobDeps, id: string, now = new Date()): Promise<Job> {
  const current = await requireJob(deps, id);
  return deps.jobs.update(resumeJob(current, now));
}

export async function removeJob(deps: ManageJobDeps, id: string): Promise<void> {
  await requireJob(deps, id);
  await deps.jobs.delete(id);
}

async function requireJob(deps: ManageJobDeps, id: string): Promise<Job> {
  const job = await deps.jobs.findById(id);
  if (!job) throw new JobNotFoundError(id);
  return job;
}

async function requireProject(deps: ManageJobDeps, projectId: string | null): Promise<void> {
  if (!projectId) return;
  if (!(await deps.projects.exists(projectId))) {
    throw new JobValidationError(`Project ${projectId} not found.`);
  }
}

function dueAt(
  schedule: string | null,
  intervalSeconds: number | null,
  timezone: string | null | undefined,
  now: Date,
): Date {
  try {
    return nextRunAt({ schedule, intervalSeconds, timezone: timezone ?? null }, now);
  } catch (error) {
    if (error instanceof ScheduleError) throw new JobValidationError(error.message);
    throw error;
  }
}

function requirePredicate(kind: JobKind, predicate: string | null | undefined): string | null {
  if (!isJobKind(kind)) {
    throw new JobValidationError(`Unknown job kind "${String(kind)}".`);
  }
  if (kind !== "poll") return null;
  const name = predicate?.trim() ?? "";
  if (!isJobPredicate(name)) {
    throw new JobValidationError(`A poll job needs a predicate: ${JOB_PREDICATES.join(", ")}.`);
  }
  return name;
}

function normalizeCap(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new JobValidationError("A daily run cap must be a whole number greater than zero.");
  }
  return value;
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new JobValidationError(message);
  return trimmed;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Dead rows first (they need the operator), then the soonest next run. */
function compareJobs(a: Job, b: Job): number {
  const rank = (job: Job) => (job.state === "dead" ? 0 : 1);
  const byNeed = rank(a) - rank(b);
  if (byNeed !== 0) return byNeed;
  const aTime = a.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}
