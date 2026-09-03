import { and, desc, eq, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games } from "@/db/schema";
import { requireOwnPlayer } from "@/lib/auth/session";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams;
    const filters: SQL[] = [];

    /*
     * Not optional and not caller-supplied: the list is always the caller's own
     * games, whatever playerId the query string asks for.
     */
    const requested = q.get("playerId");
    const playerId = await requireOwnPlayer(requested ? Number(requested) : null);
    filters.push(eq(games.playerId, playerId));

    const result = q.get("result");
    if (result && result !== "all") filters.push(eq(games.result, result));

    const color = q.get("color");
    if (color && color !== "all") filters.push(eq(games.playerColor, color));

    const timeClass = q.get("timeClass");
    if (timeClass && timeClass !== "all") filters.push(eq(games.timeClass, timeClass));

    const opponent = q.get("opponent");
    if (opponent === "human") filters.push(eq(games.opponentKind, "human"));
    if (opponent === "practice") filters.push(ne(games.opponentKind, "human"));

    const analysis = q.get("analysis");
    if (analysis === "analyzed") filters.push(eq(games.analysisStatus, "completed"));
    if (analysis === "unanalyzed")
      filters.push(inArray(games.analysisStatus, ["pending", "failed", "running"]));

    const from = q.get("from");
    if (from) filters.push(gte(games.playedAt, Number(from)));
    const to = q.get("to");
    if (to) filters.push(lte(games.playedAt, Number(to)));

    const limit = Math.min(Number(q.get("limit") ?? 100), 500);

    const rows = await db
      .select()
      .from(games)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(games.playedAt))
      .limit(limit);

    const reviewIds = rows.map((r) => r.id);
    const reviews = reviewIds.length
      ? await db
          .select({ gameId: gameReviews.gameId, overallSummary: gameReviews.overallSummary })
          .from(gameReviews)
          .where(inArray(gameReviews.gameId, reviewIds))
      : [];
    const summaryById = new Map(reviews.map((r) => [r.gameId, r.overallSummary]));

    return ok({
      games: rows.map((row) => ({
        id: row.id,
        externalUrl: row.externalUrl,
        playedAt: row.playedAt,
        timeClass: row.timeClass,
        timeControl: row.timeControl,
        rated: row.rated,
        rules: row.rules,
        opponentKind: row.opponentKind,
        playerColor: row.playerColor,
        playerRating: row.playerRating,
        opponentUsername: row.opponentUsername,
        opponentRating: row.opponentRating,
        ratingDiff:
          row.playerRating !== null && row.opponentRating !== null
            ? row.playerRating - row.opponentRating
            : null,
        result: row.result,
        termination: row.termination,
        openingName: row.openingName,
        ecoCode: row.ecoCode,
        chesscomAccuracy: row.chesscomAccuracy,
        analysisStatus: row.analysisStatus,
        analysisError: row.analysisError,
        summary: summaryById.get(row.id) ?? null,
      })),
      total: rows.length,
    });
  } catch (err) {
    return handleError(err);
  }
}
