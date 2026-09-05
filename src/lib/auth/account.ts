import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { players, syncCache, verificationChallenges } from "@/db/schema";

export interface DeletionSummary {
  games: number;
  moveAnalyses: number;
  reviews: number;
  puzzleAttempts: number;
}

/**
 * Escapes a value for use inside a LIKE pattern.
 *
 * `_` matches any single character in LIKE, and Chess.com handles may contain
 * one — without this, deleting `foo_bar` would also sweep away `foo1bar`'s
 * cached validators.
 */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** What the account holds, counted before it goes. */
async function countOwned(playerId: number): Promise<DeletionSummary> {
  const one = async (query: string) => {
    const rows = await db.all<{ n: number }>(sql.raw(query));
    return Number(rows[0]?.n ?? 0);
  };
  return {
    games: await one(`SELECT count(*) AS n FROM games WHERE player_id = ${playerId}`),
    moveAnalyses: await one(
      `SELECT count(*) AS n FROM move_analyses
       WHERE game_id IN (SELECT id FROM games WHERE player_id = ${playerId})`,
    ),
    reviews: await one(
      `SELECT count(*) AS n FROM game_reviews
       WHERE game_id IN (SELECT id FROM games WHERE player_id = ${playerId})`,
    ),
    puzzleAttempts: await one(
      `SELECT count(*) AS n FROM puzzle_attempts WHERE player_id = ${playerId}`,
    ),
  };
}

/**
 * Erases an account and everything belonging to it.
 *
 * Most tables hang off `players` with `ON DELETE CASCADE`, so removing the one
 * row takes the games, analyses, reviews, notes, patterns, tasks, puzzle
 * attempts and sessions with it. Two do not, and are cleared by hand:
 *
 *  - `verification_challenges` is keyed by username, not by player id
 *  - `sync_cache` is keyed by request URL
 *
 * Missing either would leave the account partly behind, which is exactly what
 * a deletion promise must not do.
 */
export async function deleteAccount(
  playerId: number,
  username: string,
): Promise<DeletionSummary> {
  const summary = await countOwned(playerId);

  await db.delete(verificationChallenges).where(eq(verificationChallenges.username, username));
  await db.delete(syncCache).where(
    sql`${syncCache.url} LIKE ${`%/player/${likeLiteral(username)}%`} ESCAPE '\\'`,
  );
  await db.delete(players).where(eq(players.id, playerId));

  return summary;
}
