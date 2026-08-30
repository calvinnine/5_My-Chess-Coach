import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { games } from "@/db/schema";
import { getJobState } from "@/lib/analysis/job";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const counts = db
      .select({ status: games.analysisStatus, count: sql<number>`count(*)` })
      .from(games)
      .groupBy(games.analysisStatus)
      .all();
    return ok({
      job: getJobState(),
      queue: Object.fromEntries(counts.map((c) => [c.status, c.count])),
      failedGames: db
        .select({ id: games.id, error: games.analysisError })
        .from(games)
        .where(eq(games.analysisStatus, "failed"))
        .limit(20)
        .all(),
    });
  } catch (err) {
    return handleError(err);
  }
}
