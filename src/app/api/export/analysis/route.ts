import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games, moveAnalyses, patterns } from "@/db/schema";
import { handleError, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const playerId = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    const rows = await db
      .select()
      .from(games)
      .where(playerId === null ? undefined : eq(games.playerId, playerId))
      .orderBy(desc(games.playedAt));
    const ids = rows.map((r) => r.id);
    const reviews = ids.length
      ? await db.select().from(gameReviews).where(inArray(gameReviews.gameId, ids))
      : [];
    const moves = ids.length
      ? await db
          .select()
          .from(moveAnalyses)
          .where(inArray(moveAnalyses.gameId, ids))
          .orderBy(asc(moveAnalyses.gameId), asc(moveAnalyses.ply))
      : [];

    const payload = {
      exportedAt: new Date().toISOString(),
      games: rows,
      reviews,
      moveAnalyses: moves,
      patterns:
        playerId === null
          ? await db.select().from(patterns)
          : await db.select().from(patterns).where(eq(patterns.playerId, playerId)),
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="chess-coach-analysis.json"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
