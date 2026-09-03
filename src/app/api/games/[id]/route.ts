import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games, moveAnalyses } from "@/db/schema";
import { formatEval, toWhitePerspective, type Color } from "@/lib/analysis/eval";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const gameId = Number(id);
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) return fail("게임을 찾을 수 없습니다.", 404);

    const [moves, [review]] = await Promise.all([
      db
        .select()
        .from(moveAnalyses)
        .where(eq(moveAnalyses.gameId, gameId))
        .orderBy(asc(moveAnalyses.ply)),
      db.select().from(gameReviews).where(eq(gameReviews.gameId, gameId)).limit(1),
    ]);
    const playerColor = game.playerColor as Color;

    return ok({
      game: {
        ...game,
        ratingDiff:
          game.playerRating !== null && game.opponentRating !== null
            ? game.playerRating - game.opponentRating
            : null,
      },
      moves: moves.map((m) => {
        const playerEvalBefore = { cp: m.evalBeforeCp, mate: m.mateBefore };
        const playerEvalAfter = { cp: m.evalAfterCp, mate: m.mateAfter };
        let themes: unknown = { themes: [], strengths: [] };
        try {
          themes = m.themesJson ? JSON.parse(m.themesJson) : themes;
        } catch {
          /* keep the default */
        }
        return {
          ply: m.ply,
          moveNumber: m.moveNumber,
          color: m.color,
          san: m.san,
          uci: m.uci,
          fenBefore: m.fenBefore,
          fenAfter: m.fenAfter,
          evalBeforeText: formatEval(playerEvalBefore),
          evalAfterText: formatEval(playerEvalAfter),
          // Graph uses the conventional white-positive axis.
          evalAfterWhiteCp: toWhitePerspective(playerEvalAfter, playerColor).cp,
          evalAfterWhiteMate: toWhitePerspective(playerEvalAfter, playerColor).mate,
          evalAfterPlayerCp: m.evalAfterCp,
          bestMoveSan: m.bestMoveSan,
          bestMoveUci: m.bestMoveUci,
          bestLine: m.bestLine,
          centipawnLoss: m.centipawnLoss,
          classification: m.classification,
          clockMs: m.clockMs,
          phase: m.phase,
          isPlayerMove: m.isPlayerMove,
          themes,
        };
      }),
      review: review
        ? {
            ...review,
            turningPoints: safeParse(review.turningPointsJson, []),
            strengths: safeParse(review.strengthsJson, []),
            checklist: safeParse(review.checklistJson, []),
          }
        : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
