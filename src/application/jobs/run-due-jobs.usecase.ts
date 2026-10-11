import { hostname } from "node:os";

import { type Job, type JobState, markJobDead } from "@/domain/jobs/job";
import type { FinalizeJobInput, JobRepository, ReapPatch } from "@/domain/jobs/job.repository";
import { buildJobPrompt, type JobPromptProject } from "@/domain/jobs/job-prompt";
import { leaseDeadline, planDispatchFailure } from "@/domain/jobs/run-policy";
import { nextRunAt as nextScheduleAt, ScheduleError } from "@/domain/jobs/schedule";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import type { LiveAgentInfo, LiveAgentPort } from "@/domain/tasks/live-agents";

export interface JobProjectPort {
  find(projectId: string): Promise<JobPromptProject | null>;
}

export type RunDueJobsDeps = {
  jobs: JobRepository;
  projects: JobProjectPort;
  agentPrompt: AgentPromptPort;
  liveAgents: LiveAgentPort;
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
  status: "ok" | "error";
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
 * Dispatch prompts a pane that is already live (`agentPrompt` / `liveAgents`).
 * A missing pane fails that run; this tick does not spawn one.
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
  try {
    const agents = await deps.liveAgents.list();
    paneId = resolvePane(job, agents, project);
    await deps.agentPrompt.prompt(paneId, prompt);
  } catch (error) {
    return recordFailure(deps, job, runId, paneId, leaseOwner, now, failureMessage(error));
  }

  try {
    const scheduled = nextScheduleAt(job, now);
    const finalized = await deps.jobs.finalize(job.id, {
      now,
      leaseOwner,
      runId,
      status: "ok",
      paneId,
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
  message: string,
): Promise<RunDueJobsRun> {
  const plan = planDispatchFailure(job, now);
  const input: FinalizeJobInput = {
    now,
    leaseOwner,
    runId,
    status: "error",
    paneId,
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
    status: "error",
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

function resolvePane(job: Job, agents: readonly LiveAgentInfo[], project: JobPromptProject | null): string {
  if (job.targetMode === "spawn") {
    throw new Error(`Job "${job.name}" is set to spawn a pane, and this tick only prompts a pane that already exists.`);
  }
  const pinned = job.targetPaneId?.trim() ?? "";
  if (pinned) {
    if (!agents.some((agent) => agent.paneId === pinned)) {
      throw new Error(`Target pane ${pinned} is not live.`);
    }
    return pinned;
  }
  const folder = project?.folderPath ? expandHome(project.folderPath) : null;
  if (!folder) {
    throw new Error(`Job "${job.name}" has no target pane and no project folder to match a live pane.`);
  }
  const idle = agents
    .filter((agent) => agent.status === "idle" && isInside(agent.cwd, folder))
    .sort((a, b) => a.paneId.localeCompare(b.paneId));
  if (idle.length === 0) {
    throw new Error(`No live idle pane under ${folder}.`);
  }
  return idle[0].paneId;
}

function expandHome(folder: string): string {
  const home = process.env.HOME ?? "";
  const expanded = folder.startsWith("~/") && home ? `${home}/${folder.slice(2)}` : folder;
  return expanded.replace(/\/+$/, "");
}

function isInside(cwd: string, folder: string): boolean {
  return cwd === folder || cwd.startsWith(`${folder}/`);
}
