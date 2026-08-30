import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Applies every drizzle-kit SQL file in order and records what ran.
 * Safe to call repeatedly; each file is applied at most once.
 */
export function runMigrations(dbPath: string, migrationsDir = "./drizzle") {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS __migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const dir = path.resolve(migrationsDir);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    : [];

  const applied = new Set(
    sqlite
      .prepare("SELECT name FROM __migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    // drizzle-kit separates statements with this breakpoint marker.
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement);
      sqlite
        .prepare("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)")
        .run(file, Math.floor(Date.now() / 1000));
    })();
    ran.push(file);
  }

  sqlite.close();
  return { ran, total: files.length };
}
