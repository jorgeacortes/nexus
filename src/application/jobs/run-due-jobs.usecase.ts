import { hostname } from "node:os";

import { isTimeoutError, JobPaneError, placeJobPane } from "@/application/jobs/place-job-pane";
import type { HarnessPort } from "@/domain/dispatch/harness";
import { expandHome } from "@/domain/dispatch/placement";
import { type Job, type JobRunStatus, type JobState, markJobDead, reviveJob } from "@/domain/jobs/job";
import type { FinalizeJobInput, JobRepository, ReapPatch } from "@/domain/jobs/job.repository";
import { buildJobPrompt, type JobPromptProject } from "@/domain/jobs/job-prompt";
import { leaseDeadline, planDispatchFailure, runTimeoutMs } from "@/domain/jobs/run-policy";
import { nextRunAt as nextScheduleAt, ScheduleError } from "@/domain/jobs/schedule";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";

export interface JobProjectPort {
  find(projectId: string): Promise<JobPromptProject | null>;
  /** Persists a workspace a spawn run resolved or created. */
  setWorkspaceId?(projectId: string, workspaceId: string): Promise<void>;
}

/**
 * Prompt with a deadline, then read the transcript. Topology stays on
 * `HarnessPort`; this is only the wait and the read a job run adds.
 */
export interface JobAgentPort {
  prompt(paneId: string, text: string, options?: { timeoutMs?: number }): Promise<void>;
  read(paneId: string): Promise<string>;
}

export type RunDueJobsDeps = {
  jobs: JobRepository;
  projects: JobProjectPort;
  agentPrompt: JobAgentPort;
  liveAgents: LiveAgentPort;
  /**
   * Dispatch topology for `target_mode: spawn` (reuse a bare shell or create a
   * tab, then start the agent). A live idle target does not call it.
   */
  harness?: HarnessPort;
  /** Who holds a lease. Defaults to `hostname:pid`. */
  leaseOwner?: string;
};

export type RunDueJobsInput = {
  now: Date;
  /** How many due jobs to claim. Defaults to 1. */
  limit?: number;
  /** Report the due set and write nothing: no reap, no lease, no prompt, no meta. */
  dryRun?: boolean;
};

export type RunDueJobsRun = {
  jobId: string;
  runId: string;
  status: "ok" | "error" | "timeout";
  paneId: string | null;
  error: string | null;
  state: JobState;
};

export type RunDueJobsReport = {
  dryRun: boolean;
  due: string[];
  reaped: string[];
  lost: string[];
  runs: RunDueJobsRun[];
  lastTickAt: string | null;
};

const LEASE_EXPIRED = "Lease expired before the run finished.";

/**
 * One tick. Reap, then claim, then dispatch, then finalize.
 *
 * The lease update and the `running` row commit together. The prompt runs only
 * after that transaction has committed, so a crash mid-dispatch leaves a lease
 * the next tick can reap. Finalize is a second short transaction: success
 * advances `next_run_at` from the schedule; failure retries with `2^n` backoff
 * or dead-letters once `retryCount` has reached `maxRetries`.
 *
 * A live idle `target_pane_id` inside the job's project folder is prompted in
 * place. Otherwise a spawn job places a pane with the dispatch topology (reuse
 * a bare shell or create a tab, then start the agent). Anything else fails
 * that run with "no pane" and does not create a tab. The prompt waits up to
 * `timeout_seconds`, then the pane is read into the run. A timeout — including
 * an agent start that never becomes ready — is status `timeout` and follows
 * the same retry policy as any other failure.
 */
