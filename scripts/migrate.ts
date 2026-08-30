import path from "node:path";
import { runMigrations } from "../src/db/migrate";

const dbPath = path.resolve(process.env.CHESS_COACH_DB ?? "./data/chess-coach.db");
const { ran, total } = runMigrations(dbPath);
console.log(
  ran.length
    ? `Applied ${ran.length}/${total} migration(s) to ${dbPath}:\n  ${ran.join("\n  ")}`
    : `Database at ${dbPath} is up to date (${total} migration(s) on record).`,
);
