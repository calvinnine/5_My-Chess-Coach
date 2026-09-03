import fs from "node:fs";
import path from "node:path";
import { client, dbLocation } from "@/db/client";
import { requirePlayer } from "@/lib/auth/session";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Backups are a local-database feature. A hosted database has no filesystem we
 * can write a copy to that would still be there afterwards, so rather than
 * writing a file that quietly disappears, this endpoint says so.
 */
const BACKUP_DIR = dbLocation.filePath
  ? path.join(path.dirname(dbLocation.filePath), "backups")
  : null;

const REMOTE_NOTE =
  "호스팅 데이터베이스는 이 방식으로 백업할 수 없습니다. Turso 쪽 백업을 사용하세요.";

export async function GET() {
  try {
    await requirePlayer();
    if (!BACKUP_DIR) return fail(REMOTE_NOTE, 409);
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
    await requirePlayer();
    if (!BACKUP_DIR) return fail(REMOTE_NOTE, 409);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, `chess-coach-${stamp}.db`);
    // SQLite's own backup: consistent even with WAL pages outstanding.
    await client.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const stat = fs.statSync(target);
    return ok({ file: path.basename(target), path: target, sizeBytes: stat.size });
  } catch (err) {
    return handleError(err);
  }
}
