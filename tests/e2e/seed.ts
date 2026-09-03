import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate";
import { ALL_VALID_FIXTURES } from "../fixtures/pgn";

export const E2E_DB = path.resolve("./data/e2e.db");

function open(): Client {
  return createClient({ url: `file:${E2E_DB}` });
}

function location() {
  return { label: E2E_DB, filePath: E2E_DB, remote: false };
}

/**
 * Empties the E2E database so every run starts identical.
 *
 * The tables are truncated rather than the file deleted: the dev server under
 * test already holds an open handle, and unlinking the file would leave it
 * writing to a detached inode.
 */
export async function resetDatabase() {
  await runMigrations(location());
  const db = open();
  try {
    const tables = (
      await db.execute(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__migrations'`,
      )
    ).rows.map((r) => r.name as string);
    /*
     * Foreign keys are enforced by default here, so they are turned off while
     * the tables are emptied — the delete order is not something this fixture
     * should have to know. `executeMultiple` is required rather than `batch`:
     * batch wraps its statements in a transaction, and SQLite ignores a
     * `foreign_keys` pragma issued inside one.
     */
    await db.executeMultiple(
      [
        "PRAGMA foreign_keys = OFF",
        ...tables.map((name) => `DELETE FROM "${name}"`),
        "DELETE FROM sqlite_sequence",
        "PRAGMA foreign_keys = ON",
      ].join(";\n") + ";",
    );
  } finally {
    db.close();
  }
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
export async function seedPlayer(options: SeedOptions = {}) {
  const gameCount = options.gameCount ?? 4;
  const db = open();
  const now = Math.floor(Date.now() / 1000);

  try {
    const player = (
      await db.execute({
        sql: `INSERT INTO players (username, display_name, joined_at, created_at)
              VALUES (?, ?, ?, ?) RETURNING id`,
        args: ["testuser", "TestUser", now - 86400 * 365, now],
      })
    ).rows[0] as unknown as { id: number };

    await db.execute({
      sql: `INSERT INTO player_ratings (player_id, time_class, rating, recorded_at)
            VALUES (?,?,?,?)`,
      args: [player.id, "rapid", 1234, now],
    });

    await db.batch(
      Array.from({ length: gameCount }, (_, i) => {
        const fixture = ALL_VALID_FIXTURES[i % ALL_VALID_FIXTURES.length];
        return {
          sql: `INSERT INTO games (
                  external_url, player_id, played_at, time_class, time_control, rules, rated,
                  player_color, player_rating, opponent_username, opponent_rating, result,
                  termination, opening_name, pgn, analysis_status, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
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
          ],
        };
      }),
      "write",
    );

    return { playerId: player.id, gameCount };
  } finally {
    db.close();
  }
}

export async function countGames() {
  const db = open();
  try {
    const row = (await db.execute("SELECT count(*) as c FROM games")).rows[0] as unknown as {
      c: number;
    };
    return row.c;
  } finally {
    db.close();
  }
}
