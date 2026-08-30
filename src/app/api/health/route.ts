import { sql } from "drizzle-orm";
import { db, DB_PATH } from "@/db/client";
import { locateEngine } from "@/lib/engine/locate";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tables = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const engine = locateEngine(getSetting(SETTING_KEYS.stockfishPath));
    return ok({
      status: "ok",
      database: { path: DB_PATH, tables: tables.map((t) => t.name) },
      engine,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
