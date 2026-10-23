CREATE TABLE `track_plays` (
	`event_id` text NOT NULL,
	`playback_id` text NOT NULL,
	`track_id` text NOT NULL,
	`kind` text NOT NULL,
	`played_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `playback_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `track_plays_event_track` ON `track_plays` (`event_id`,`track_id`);