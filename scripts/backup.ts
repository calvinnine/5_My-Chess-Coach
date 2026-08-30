import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = path.resolve(process.env.CHESS_COACH_DB ?? "./data/chess-coach.db");
if (!fs.existsSync(dbPath)) {
  console.error(`데이터베이스가 없습니다: ${dbPath}`);
  process.exit(1);
}
const dir = path.join(path.dirname(dbPath), "backups");
fs.mkdirSync(dir, { recursive: true });
const target = path.join(
  dir,
  `chess-coach-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);
const sqlite = new Database(dbPath, { readonly: true });
sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
sqlite.close();
console.log(`백업 완료: ${target} (${fs.statSync(target).size} bytes)`);
