CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`folder_path` text,
	`herdr_workspace_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`assignee` text,
	`agent_name` text,
	`harness` text,
	`model` text,
	`effort` text,
	`herdr_pane_id` text,
	`needs_human` integer DEFAULT false NOT NULL,
	`needs_human_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_status_updated_idx` ON `tasks` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_needs_human_idx` ON `tasks` (`needs_human`);--> statement-breakpoint
CREATE INDEX `tasks_herdr_pane_idx` ON `tasks` (`herdr_pane_id`);