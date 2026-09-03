import { sql } from "drizzle-orm";
import { db, dbLocation } from "@/db/client";
import { locateEngine } from "@/lib/engine/locate";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { authRequired } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stays reachable without a session: the page has to know, before anyone signs
 * in, whether an engine exists server-side and therefore whether analysis will
 * run here or in the browser.
 *
 * On a deployment that is all it says. Filesystem paths and the table list are
 * infrastructure detail with no reason to be public.
 */
export async function GET() {
  try {
    const engine = locateEngine(await getSetting(SETTING_KEYS.stockfishPath));

    if (authRequired()) {
      return ok({
        status: "ok",
        database: { remote: dbLocation.remote },
        engine: { found: engine.found },
        timestamp: new Date().toISOString(),
      });
    }

    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    return ok({
      status: "ok",
      database: {
        location: dbLocation.label,
        remote: dbLocation.remote,
        tables: tables.map((t) => t.name),
      },
      engine,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
