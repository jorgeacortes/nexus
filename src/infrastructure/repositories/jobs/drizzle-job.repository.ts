import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";

import {
  isJobKind,
  isJobRunStatus,
  isJobState,
  isTargetMode,
  type Job,
  type JobKind,
  type JobRun,
  type JobRunStatus,
  type JobState,
  type JobsMeta,
  JobValidationError,
  type TargetMode,
} from "@/domain/jobs/job";
import type {
  ClaimedJob,
  ClaimJobInput,
  FinalizeJobInput,
  JobRepository,
  ReapPatch,
} from "@/domain/jobs/job.repository";
import { EFFORT_LEVELS, type Effort, type Harness, isHarness } from "@/domain/tasks/task";
import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { jobRuns, jobs, jobsMeta } from "@/infrastructure/db/nexus/schema";

type JobRow = typeof jobs.$inferSelect;
type JobRunRow = typeof jobRuns.$inferSelect;

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function at(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function toKind(value: string): JobKind {
  return isJobKind(value) ? value : "schedule";
}

function toState(value: string): JobState {
  // An unknown state must not become dispatchable.
  return isJobState(value) ? value : "dead";
}

function toTargetMode(value: string): TargetMode {
  return isTargetMode(value) ? value : "reuse";
}

function toHarness(value: string | null): Harness | null {
  return isHarness(value) ? value : null;
}

function toEffort(value: string | null): Effort | null {
  return value !== null && (EFFORT_LEVELS as readonly string[]).includes(value) ? (value as Effort) : null;
}

function toRunStatus(value: string | null): JobRunStatus | null {
  return isJobRunStatus(value) ? value : null;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    kind: toKind(row.kind),
    schedule: row.schedule,
    intervalSeconds: row.intervalSeconds,
    timezone: row.timezone,
    prompt: row.prompt,
    projectId: row.projectId,
    targetPaneId: row.targetPaneId,
    targetMode: toTargetMode(row.targetMode),
    harness: toHarness(row.harness),
    model: row.model,
    effort: toEffort(row.effort),
    enabled: row.enabled,
    state: toState(row.state),
    nextRunAt: at(row.nextRunAt),
    lastRunAt: at(row.lastRunAt),
    lastStatus: toRunStatus(row.lastStatus),
    lastError: row.lastError,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    timeoutSeconds: row.timeoutSeconds,
    runCount: row.runCount,
    leaseOwner: row.leaseOwner,
    leaseUntil: at(row.leaseUntil),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toRun(row: JobRunRow): JobRun {
  const status = toRunStatus(row.status);
  if (!status) {
    throw new JobValidationError(`Job run ${row.id} has an unknown status "${row.status}".`);
  }
  return {
    id: row.id,
    jobId: row.jobId,
    startedAt: new Date(row.startedAt),
    finishedAt: at(row.finishedAt),
    status,
    paneId: row.paneId,
    leaseOwner: row.leaseOwner,
    prompt: row.prompt,
    output: row.output,
    error: row.error,
  };
}

function toJobRow(job: Job) {
  return {
    id: job.id,
    name: job.name,
    kind: job.kind,
    schedule: job.schedule,
    intervalSeconds: job.intervalSeconds,
    timezone: job.timezone,
    prompt: job.prompt,
    projectId: job.projectId,
    targetPaneId: job.targetPaneId,
    targetMode: job.targetMode,
    harness: job.harness,
    model: job.model,
    effort: job.effort,
    enabled: job.enabled,
    state: job.state,
    nextRunAt: iso(job.nextRunAt),
    lastRunAt: iso(job.lastRunAt),
    lastStatus: job.lastStatus,
    lastError: job.lastError,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    timeoutSeconds: job.timeoutSeconds,
    runCount: job.runCount,
    leaseOwner: job.leaseOwner,
    leaseUntil: iso(job.leaseUntil),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function dueWhere(nowIso: string) {
  return and(
    eq(jobs.enabled, true),
    eq(jobs.state, "active"),
    isNotNull(jobs.nextRunAt),
    lte(jobs.nextRunAt, nowIso),
    or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, nowIso)),
  );
}

/**
 * Job rows on the app's SQLite connection (`openNexusSqlite`: WAL and
 * `busy_timeout`). Every statement goes through Drizzle. Claim, reap, and
 * finalize each run in one immediate transaction so a second tick blocks
 * until the first commits, then loses on `changes() === 1`.
 */
export class DrizzleJobRepository implements JobRepository {
  constructor(private readonly db: NexusDb) {}

  async insert(job: Job): Promise<Job> {
    this.db.insert(jobs).values(toJobRow(job)).run();
    return job;
  }

  async update(job: Job): Promise<Job> {
    const result = this.db.update(jobs).set(toJobRow(job)).where(eq(jobs.id, job.id)).run();
    if (result.changes !== 1) {
      throw new JobValidationError(`Job ${job.id} not found.`);
    }
    return job;
  }

  async insertRun(run: JobRun): Promise<JobRun> {
    this.db
      .insert(jobRuns)
      .values({
        id: run.id,
        jobId: run.jobId,
        startedAt: run.startedAt.toISOString(),
        finishedAt: iso(run.finishedAt),
        status: run.status,
        paneId: run.paneId,
        leaseOwner: run.leaseOwner,
        prompt: run.prompt,
        output: run.output,
        error: run.error,
      })
      .run();
    return run;
  }

  async findById(id: string): Promise<Job | null> {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? toJob(row) : null;
  }

  async runsFor(jobId: string): Promise<JobRun[]> {
    return this.db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobId, jobId))
      .orderBy(asc(jobRuns.startedAt), asc(jobRuns.id))
      .all()
      .map(toRun);
  }

  async readMeta(): Promise<JobsMeta | null> {
    const row = this.db.select().from(jobsMeta).where(eq(jobsMeta.id, 1)).get();
    if (!row) return null;
    return { id: 1, lastTickAt: at(row.lastTickAt) };
  }

  async selectDue(now: Date, limit: number): Promise<Job[]> {
    if (limit <= 0) return [];
    return this.db
      .select()
      .from(jobs)
      .where(dueWhere(now.toISOString()))
      .orderBy(asc(jobs.nextRunAt), asc(jobs.id))
      .limit(limit)
      .all()
      .map(toJob);
  }

  async reapExpired(now: Date, decide: (job: Job, hasRunning: boolean) => ReapPatch): Promise<string[]> {
    const nowIso = now.toISOString();
    return this.db.transaction(
      (tx) => {
        const expired = tx
          .select()
          .from(jobs)
          .where(and(isNotNull(jobs.leaseUntil), lte(jobs.leaseUntil, nowIso)))
          .all();
        const reaped: string[] = [];
        for (const row of expired) {
          const job = toJob(row);
          const running = tx
            .select({ id: jobRuns.id })
            .from(jobRuns)
            .where(and(eq(jobRuns.jobId, job.id), eq(jobRuns.status, "running")))
            .all();
          const patch = decide(job, running.length > 0);
          const claimed = tx
            .update(jobs)
            .set({
              leaseOwner: null,
              leaseUntil: null,
              state: patch.state,
              retryCount: patch.retryCount,
              lastStatus: patch.lastStatus,
              lastError: patch.lastError,
              lastRunAt: iso(patch.lastRunAt),
              updatedAt: nowIso,
            })
            .where(and(eq(jobs.id, job.id), isNotNull(jobs.leaseUntil), lte(jobs.leaseUntil, nowIso)))
            .run();
          // Another tick already released this lease.
          if (claimed.changes !== 1) continue;
          if (patch.closeRunning) {
            tx.update(jobRuns)
              .set({ status: "timeout", finishedAt: nowIso, error: patch.runError })
              .where(and(eq(jobRuns.jobId, job.id), eq(jobRuns.status, "running")))
              .run();
          }
          reaped.push(job.id);
        }
        return reaped;
      },
      { behavior: "immediate" },
    );
  }

  async claim(id: string, input: ClaimJobInput): Promise<ClaimedJob | null> {
    const nowIso = input.now.toISOString();
    return this.db.transaction(
      (tx) => {
        const current = tx.select().from(jobs).where(eq(jobs.id, id)).get();
        if (!current) return null;
        const result = tx
          .update(jobs)
          .set({
            leaseOwner: input.leaseOwner,
            leaseUntil: input.leaseUntil.toISOString(),
            lastStatus: "running",
            lastRunAt: nowIso,
            runCount: current.runCount + 1,
            updatedAt: nowIso,
          })
          .where(and(eq(jobs.id, id), dueWhere(nowIso)))
          .run();
        // The due predicate is the lock. A concurrent tick that already leased
        // the row updates zero rows and must not insert a second run.
        if (result.changes !== 1) return null;
        const run: JobRunRow = {
          id: crypto.randomUUID(),
          jobId: id,
          startedAt: nowIso,
          finishedAt: null,
          status: "running",
          paneId: null,
          leaseOwner: input.leaseOwner,
          prompt: input.prompt,
          output: null,
          error: null,
        };
        tx.insert(jobRuns).values(run).run();
        const updated = tx.select().from(jobs).where(eq(jobs.id, id)).get();
        if (!updated) {
          throw new JobValidationError(`Job ${id} disappeared after it was claimed.`);
        }
        return { job: toJob(updated), run: toRun(run) };
      },
      { behavior: "immediate" },
    );
  }

  async finalize(id: string, input: FinalizeJobInput): Promise<Job | null> {
    const nowIso = input.now.toISOString();
    return this.db.transaction(
      (tx) => {
        const row = tx.select().from(jobs).where(eq(jobs.id, id)).get();
        if (!row || row.leaseOwner !== input.leaseOwner) return null;
        const finished = tx
          .update(jobRuns)
          .set({
            status: input.status,
            finishedAt: nowIso,
            paneId: input.paneId,
            error: input.error,
          })
          .where(and(eq(jobRuns.id, input.runId), eq(jobRuns.status, "running")))
          .run();
        // The reaper already closed this attempt. Leave the job for it.
        if (finished.changes !== 1) return null;
        const released = tx
          .update(jobs)
          .set({
            leaseOwner: null,
            leaseUntil: null,
            nextRunAt: iso(input.nextRunAt),
            lastRunAt: nowIso,
            lastStatus: input.status,
            lastError: input.lastError,
            retryCount: input.retryCount,
            state: input.state,
            updatedAt: nowIso,
          })
          .where(and(eq(jobs.id, id), eq(jobs.leaseOwner, input.leaseOwner)))
          .run();
        if (released.changes !== 1) {
          // Roll the run update back with the transaction. A finished run must
          // not commit while the lease is still held by someone else.
          throw new JobValidationError(`Job ${id} lost its lease while the run was finalized.`);
        }
        const updated = tx.select().from(jobs).where(eq(jobs.id, id)).get();
        return updated ? toJob(updated) : null;
      },
      { behavior: "immediate" },
    );
  }

  async writeLastTick(now: Date): Promise<JobsMeta> {
    const lastTickAt = now.toISOString();
    this.db
      .insert(jobsMeta)
      .values({ id: 1, lastTickAt })
      .onConflictDoUpdate({ target: jobsMeta.id, set: { lastTickAt } })
      .run();
    return { id: 1, lastTickAt: now };
  }
}
