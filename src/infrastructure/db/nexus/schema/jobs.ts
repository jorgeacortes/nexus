import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Stored jobs and their run history. The tick that leases and dispatches them
 * is a later task; this schema only holds the rows.
 *
 * `jobs` is the schedule. `job_runs` is one attempt. `jobs_meta` is a singleton
 * (`id` is constrained to 1) recording when a tick last ran, so a restart can
 * see how long the board went without one.
 *
 * `project_id` and `target_pane_id` are loose pointers, same as the other
 * contexts: no foreign key reaches into `projects` or Herdr.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("schedule"),
    schedule: text("schedule"),
    intervalSeconds: integer("interval_seconds"),
    timezone: text("timezone"),
    prompt: text("prompt").notNull(),
    projectId: text("project_id"),
    targetPaneId: text("target_pane_id"),
    targetMode: text("target_mode").notNull().default("reuse"),
    harness: text("harness"),
    model: text("model"),
    effort: text("effort"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    state: text("state").notNull().default("active"),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(0),
    timeoutSeconds: integer("timeout_seconds"),
    runCount: integer("run_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("jobs_due_idx").on(table.enabled, table.state, table.nextRunAt),
    check("jobs_target_mode_check", sql`${table.targetMode} in ('reuse', 'spawn')`),
    check("jobs_state_check", sql`${table.state} in ('active', 'paused', 'dead')`),
    check(
      "jobs_last_status_check",
      sql`${table.lastStatus} is null or ${table.lastStatus} in ('running', 'ok', 'error', 'timeout')`,
    ),
  ],
);

/** One attempt of a job. History outlives a later edit of the job's prompt. */
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull().default("running"),
    paneId: text("pane_id"),
    leaseOwner: text("lease_owner"),
    prompt: text("prompt"),
    output: text("output"),
    error: text("error"),
  },
  (table) => [
    index("job_runs_job_idx").on(table.jobId),
    check("job_runs_status_check", sql`${table.status} in ('running', 'ok', 'error', 'timeout')`),
  ],
);

/** Singleton tick bookkeeping. The only legal row is `id = 1`. */
export const jobsMeta = sqliteTable(
  "jobs_meta",
  {
    id: integer("id").primaryKey(),
    lastTickAt: text("last_tick_at"),
  },
  (table) => [check("jobs_meta_singleton", sql`${table.id} = 1`)],
);