export async function runDueJobs(deps: RunDueJobsDeps, input: RunDueJobsInput): Promise<RunDueJobsReport> {
  const now = input.now;
  const limit = normalizeLimit(input.limit);
  const leaseOwner = deps.leaseOwner ?? `${hostname()}:${process.pid}`;

  if (input.dryRun) {
    const due = await deps.jobs.selectDue(now, limit);
    const meta = await deps.jobs.readMeta();
    return {
      dryRun: true,
      due: due.map((job) => job.id),
      reaped: [],
      lost: [],
      runs: [],
      lastTickAt: meta?.lastTickAt?.toISOString() ?? null,
    };
  }

  const reaped = await deps.jobs.reapExpired(now, (job, hasRunning) => reapPatch(job, hasRunning, now));
  const due = await deps.jobs.selectDue(now, limit);
  const lost: string[] = [];
  const runs: RunDueJobsRun[] = [];

  for (const candidate of due) {
    const project = candidate.projectId ? await deps.projects.find(candidate.projectId) : null;
    const prompt = buildJobPrompt(candidate, project);
    const claimed = await deps.jobs.claim(candidate.id, {
      now,
      leaseOwner,
      leaseUntil: leaseDeadline(candidate, now),
      prompt,
    });
    if (!claimed) {
      lost.push(candidate.id);
      continue;
    }

    const outcome = await dispatchClaimed(deps, claimed.job, claimed.run.id, prompt, project, leaseOwner, now);
    runs.push(outcome);
  }

  const meta = await deps.jobs.writeLastTick(now);
  return {
    dryRun: false,
    due: due.map((job) => job.id),
    reaped,
    lost,
    runs,
    lastTickAt: meta.lastTickAt?.toISOString() ?? null,
  };
}

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job ${id} not found.`);
    this.name = "JobNotFoundError";
  }
}

/** Pause, a held lease, or a disabled row. A dead job is revived instead of refused. */
export class JobNotRunnableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobNotRunnableError";
  }
}

/**
 * Run one job now, ignoring its schedule. A dead job is revived first (retries
 * reset, due immediately). A paused job is refused so pause still means the
 * tick will not dispatch it. The claim does not require `nextRunAt <= now`.
 */
export async function runJobNow(deps: RunDueJobsDeps, id: string, now: Date): Promise<RunDueJobsRun> {
  const existing = await deps.jobs.findById(id);
  if (!existing) throw new JobNotFoundError(id);
  if (!existing.enabled) {
    throw new JobNotRunnableError(`Job "${existing.name}" is disabled.`);
  }
  if (existing.state === "paused") {
    throw new JobNotRunnableError(`Job "${existing.name}" is paused. Resume it before running it.`);
  }

  const job = existing.state === "dead" ? await deps.jobs.update(reviveJob(existing, now)) : existing;
  const project = job.projectId ? await deps.projects.find(job.projectId) : null;
  const prompt = buildJobPrompt(job, project);
  const leaseOwner = deps.leaseOwner ?? `${hostname()}:${process.pid}`;
  const claimed = await deps.jobs.claim(
    job.id,
    { now, leaseOwner, leaseUntil: leaseDeadline(job, now), prompt },
    { ignoreSchedule: true },
  );
  if (!claimed) {
    throw new JobNotRunnableError(`Job "${job.name}" is already running.`);
  }
  return dispatchClaimed(deps, claimed.job, claimed.run.id, prompt, project, leaseOwner, now);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 1;
  return Math.max(0, Math.floor(limit));
}

/**
 * A crashed attempt (lease expired, run still `running`) is a failure. While
 * retries remain, the lease is cleared and `next_run_at` is left alone, so the
 * same tick's due select claims it again. Past `maxRetries` the job is dead
 * and the select skips it. A stale lease with no running row is only released.
 */
function reapPatch(job: Job, hasRunning: boolean, now: Date): ReapPatch {
  if (!hasRunning) {
    return {
      closeRunning: false,
      runError: null,
      state: job.state,
      retryCount: job.retryCount,
      lastStatus: job.lastStatus,
      lastError: job.lastError,
      lastRunAt: job.lastRunAt,
    };
  }
  const closed = {
    closeRunning: true,
    runError: LEASE_EXPIRED,
    lastStatus: "timeout" as const,
    lastError: LEASE_EXPIRED,
    lastRunAt: now,
  };
  if (job.state !== "active" || !job.enabled) {
    return { ...closed, state: job.state, retryCount: job.retryCount };
  }
  if (job.retryCount >= job.maxRetries) {
    return { ...closed, state: markJobDead(job, now).state, retryCount: job.retryCount };
  }
  return { ...closed, state: job.state, retryCount: job.retryCount + 1 };
}

async function dispatchClaimed(
  deps: RunDueJobsDeps,
  job: Job,
  runId: string,
  prompt: string,
  project: JobPromptProject | null,
  leaseOwner: string,
  now: Date,
): Promise<RunDueJobsRun> {
  let paneId: string | null = null;
  let output: string | null = null;
  const timeoutMs = runTimeoutMs(job);
  try {
    const agents = await deps.liveAgents.list();
    paneId = resolvePane(job, agents, project);
    if (!paneId) {
      paneId = await spawnPane(deps, job, project, timeoutMs);
    }
    await deps.agentPrompt.prompt(paneId, prompt, { timeoutMs });
    output = await deps.agentPrompt.read(paneId);
  } catch (error) {
    if (error instanceof JobPaneError && error.paneId) paneId = error.paneId;
    const status = error instanceof JobPaneError ? (error.timeout ? "timeout" : "error") : failureStatus(error);
    return recordFailure(deps, job, runId, paneId, leaseOwner, now, status, failureMessage(error));
  }

  try {
    const scheduled = nextScheduleAt(job, now);
    const finalized = await deps.jobs.finalize(job.id, {
      now,
      leaseOwner,
      runId,
      status: "ok",
      paneId,
      output,
      error: null,
      nextRunAt: scheduled,
      state: "active",
      retryCount: 0,
      lastError: null,
    });
    return {
      jobId: job.id,
      runId,
      status: "ok",
      paneId,
      error: finalized ? null : "Lost the lease before the run could be recorded.",
      state: finalized?.state ?? job.state,
    };
  } catch (error) {
    if (!(error instanceof ScheduleError)) throw error;
    // The pane already has the prompt. Dead-letter rather than send it again
    // on a schedule this process cannot advance.
    const finalized = await deps.jobs.finalize(job.id, {
      now,
      leaseOwner,
      runId,
      status: "ok",
      paneId,
      output,
      error: null,
      nextRunAt: job.nextRunAt,
      state: deadState(job, now),
      retryCount: 0,
      lastError: error.message,
    });
    return {
      jobId: job.id,
      runId,
      status: "ok",
      paneId,
      error: error.message,
      state: finalized?.state ?? "dead",
    };
  }
}

async function recordFailure(
  deps: RunDueJobsDeps,
  job: Job,
  runId: string,
  paneId: string | null,
  leaseOwner: string,
  now: Date,
  status: Extract<JobRunStatus, "error" | "timeout">,
  message: string,
): Promise<RunDueJobsRun> {
  const plan = planDispatchFailure(job, now);
  const input: FinalizeJobInput = {
    now,
    leaseOwner,
    runId,
    status,
    paneId,
    output: null,
    error: message,
    nextRunAt: plan.outcome === "retry" ? plan.nextRunAt : job.nextRunAt,
    state: plan.outcome === "dead" ? deadState(job, now) : job.state,
    retryCount: plan.retryCount,
    lastError: message,
  };
  const finalized = await deps.jobs.finalize(job.id, input);
  return {
    jobId: job.id,
    runId,
    status,
    paneId,
    error: message,
    state: finalized?.state ?? input.state,
  };
}

function deadState(job: Job, now: Date): JobState {
  if (job.state === "dead") return "dead";
  return markJobDead(job, now).state;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "The job dispatch failed.";
}

function failureStatus(error: unknown): "error" | "timeout" {
  return isTimeoutError(error) ? "timeout" : "error";
}

/**
 * The named pane, when it is live, idle, and — if the job has a project folder —
 * inside that folder. A pane in another project's folder is not usable. Missing
 * or busy targets return null so the caller can spawn or fail with "no pane".
 */
function resolvePane(job: Job, agents: readonly LiveAgentInfo[], project: JobPromptProject | null): string | null {
  const pinned = job.targetPaneId?.trim() ?? "";
  if (!pinned) return null;
  const agent = agents.find((candidate) => candidate.paneId === pinned);
  if (!agent) return null;
  if (agent.status !== "idle") return null;
  const folder = project?.folderPath ? expandHome(project.folderPath) : null;
  if (folder && !isInside(agent.cwd, folder)) return null;
  return pinned;
}

/** Spawn into the project folder, or fail the run when this job may not place a pane. */
async function spawnPane(
  deps: RunDueJobsDeps,
  job: Job,
  project: JobPromptProject | null,
  timeoutMs: number,
): Promise<string> {
  const folder = project?.folderPath?.trim() ?? "";
  if (job.targetMode !== "spawn" || !deps.harness || !project?.id || folder === "") {
    throw new Error("no pane");
  }
  return placeJobPane({
    harness: deps.harness,
    job,
    project: {
      id: project.id,
      name: project.name,
      folderPath: folder,
      herdrWorkspaceId: project.herdrWorkspaceId,
    },
    setWorkspaceId: (projectId, workspaceId) =>
      deps.projects.setWorkspaceId?.(projectId, workspaceId) ?? Promise.resolve(),
    timeoutMs,
  });
}

function isInside(cwd: string, folder: string): boolean {
  const dir = expandHome(cwd);
  const root = expandHome(folder);
  return dir === root || dir.startsWith(`${root}/`);
}
