ALTER TABLE `tasks` ADD `archived_at` text;--> statement-breakpoint
CREATE INDEX `tasks_status_completed_idx` ON `tasks` (`status`,`completed_at`);--> statement-breakpoint
CREATE INDEX `tasks_archived_at_idx` ON `tasks` (`archived_at`);