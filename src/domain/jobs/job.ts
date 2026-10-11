/**
 * A stored job: something the board will hand to a harness when it is due.
 *
 * `state` is the lifecycle (active, paused, dead) and is independent of
 * `enabled`. Dead is the operator's court: `jobNeedsHuman` is true only then.
 * `reviveJob` is the explicit way back to active (a re-run). Pause and resume
 * do not apply to a dead job. These functions do not lease or dispatch.
 */

import type { Effort, Harness } from "@/domain/tasks/task";

export const JOB_KINDS = ["schedule"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ["active", "paused", "dead"] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TARGET_MODES = ["reuse", "spawn"] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const JOB_RUN_STATUSES = ["running", "ok", "error", "timeout"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

/** Where each state is allowed to go. Dead has nowhere to go. */
export const JOB_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  active: ["paused", "dead"],
  paused: ["active", "dead"],
  dead: [],
};

export class JobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobValidationError";
  }
}

/** Raised when a state change is not in `JOB_TRANSITIONS`. */
export class JobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTransitionError";
  }
}

export function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);
}

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === "string" && (JOB_KINDS as readonly string[]).includes(value);
}

export function isTargetMode(value: unknown): value is TargetMode {
  return typeof value === "string" && (TARGET_MODES as readonly string[]).includes(value);
}

export function isJobRunStatus(value: unknown): value is JobRunStatus {
  return typeof value === "string" && (JOB_RUN_STATUSES as readonly string[]).includes(value);
}

export type Job = {
  id: string;
  name: string;
  kind: JobKind;
  schedule: string | null;
  intervalSeconds: number | null;
  timezone: string | null;
  prompt: string;
  projectId: string | null;
  targetPaneId: string | null;
  targetMode: TargetMode;
  harness: Harness | null;
  model: string | null;
  effort: Effort | null;
  enabled: boolean;
  state: JobState;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: JobRunStatus | null;
  lastError: string | null;
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number | null;
  runCount: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobRun = {
  id: string;
  jobId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: JobRunStatus;
  paneId: string | null;
  leaseOwner: string | null;
  prompt: string | null;
  output: string | null;
  error: string | null;
};

/** The single `jobs_meta` row. `id` is always 1. */
export type JobsMeta = {
  id: 1;
  lastTickAt: Date | null;
};

/** Moves `state` when the transition is legal. Every other field stays put. */
export function transitionJob(job: Job, to: JobState, now: Date = new Date()): Job {
  if (!isJobState(to)) {
    throw new JobValidationError(`Unknown job state "${String(to)}".`);
  }
  if (!JOB_TRANSITIONS[job.state].includes(to)) {
    throw new JobTransitionError(`A job in "${job.state}" cannot move to "${to}".`);
  }
  return { ...job, state: to, updatedAt: now };
}

/** active → paused. */
export function pauseJob(job: Job, now?: Date): Job {
  return transitionJob(job, "paused", now);
}

/** paused → active. */
export function resumeJob(job: Job, now?: Date): Job {
  return transitionJob(job, "active", now);
}

/** active or paused → dead. Dead is terminal until `reviveJob`. */
export function markJobDead(job: Job, now?: Date): Job {
  return transitionJob(job, "dead", now);
}

/** A dead-lettered job is waiting on the operator. */
export function jobNeedsHuman(job: Pick<Job, "state">): boolean {
  return job.state === "dead";
}

/**
 * dead → active, for an operator re-run. Retries start over and the job is due
 * immediately. Pause and resume still refuse a dead job.
 */
export function reviveJob(job: Job, now: Date): Job {
  if (job.state !== "dead") {
    throw new JobTransitionError(`Only a dead job can be run again. This one is "${job.state}".`);
  }
  return {
    ...job,
    state: "active",
    retryCount: 0,
    lastError: null,
    nextRunAt: now,
    leaseOwner: null,
    leaseUntil: null,
    updatedAt: now,
  };
}
