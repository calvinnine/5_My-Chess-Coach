import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "@/db/migrate";

/**
 * Deletion is a promise, so this checks the database itself rather than the
 * module that calls it: every table that can hold a person's data must come
 * back empty. A cascade that silently is not enforced would leave games and
 * private notes behind while the API reported success.
 */
let client: Client;
let dbFile: string;

const rows = async (table: string) =>
  Number((await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

beforeEach(async () => {
  dbFile = path.join(os.tmpdir(), `deletion-${crypto.randomUUID()}.db`);
  await runMigrations({ label: dbFile, filePath: dbFile, remote: false });
  client = createClient({ url: `file:${dbFile}` });
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

async function seedPlayer(username: string): Promise<number> {
  const player = await client.execute({
    sql: "INSERT INTO players (username, display_name) VALUES (?, ?) RETURNING id",
    args: [username, username],
  });
  const id = Number((player.rows[0] as unknown as { id: number }).id);

  const game = await client.execute({
    sql: `INSERT INTO games (external_url, player_id, played_at, time_class, time_control,
          rules, rated, player_color, opponent_username, result, pgn)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    args: [`https://chess.com/${username}/1`, id, 1, "rapid", "600", "chess", 1,
           "white", "opponent", "win", "1. e4 e5"],
  });
  const gameId = Number((game.rows[0] as unknown as { id: number }).id);

  const move = await client.execute({
    sql: `INSERT INTO move_analyses (game_id, ply, move_number, color, san, uci,
          fen_before, fen_after, is_player_move) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
    args: [gameId, 1, 1, "white", "e4", "e2e4", "fen1", "fen2", 1],
  });
  const moveId = Number((move.rows[0] as unknown as { id: number }).id);

  await client.execute({
    sql: "INSERT INTO game_reviews (game_id, user_thoughts) VALUES (?, ?)",
    args: [gameId, `${username}만 볼 수 있는 비공개 메모`],
  });
  await client.execute({
    sql: "INSERT INTO player_ratings (player_id, time_class, rating) VALUES (?,?,?)",
    args: [id, "rapid", 800],
  });
  await client.execute({
    sql: `INSERT INTO patterns (player_id, pattern_type, tag, label, description,
          sample_size, occurrence_count, game_count, severity_score, confidence_score,
          status, evidence_game_ids_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [id, "weakness", "t", "label", "desc", 10, 1, 1, 1, 1, "confirmed", "[]"],
  });
  await client.execute({
    sql: "INSERT INTO training_tasks (player_id, title, instruction) VALUES (?,?,?)",
    args: [id, "title", "instruction"],
  });
  await client.execute({
    sql: `INSERT INTO puzzle_attempts (player_id, move_analysis_id, attempt_uci, correct)
          VALUES (?,?,?,?)`,
    args: [id, moveId, "e2e4", 1],
  });
  await client.execute({
    sql: "INSERT INTO sessions (token_hash, player_id, expires_at) VALUES (?,?,?)",
    args: [`hash-${username}`, id, 9_999_999_999],
  });
  return id;
}

const OWNED_TABLES = [
  "games", "move_analyses", "game_reviews", "player_ratings",
  "patterns", "training_tasks", "puzzle_attempts", "sessions",
];

describe("erasing an account", () => {
  it("takes every table that holds the person's data with it", async () => {
    const id = await seedPlayer("alice");
    for (const table of OWNED_TABLES) expect(await rows(table)).toBe(1);

    await client.execute({ sql: "DELETE FROM players WHERE id = ?", args: [id] });

    expect(await rows("players")).toBe(0);
    for (const table of OWNED_TABLES) {
      expect(await rows(table), `${table} still has rows`).toBe(0);
    }
  });

  it("leaves another account untouched", async () => {
    const alice = await seedPlayer("alice");
    await seedPlayer("bob");

    await client.execute({ sql: "DELETE FROM players WHERE id = ?", args: [alice] });

    expect(await rows("players")).toBe(1);
    for (const table of OWNED_TABLES) {
      expect(await rows(table), `${table} lost the other account's rows`).toBe(1);
    }
    const note = await client.execute("SELECT user_thoughts FROM game_reviews");
    expect(note.rows[0].user_thoughts).toContain("bob");
  });

  it("enforces the cascade rather than assuming it", async () => {
    // If foreign keys were off, the delete above would orphan rows instead of
    // removing them, and every check here would pass for the wrong reason.
    const enforced = await client.execute("PRAGMA foreign_keys");
    expect(enforced.rows[0].foreign_keys).toBe(1);
  });
});
