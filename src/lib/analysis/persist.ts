import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games, moveAnalyses } from "@/db/schema";
import {
  analysisVersion,
  type AnalysisSettings,
  type AnalyzedMove,
} from "./analyzer";
import { buildReview } from "./review";
import type { Color } from "./eval";

/**
 * Writes one game's analysis, replacing whatever was there before.
 *
 * Shared by the two ways an analysis can arrive: the server-side engine job,
 * and an upload from a browser that ran the engine itself. Both land here with
 * the same already-derived `moves`, so the two paths cannot drift apart in
 * what they store.
 */
export async function persistAnalysis(
  gameId: number,
  game: typeof games.$inferSelect,
  result: {
    moves: AnalyzedMove[];
    engineVersion: string;
    settings: AnalysisSettings;
  },
) {
  const review = buildReview({
    moves: result.moves,
    result: game.result as "win" | "loss" | "draw",
    playerColor: game.playerColor as Color,
    openingName: game.openingName,
    termination: game.termination,
  });

  const version = analysisVersion(result.engineVersion, result.settings);
  const [existingReview] = await db
    .select({ userThoughts: gameReviews.userThoughts, userPostmortem: gameReviews.userPostmortem })
    .from(gameReviews)
    .where(eq(gameReviews.gameId, gameId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx.delete(moveAnalyses).where(eq(moveAnalyses.gameId, gameId));
    for (const move of result.moves) {
      await tx.insert(moveAnalyses).values({
        gameId,
        ply: move.ply,
        moveNumber: move.moveNumber,
        color: move.color,
        san: move.san,
        uci: move.uci,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        evalBeforeCp: move.evalBefore.cp,
        evalAfterCp: move.evalAfter.cp,
        mateBefore: move.evalBefore.mate,
        mateAfter: move.evalAfter.mate,
        bestMoveUci: move.bestMoveUci,
        bestMoveSan: move.bestMoveSan,
        bestLine: move.bestLine,
        secondBestCp: move.secondBestCp,
        centipawnLoss: move.centipawnLoss,
        classification: move.classification,
        themesJson: JSON.stringify({ themes: move.themes, strengths: move.strengths }),
        clockMs: move.clockMs,
        phase: move.phase,
        isPlayerMove: move.isPlayerMove,
      });
    }

    await tx
      .insert(gameReviews)
      .values({
        gameId,
        turningPointsJson: JSON.stringify(review.turningPoints),
        strengthsJson: JSON.stringify(review.strengths),
        openingSummary: review.openingSummary,
        middlegameSummary: review.middlegameSummary,
        endgameSummary: review.endgameSummary,
        timeSummary: review.timeSummary,
        overallSummary: review.overallSummary,
        checklistJson: JSON.stringify(review.checklist),
        reflectionQuestion: review.reflectionQuestion,
        // User-written notes survive re-analysis.
        userThoughts: existingReview?.userThoughts ?? null,
        userPostmortem: existingReview?.userPostmortem ?? null,
        generatedBy: "rules",
      })
      .onConflictDoUpdate({
        target: gameReviews.gameId,
        set: {
          turningPointsJson: JSON.stringify(review.turningPoints),
          strengthsJson: JSON.stringify(review.strengths),
          openingSummary: review.openingSummary,
          middlegameSummary: review.middlegameSummary,
          endgameSummary: review.endgameSummary,
          timeSummary: review.timeSummary,
          overallSummary: review.overallSummary,
          checklistJson: JSON.stringify(review.checklist),
          reflectionQuestion: review.reflectionQuestion,
          generatedBy: "rules",
        },
      });

    await tx
      .update(games)
      .set({ analysisStatus: "completed", analysisVersion: version, analysisError: null })
      .where(eq(games.id, gameId));
  });
}
