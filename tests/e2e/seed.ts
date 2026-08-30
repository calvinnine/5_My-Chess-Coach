import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrate";
import { ALL_VALID_FIXTURES } from "../fixtures/pgn";

export const E2E_DB = path.resolve("./data/e2e.db");

/**
 * Empties the E2E database so every run starts identical.
 *
 * The tables are truncated rather than the file deleted: the dev server under
 * test already holds an open handle, and unlinking the file would leave it
 * writing to a detached inode.
 */
export function resetDatabase() {
  runMigrations(E2E_DB);
  const db = new Database(E2E_DB);
  db.pragma("foreign_keys = OFF");
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__migrations'`,
    )
    .all() as Array<{ name: string }>;
  db.transaction(() => {
    for (const { name } of tables) db.prepare(`DELETE FROM "${name}"`).run();
    db.prepare("DELETE FROM sqlite_sequence").run();
  })();
  db.pragma("foreign_keys = ON");
  db.close();
}

export interface SeedOptions {
  /** How many games to insert. Fixtures repeat once exhausted. */
  gameCount?: number;
}

/**
 * Inserts a player and some already-parsed games, without going near the
 * Chess.com API. Games are left `pending` so the analysis flow can be driven
 * from the UI.
 */
export function seedPlayer(options: SeedOptions = {}) {
  const gameCount = options.gameCount ?? 4;
  const db = new Database(E2E_DB);
  const now = Math.floor(Date.now() / 1000);

  const player = db
    .prepare(
      `INSERT INTO players (username, display_name, joined_at, created_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get("testuser", "TestUser", now - 86400 * 365, now) as { id: number };

  db.prepare(
    `INSERT INTO player_ratings (player_id, time_class, rating, recorded_at) VALUES (?,?,?,?)`,
  ).run(player.id, "rapid", 1234, now);

  const insert = db.prepare(
    `INSERT INTO games (
       external_url, player_id, played_at, time_class, time_control, rules, rated,
       player_color, player_rating, opponent_username, opponent_rating, result,
       termination, opening_name, pgn, analysis_status, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  for (let i = 0; i < gameCount; i++) {
    const fixture = ALL_VALID_FIXTURES[i % ALL_VALID_FIXTURES.length];
    insert.run(
      `https://www.chess.com/game/live/e2e-${i}`,
      player.id,
      now - i * 3600,
      "rapid",
      "600",
      "chess",
      1,
      i % 2 === 0 ? "white" : "black",
      1234,
      `opponent${i}`,
      1200 + i,
      i % 3 === 0 ? "loss" : "win",
      "체크메이트",
      `Test Opening ${i % 2}`,
      fixture.pgn,
      "pending",
      now,
    );
  }

  db.close();
  return { playerId: player.id, gameCount };
}

export function countGames() {
  const db = new Database(E2E_DB, { readonly: true });
  const row = db.prepare("SELECT count(*) as c FROM games").get() as { c: number };
  db.close();
  return row.c;
}
