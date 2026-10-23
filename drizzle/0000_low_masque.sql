CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`track_id` text NOT NULL,
	`name` text NOT NULL,
	`guest_hash` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_event` ON `entries` (`event_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`queue_open` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`mode` text DEFAULT 'album' NOT NULL,
	`pending_mode` text,
	`mic_after_track` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`current_track` text,
	`current_entry` text,
	`album_cursor` text,
	`started_at` integer,
	`position` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`controller_hash` text,
	`controller_until` integer
);
--> statement-breakpoint
CREATE INDEX `events_owner` ON `events` (`owner_id`);--> statement-breakpoint
CREATE TABLE `subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`consent` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriber_unique` ON `subscribers` (`event_id`,`email`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`duration` real DEFAULT 0 NOT NULL,
	`beat_duration` real,
	`audio_key` text NOT NULL,
	`beat_key` text,
	`mime` text NOT NULL,
	`beat_mime` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tracks_event` ON `tracks` (`event_id`,`position`);