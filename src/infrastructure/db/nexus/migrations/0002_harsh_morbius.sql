ALTER TABLE `tasks` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_priority_updated_idx` ON `tasks` (`priority`,`updated_at`);