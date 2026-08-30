import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "@/db/client";
import { sql } from "drizzle-orm";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");

export async function GET() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, sizeBytes: stat.size, createdAt: stat.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return ok({ directory: BACKUP_DIR, backups: files });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, `chess-coach-${stamp}.db`);
    // SQLite's own backup: consistent even with WAL pages outstanding.
    db.run(sql.raw(`VACUUM INTO '${target.replace(/'/g, "''")}'`));
    const stat = fs.statSync(target);
    return ok({ file: path.basename(target), path: target, sizeBytes: stat.size });
  } catch (err) {
    return handleError(err);
  }
}
