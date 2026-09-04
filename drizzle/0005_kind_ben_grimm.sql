CREATE TABLE `sync_leases` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder_player_id` integer,
	`acquired_at` integer,
	`expires_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `sync_leases` (`id`, `expires_at`) VALUES (1, 0);
