import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { resolveLocation, type DbLocation } from "./location";

/**
 * Applies every drizzle-kit SQL file in order and records what ran.
 * Safe to call repeatedly; each file is applied at most once.
 *
 * `sourceAvailable` says whether the migration files were there to read at
 * all. A deployed serverless bundle does not carry the `drizzle` directory, so
 * without this the caller cannot tell "already up to date" from "there was
 * nothing to look at" — and the schema silently stays behind.
 */
export async function runMigrations(
  location: DbLocation = resolveLocation(),
  migrationsDir = "./drizzle",
) {
  let client: Client;
  if (location.remote) {
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!authToken) throw new Error("TURSO_AUTH_TOKEN이 필요합니다.");
    client = createClient({ url: location.label, authToken });
  } else {
    const filePath = location.filePath!;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    client = createClient({ url: `file:${filePath}` });
    /*
     * Journal mode is a property of the file, so setting it once here is enough
     * for every connection that opens it later. WAL lets the analysis job write
     * while the server reads.
     */
    await client.execute("PRAGMA journal_mode = WAL");
  }

  try {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS __migrations (
         name TEXT PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`,
    );

    const dir = path.resolve(migrationsDir);
    const sourceAvailable = fs.existsSync(dir);
    const files = sourceAvailable
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      : [];

    const applied = new Set(
      (await client.execute("SELECT name FROM __migrations")).rows.map(
        (r) => r.name as string,
      ),
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
      // One batch per file, so a half-applied migration is never recorded.
      await client.batch(
        [
          ...statements,
          {
            sql: "INSERT INTO __migrations (name, applied_at) VALUES (?, ?)",
            args: [file, Math.floor(Date.now() / 1000)],
          },
        ],
        "write",
      );
      ran.push(file);
    }

    return { ran, total: files.length, sourceAvailable };
  } finally {
    client.close();
  }
}
