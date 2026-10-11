import type { Job, JobRun, JobRunStatus, JobState, JobsMeta } from "@/domain/jobs/job";

/**
 * What an expired lease becomes. The use case decides; the repository only
 * writes the patch, and only if the lease is still expired (`changes() === 1`).
 * `nextRunAt` is intentionally absent: reaping releases the row, it does not
 * reschedule it.
 */
export type ReapPatch = {
  /** Close any `running` attempt for this job as `timeout`. */
  closeRunning: boolean;
  runError: string | null;
  state: JobState;
  retryCount: number;
  lastStatus: JobRunStatus | null;
  lastError: string | null;
  lastRunAt: Date | null;
};

export type ClaimJobInput = {
  now: Date;
  leaseOwner: string;
  leaseUntil: Date;
  prompt: string;
};

export type ClaimedJob = {
  job: Job;
  run: JobRun;
};

/** The second, short transaction after a dispatch attempt returns. */
export type FinalizeJobInput = {
  now: Date;
  leaseOwner: string;
  runId: string;
  status: "ok" | "error";
  paneId: string | null;
  error: string | null;
  nextRunAt: Date | null;
  state: JobState;
  retryCount: number;
  lastError: string | null;
};

export interface JobRepository {
  insert(job: Job): Promise<Job>;
  update(job: Job): Promise<Job>;
  insertRun(run: JobRun): Promise<JobRun>;
  findById(id: string): Promise<Job | null>;
  runsFor(jobId: string): Promise<JobRun[]>;
  readMeta(): Promise<JobsMeta | null>;

  /**
   * Due rows: enabled, active, `next_run_at <= now`, and no unexpired lease.
   * Oldest `next_run_at` first, `id` breaking a tie.
   */
  selectDue(now: Date, limit: number): Promise<Job[]>;

  /**
   * One transaction: every job whose lease has expired. `decide` runs inside
   * the transaction and must not touch the database.
   */
  reapExpired(now: Date, decide: (job: Job, hasRunning: boolean) => ReapPatch): Promise<string[]>;

  /**
   * One transaction: conditional lease update (`changes() === 1`) and a new
   * `running` row. Returns null when another writer owns the job.
   */
  claim(id: string, input: ClaimJobInput): Promise<ClaimedJob | null>;

  /**
   * One transaction: finish the running row and release the lease, only while
   * this owner still holds it. Returns null when the lease was lost.
   */
  finalize(id: string, input: FinalizeJobInput): Promise<Job | null>;

  /** Upserts the singleton `jobs_meta` row (`id = 1`). */
  writeLastTick(now: Date): Promise<JobsMeta>;
}
