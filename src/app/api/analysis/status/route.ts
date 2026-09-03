import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { games } from "@/db/schema";
import { getJobState } from "@/lib/analysis/job";
import { requirePlayer } from "@/lib/auth/session";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Queue figures are per-account; a global count would leak other users.
    const player = await requirePlayer();
    const [counts, failedGames] = await Promise.all([
      db
        .select({ status: games.analysisStatus, count: sql<number>`count(*)` })
        .from(games)
        .where(eq(games.playerId, player.playerId))
        .groupBy(games.analysisStatus),
      db
        .select({ id: games.id, error: games.analysisError })
        .from(games)
        .where(and(eq(games.playerId, player.playerId), eq(games.analysisStatus, "failed")))
        .limit(20),
    ]);
    return ok({
      job: getJobState(),
      queue: Object.fromEntries(counts.map((c) => [c.status, c.count])),
      failedGames,
    });
  } catch (err) {
    return handleError(err);
  }
}
