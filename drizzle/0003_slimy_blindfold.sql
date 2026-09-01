CREATE TABLE `puzzle_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`move_analysis_id` integer NOT NULL,
	`tag` text,
	`attempt_uci` text NOT NULL,
	`correct` integer NOT NULL,
	`attempted_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`move_analysis_id`) REFERENCES `move_analyses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `puzzle_attempts_player_idx` ON `puzzle_attempts` (`player_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `puzzle_attempts_move_idx` ON `puzzle_attempts` (`move_analysis_id`);