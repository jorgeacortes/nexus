CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`pane_id` text,
	`lease_owner` text,
	`prompt` text,
	`output` text,
	`error` text,
	CONSTRAINT "job_runs_status_check" CHECK("job_runs"."status" in ('running', 'ok', 'error', 'timeout'))
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'schedule' NOT NULL,
	`schedule` text,
	`interval_seconds` integer,
	`timezone` text,
	`prompt` text NOT NULL,
	`project_id` text,
	`target_pane_id` text,
	`target_mode` text DEFAULT 'reuse' NOT NULL,
	`harness` text,
	`model` text,
	`effort` text,
	`enabled` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`last_status` text,
	`last_error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 0 NOT NULL,
	`timeout_seconds` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "jobs_target_mode_check" CHECK("jobs"."target_mode" in ('reuse', 'spawn')),
	CONSTRAINT "jobs_state_check" CHECK("jobs"."state" in ('active', 'paused', 'dead')),
	CONSTRAINT "jobs_last_status_check" CHECK("jobs"."last_status" is null or "jobs"."last_status" in ('running', 'ok', 'error', 'timeout'))
);
--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`enabled`,`state`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `jobs_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_tick_at` text,
	CONSTRAINT "jobs_meta_singleton" CHECK("jobs_meta"."id" = 1)
);
