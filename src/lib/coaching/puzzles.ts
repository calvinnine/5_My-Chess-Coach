import { Chess } from "chess.js";
import { toClampedCp, type NormalizedEval } from "@/lib/analysis/eval";

/**
 * Puzzles built from the player's own mistakes.
 *
 * A generic tactics set trains generic tactics. These positions are ones the
 * player actually reached and actually got wrong, which is the difference
 * between practising and revising.
 */

/** How much must have been lost for a position to be worth revisiting. */
export const PUZZLE_MIN_LOSS = 100;
/**
 * The best move must beat the second best by this much. Without it a "puzzle"
 * can have two equally good answers, and marking one of them wrong teaches the
 * player something false.
 */
export const PUZZLE_MIN_MARGIN = 100;
/** Positions already won or lost by this margin are not worth solving. */
export const PUZZLE_MAX_DECIDED_CP = 600;

export interface PuzzleCandidate {
  moveAnalysisId: number;
  gameId: number;
  ply: number;
  moveNumber: number;
  color: "white" | "black";
  fenBefore: string;
  /** What the player actually played. */
  playedUci: string;
  playedSan: string;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  bestLine: string | null;
  centipawnLoss: number | null;
  evalBeforeCp: number | null;
  mateBefore: number | null;
  secondBestCp: number | null;
  themes: string[];
  playedAt: number;
  opponentUsername: string;
}

export interface Puzzle {
  id: number;
  gameId: number;
  ply: number;
  /** Position to solve, with the player to move. */
  fen: string;
  orientation: "white" | "black";
  moveNumber: number;
  /** The move that solves it, in UCI and SAN. */
  solutionUci: string;
  solutionSan: string;
  /** What the player chose at the board, revealed only after an attempt. */
  playedSan: string;
  centipawnLoss: number;
  /** How much better the solution is than the runner-up. */
  marginCp: number;
  themes: string[];
  bestLine: string | null;
  playedAt: number;
  opponentUsername: string;
  prompt: string;
}

const evalOf = (candidate: PuzzleCandidate): NormalizedEval => ({
  cp: candidate.evalBeforeCp,
  mate: candidate.mateBefore,
});

/**
 * Decides whether a mistake makes a fair puzzle.
 *
 * Being wrong is not enough. The position also has to have a findable answer
 * that is clearly the answer, and it must still have something at stake.
 */
export function isPuzzleWorthy(candidate: PuzzleCandidate): boolean {
  if (!candidate.bestMoveUci || !candidate.bestMoveSan) return false;
  // Nothing to find if they already played the best move.
  if (candidate.bestMoveUci === candidate.playedUci) return false;
  if ((candidate.centipawnLoss ?? 0) < PUZZLE_MIN_LOSS) return false;

  // A forced mate for or against changes the exercise; keep those out of the
  // ordinary set rather than mixing two kinds of task.
  if (candidate.mateBefore !== null) return false;

  const before = toClampedCp(evalOf(candidate));
  if (Math.abs(before) >= PUZZLE_MAX_DECIDED_CP) return false;

  if (candidate.secondBestCp === null) return false;
  if (Math.abs(before - candidate.secondBestCp) < PUZZLE_MIN_MARGIN) return false;

  // The stored position must actually be legal and have the player to move.
  try {
    const chess = new Chess(candidate.fenBefore);
    const sideToMove = chess.turn() === "w" ? "white" : "black";
    if (sideToMove !== candidate.color) return false;
    const legal = chess
      .moves({ verbose: true })
      .some(
        (m) =>
          `${m.from}${m.to}${m.promotion ?? ""}` === candidate.bestMoveUci,
      );
    if (!legal) return false;
  } catch {
    return false;
  }

  return true;
}

const THEME_PROMPTS: Record<string, string> = {
  allowed_fork: "이 수 다음에 두 기물이 동시에 공격받았습니다. 그걸 피하는 수는?",
  hanging_piece: "여기서 보호받지 못하는 기물이 생겼습니다. 더 나은 수는?",
  missed_opponent_threat: "상대에게 재료를 얻는 수를 허용했습니다. 그걸 막는 수는?",
  missed_material: "여기서 재료를 얻을 수 있었습니다. 어떤 수일까요?",
  allowed_mate: "이 수 다음에 강제 메이트를 허용했습니다. 버티는 수는?",
  back_rank: "백랭크가 문제가 되는 장면입니다. 더 나은 수는?",
  squandered_advantage: "유리한 흐름을 넘겨준 장면입니다. 우위를 지키는 수는?",
  passive_when_worse: "불리한 상황입니다. 가장 잘 버티는 수는?",
  endgame_technique: "엔드게임에서 갈린 장면입니다. 정확한 수는?",
  only_move_position: "정확한 한 수가 필요한 장면입니다. 어떤 수일까요?",
};

function promptFor(themes: string[]): string {
  for (const theme of themes) {
    const prompt = THEME_PROMPTS[theme];
    if (prompt) return prompt;
  }
  return "이 포지션에서 더 나은 수를 찾아보세요.";
}

export function toPuzzle(candidate: PuzzleCandidate): Puzzle | null {
  if (!isPuzzleWorthy(candidate)) return null;
  const before = toClampedCp(evalOf(candidate));
  return {
    id: candidate.moveAnalysisId,
    gameId: candidate.gameId,
    ply: candidate.ply,
    fen: candidate.fenBefore,
    orientation: candidate.color,
    moveNumber: candidate.moveNumber,
    solutionUci: candidate.bestMoveUci!,
    solutionSan: candidate.bestMoveSan!,
    playedSan: candidate.playedSan,
    centipawnLoss: candidate.centipawnLoss ?? 0,
    marginCp: Math.abs(before - (candidate.secondBestCp ?? before)),
    themes: candidate.themes,
    bestLine: candidate.bestLine,
    playedAt: candidate.playedAt,
    opponentUsername: candidate.opponentUsername,
    prompt: promptFor(candidate.themes),
  };
}

export interface SelectOptions {
  /** Only positions carrying this weakness tag. */
  tag?: string;
  limit?: number;
  /** Move-analysis ids already solved, deprioritised rather than removed. */
  solvedIds?: Set<number>;
}

/**
 * Picks a practice set.
 *
 * Ordered by how much the mistake cost, so revision starts where it mattered
 * most. Positions already solved go to the back rather than disappearing —
 * getting one right once is not the same as having fixed the habit.
 */
export function selectPuzzles(
  candidates: PuzzleCandidate[],
  options: SelectOptions = {},
): Puzzle[] {
  const { tag, limit = 10, solvedIds } = options;
  const puzzles = candidates
    .filter((c) => (tag ? c.themes.includes(tag) : true))
    .map(toPuzzle)
    .filter((p): p is Puzzle => p !== null);

  return puzzles
    .sort((a, b) => {
      const aSolved = solvedIds?.has(a.id) ? 1 : 0;
      const bSolved = solvedIds?.has(b.id) ? 1 : 0;
      if (aSolved !== bSolved) return aSolved - bSolved;
      return b.centipawnLoss - a.centipawnLoss || a.id - b.id;
    })
    .slice(0, limit);
}

/**
 * Grades an attempt.
 *
 * Only the engine's top move is accepted, which is fair precisely because
 * `isPuzzleWorthy` already required a clear margin over the runner-up. Where
 * that margin is thin the position never becomes a puzzle in the first place.
 */
export function gradeAttempt(puzzle: Puzzle, attemptUci: string): boolean {
  return attemptUci === puzzle.solutionUci;
}
