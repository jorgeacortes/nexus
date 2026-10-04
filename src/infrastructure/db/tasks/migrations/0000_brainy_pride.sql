CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`agent_id` text,
	`agent_name` text,
	`project_id` text,
	`needs_human` integer DEFAULT false NOT NULL,
	`blocked_reason` text,
	`herdr_pane_id` text,
	`herdr_tab_id` text,
	`herdr_workspace_id` text,
	`due_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_status_updated_idx` ON `tasks` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_agent_idx` ON `tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `tasks_needs_human_idx` ON `tasks` (`needs_human`);