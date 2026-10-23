ALTER TABLE `events` ADD `local_session_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `local_sequence` integer DEFAULT 0 NOT NULL;