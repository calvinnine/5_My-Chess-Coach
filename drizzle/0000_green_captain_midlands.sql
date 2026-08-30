CREATE TABLE `game_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`turning_points_json` text,
	`strengths_json` text,
	`opening_summary` text,
	`middlegame_summary` text,
	`endgame_summary` text,
	`time_summary` text,
	`overall_summary` text,
	`checklist_json` text,
	`reflection_question` text,
	`user_thoughts` text,
	`user_postmortem` text,
	`generated_by` text DEFAULT 'rules' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_reviews_game_idx` ON `game_reviews` (`game_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_url` text NOT NULL,
	`player_id` integer NOT NULL,
	`played_at` integer NOT NULL,
	`time_class` text NOT NULL,
	`time_control` text NOT NULL,
	`rules` text DEFAULT 'chess' NOT NULL,
	`rated` integer DEFAULT true NOT NULL,
	`player_color` text NOT NULL,
	`player_rating` integer,
	`opponent_username` text NOT NULL,
	`opponent_rating` integer,
	`result` text NOT NULL,
	`termination` text,
	`eco_code` text,
	`opening_name` text,
	`pgn` text NOT NULL,
	`final_fen` text,
	`chesscom_accuracy` real,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`analysis_version` text,
	`analysis_error` text,
	`parse_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_external_url_idx` ON `games` (`external_url`);--> statement-breakpoint
CREATE INDEX `games_player_played_idx` ON `games` (`player_id`,`played_at`);--> statement-breakpoint
CREATE INDEX `games_status_idx` ON `games` (`analysis_status`);--> statement-breakpoint
CREATE TABLE `move_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`ply` integer NOT NULL,
	`move_number` integer NOT NULL,
	`color` text NOT NULL,
	`san` text NOT NULL,
	`uci` text NOT NULL,
	`fen_before` text NOT NULL,
	`fen_after` text NOT NULL,
	`eval_before_cp` integer,
	`eval_after_cp` integer,
	`mate_before` integer,
	`mate_after` integer,
	`best_move_uci` text,
	`best_move_san` text,
	`best_line` text,
	`second_best_cp` integer,
	`centipawn_loss` integer,
	`classification` text,
	`themes_json` text,
	`clock_ms` integer,
	`phase` text,
	`is_player_move` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `move_analyses_game_ply_idx` ON `move_analyses` (`game_id`,`ply`);--> statement-breakpoint
CREATE INDEX `move_analyses_game_idx` ON `move_analyses` (`game_id`);--> statement-breakpoint
CREATE TABLE `patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`pattern_type` text NOT NULL,
	`tag` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`sample_size` integer NOT NULL,
	`occurrence_count` integer NOT NULL,
	`game_count` integer NOT NULL,
	`distinct_openings` integer DEFAULT 0 NOT NULL,
	`severity_score` real NOT NULL,
	`confidence_score` real NOT NULL,
	`status` text NOT NULL,
	`evidence_game_ids_json` text NOT NULL,
	`evidence_json` text,
	`period_start` integer,
	`period_end` integer,
	`computed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patterns_player_idx` ON `patterns` (`player_id`,`pattern_type`);--> statement-breakpoint
CREATE TABLE `player_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`time_class` text NOT NULL,
	`rating` integer NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_ratings_player_idx` ON `player_ratings` (`player_id`,`time_class`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`joined_at` integer,
	`last_synced_at` integer,
	`last_synced_month` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_username_idx` ON `players` (`username`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_cache_url_idx` ON `sync_cache` (`url`);--> statement-breakpoint
CREATE TABLE `training_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`pattern_id` integer,
	`pattern_tag` text,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`target_count` integer,
	`target_minutes` integer,
	`completion_criteria` text,
	`due_date` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_tasks_player_idx` ON `training_tasks` (`player_id`,`status`);