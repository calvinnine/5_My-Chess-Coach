import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { games, moveAnalyses, puzzleAttempts } from "@/db/schema";
import { selectPuzzles, type PuzzleCandidate, type SelectOptions } from "./puzzles";

/**
 * Loads the player's mistakes as puzzle candidates.
 *
 * Only their own moves, only the ones graded as a real error. The heavy
 * filtering (clear best move, still something at stake) lives in `puzzles.ts`
 * so it stays testable without a database.
 */
function loadCandidates(playerId: number): PuzzleCandidate[] {
  const rows = db
    .select({
      moveAnalysisId: moveAnalyses.id,
      gameId: moveAnalyses.gameId,
      ply: moveAnalyses.ply,
      moveNumber: moveAnalyses.moveNumber,
      color: moveAnalyses.color,
      fenBefore: moveAnalyses.fenBefore,
      playedUci: moveAnalyses.uci,
      playedSan: moveAnalyses.san,
      bestMoveUci: moveAnalyses.bestMoveUci,
      bestMoveSan: moveAnalyses.bestMoveSan,
      bestLine: moveAnalyses.bestLine,
      centipawnLoss: moveAnalyses.centipawnLoss,
      evalBeforeCp: moveAnalyses.evalBeforeCp,
      mateBefore: moveAnalyses.mateBefore,
      secondBestCp: moveAnalyses.secondBestCp,
      themesJson: moveAnalyses.themesJson,
      playedAt: games.playedAt,
      opponentUsername: games.opponentUsername,
    })
    .from(moveAnalyses)
    .innerJoin(games, eq(games.id, moveAnalyses.gameId))
    .where(
      and(
        eq(games.playerId, playerId),
        eq(moveAnalyses.isPlayerMove, true),
        inArray(moveAnalyses.classification, ["mistake", "blunder"]),
      ),
    )
    .all();

  return rows.map((row) => {
    let themes: string[] = [];
    try {
      const parsed = row.themesJson ? JSON.parse(row.themesJson) : null;
      themes = (parsed?.themes ?? []).map((t: { tag: string }) => t.tag);
    } catch {
      // A malformed themes blob just means an untagged puzzle.
    }
    return {
      ...row,
      color: row.color as "white" | "black",
      themes,
    };
  });
}

export function solvedIdsFor(playerId: number): Set<number> {
  const rows = db
    .select({ moveAnalysisId: puzzleAttempts.moveAnalysisId })
    .from(puzzleAttempts)
    .where(and(eq(puzzleAttempts.playerId, playerId), eq(puzzleAttempts.correct, true)))
    .all();
  return new Set(rows.map((r) => r.moveAnalysisId));
}

export function getPuzzles(playerId: number, options: SelectOptions = {}) {
  return selectPuzzles(loadCandidates(playerId), {
    ...options,
    solvedIds: options.solvedIds ?? solvedIdsFor(playerId),
  });
}

/** Counts available puzzles per weakness tag, for the training page. */
export function puzzleCountsByTag(playerId: number): Record<string, number> {
  const puzzles = selectPuzzles(loadCandidates(playerId), { limit: Number.MAX_SAFE_INTEGER });
  const counts: Record<string, number> = {};
  for (const puzzle of puzzles) {
    for (const tag of puzzle.themes) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

export function recordAttempt(input: {
  playerId: number;
  moveAnalysisId: number;
  tag: string | null;
  attemptUci: string;
  correct: boolean;
}) {
  db.insert(puzzleAttempts).values(input).run();
}

export interface PuzzleProgress {
  attempts: number;
  solved: number;
  distinctSolved: number;
}

export function progressFor(playerId: number, tag?: string): PuzzleProgress {
  const rows = db
    .select()
    .from(puzzleAttempts)
    .where(
      tag
        ? and(eq(puzzleAttempts.playerId, playerId), eq(puzzleAttempts.tag, tag))
        : eq(puzzleAttempts.playerId, playerId),
    )
    .orderBy(desc(puzzleAttempts.attemptedAt))
    .all();

  return {
    attempts: rows.length,
    solved: rows.filter((r) => r.correct).length,
    distinctSolved: new Set(rows.filter((r) => r.correct).map((r) => r.moveAnalysisId)).size,
  };
}
