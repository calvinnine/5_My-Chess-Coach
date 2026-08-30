ALTER TABLE `games` ADD `opponent_kind` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
CREATE INDEX `games_opponent_kind_idx` ON `games` (`player_id`,`opponent_kind`);--> statement-breakpoint
/*
 Backfill rows stored before this column existed. Chess.com marks non-human
 games in the PGN Event header; usernames are unreliable because real players
 are called things like "coachc12".
*/
UPDATE `games` SET `opponent_kind` = 'coach'
  WHERE `pgn` LIKE '%[Event "Play vs Coach"]%';--> statement-breakpoint
UPDATE `games` SET `opponent_kind` = 'bot'
  WHERE `pgn` LIKE '%[Event "Computer opponent"]%';--> statement-breakpoint
UPDATE `games` SET `analysis_status` = 'skipped',
                   `analysis_error` = '코치·봇 연습 게임은 분석 대상에서 제외합니다.'
  WHERE `opponent_kind` <> 'human' AND `analysis_status` IN ('pending', 'failed');
