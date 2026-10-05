CREATE TABLE `dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`workspace_id` text,
	`tab_id` text,
	`pane_id` text,
	`agent_name` text,
	`harness` text,
	`lease_owner` text NOT NULL,
	`lease_until` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`outcome` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dispatches_task_idx` ON `dispatches` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dispatches_open_task_idx` ON `dispatches` (`task_id`) WHERE "dispatches"."ended_at" is null;