CREATE INDEX IF NOT EXISTS `entries_guest_completed` ON `entries` (`event_id`,`guest_hash`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `artist_login_attempts` (
  `fingerprint` text PRIMARY KEY NOT NULL,
  `window` integer NOT NULL,
  `attempts` integer NOT NULL
);
