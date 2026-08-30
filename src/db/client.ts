import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DB_PATH = path.resolve(
  process.env.CHESS_COACH_DB ?? "./data/chess-coach.db",
);

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

// Next.js dev server re-evaluates modules on every hot reload; keep one handle.
const globalForDb = globalThis as unknown as {
  __chessCoachSqlite?: Database.Database;
};

export const sqlite = globalForDb.__chessCoachSqlite ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__chessCoachSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
