import type { RawScore } from "@/lib/engine/types";

export type Color = "white" | "black";

/** Centipawn stand-in for a forced mate, used only for ordering and clamping. */
export const MATE_CP = 10_000;
/** Anything beyond this is "already decided"; losses there are not dramatised. */
export const DECIDED_CP = 600;
/** Evaluations are clamped before differencing so +30 -> +9 is not a "blunder". */
export const CLAMP_CP = 1000;

export interface NormalizedEval {
  /** Centipawns from the registered player's perspective. Null only if unknown. */
  cp: number | null;
  /** Mate distance from the player's perspective. Positive = player mates. */
  mate: number | null;
}

/**
 * Stockfish reports scores relative to the side to move. This converts to a
 * fixed perspective: positive always means good for `player`.
 */
export function toPlayerPerspective(
  score: RawScore,
  sideToMove: Color,
  player: Color,
): NormalizedEval {
  const flip = sideToMove !== player;
  const cp = score.cp === null || score.cp === undefined ? null : flip ? -score.cp : score.cp;
  const mate =
    score.mate === null || score.mate === undefined
      ? null
      : flip
        ? -score.mate
        : score.mate;
  return { cp, mate };
}

/**
 * Single comparable number for an evaluation. Mate scores map to a large value
 * that still orders by distance (mate in 1 beats mate in 5).
 */
export function toScalarCp(evaluation: NormalizedEval): number {
  if (evaluation.mate !== null) {
    if (evaluation.mate === 0) return -MATE_CP;
    const magnitude = MATE_CP - Math.min(Math.abs(evaluation.mate), 99) * 10;
    return evaluation.mate > 0 ? magnitude : -magnitude;
  }
  return evaluation.cp ?? 0;
}

/** Clamped scalar, so swings inside already-won territory stay small. */
export function toClampedCp(evaluation: NormalizedEval): number {
  return Math.max(-CLAMP_CP, Math.min(CLAMP_CP, toScalarCp(evaluation)));
}

/**
 * How much the player gave away with this move, in centipawns.
 *
 * Both evaluations must already be in the player's perspective. The result is
 * never negative: playing a move the engine rates *better* than its own top
 * choice (search noise between depths) counts as zero loss, not a bonus.
 */
export function centipawnLoss(
  before: NormalizedEval,
  after: NormalizedEval,
): number {
  const loss = toClampedCp(before) - toClampedCp(after);
  return Math.max(0, Math.round(loss));
}

/** The player is getting mated: either a forced mate against them, or mated already. */
export function isLosingToMate(evaluation: NormalizedEval): boolean {
  if (evaluation.mate !== null) return evaluation.mate <= 0;
  return (evaluation.cp ?? 0) <= -MATE_CP;
}

/** The player has a forced mate, or has just delivered one. */
export function isWinningByMate(evaluation: NormalizedEval): boolean {
  if (evaluation.mate !== null) return evaluation.mate > 0;
  return (evaluation.cp ?? 0) >= MATE_CP;
}

export type MoveGrade = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export const GRADE_LABELS: Record<MoveGrade, string> = {
  best: "최상",
  good: "양호",
  inaccuracy: "부정확",
  mistake: "실수",
  blunder: "중대 실수",
};

export const GRADE_DESCRIPTIONS: Record<MoveGrade, string> = {
  best: "사실상 최선에 가까운 수",
  good: "실전적으로 충분한 수",
  inaccuracy: "개선할 여지가 분명한 수",
  mistake: "유의미한 불리함을 만든 수",
  blunder: "승패 가능성을 크게 바꾼 수",
};

export interface GradeContext {
  before: NormalizedEval;
  after: NormalizedEval;
  loss: number;
  ply: number;
}

/**
 * App-internal move grade. Deliberately not Chess.com's naming or thresholds.
 *
 * Two corrections on top of the raw table:
 *  - allowing mate, or throwing away a mate you had, is always the worst grade
 *  - a position that was already decided (either way) cannot produce a blunder,
 *    because turning +8 into +4 changes nothing about the result
 */
export function classifyMove(ctx: GradeContext): MoveGrade {
  const { before, after, loss } = ctx;

  // Mate handling comes first and overrides the centipawn table.
  const hadMate = isWinningByMate(before);
  const stillHasMate = isWinningByMate(after);
  const nowGettingMated = isLosingToMate(after);
  const wasGettingMated = isLosingToMate(before);

  if (nowGettingMated && !wasGettingMated) return "blunder";
  if (hadMate && !stillHasMate && toClampedCp(after) < MATE_CP) {
    // Missing a forced mate still matters, but not if the game is decided anyway.
    return toClampedCp(after) >= DECIDED_CP ? "inaccuracy" : "blunder";
  }

  const beforeCp = toClampedCp(before);
  const afterCp = toClampedCp(after);
  const decidedBefore = Math.abs(beforeCp) >= DECIDED_CP;
  const decidedAfter = Math.abs(afterCp) >= DECIDED_CP;
  const sameSideDecided =
    decidedBefore && decidedAfter && Math.sign(beforeCp) === Math.sign(afterCp);

  if (loss < 20) return "best";
  if (loss < 50) return "good";
  if (loss < 100) return "inaccuracy";

  // Still winning big / still losing big: cap the drama at "inaccuracy".
  if (sameSideDecided) return "inaccuracy";

  if (loss < 200) return "mistake";
  return "blunder";
}

export type ExpectedResult = "winning" | "better" | "equal" | "worse" | "losing";

export function expectedResult(evaluation: NormalizedEval): ExpectedResult {
  const cp = toScalarCp(evaluation);
  if (cp >= DECIDED_CP) return "winning";
  if (cp >= 150) return "better";
  if (cp > -150) return "equal";
  if (cp > -DECIDED_CP) return "worse";
  return "losing";
}

const RESULT_ORDER: ExpectedResult[] = ["losing", "worse", "equal", "better", "winning"];

export function resultDistance(a: ExpectedResult, b: ExpectedResult): number {
  return Math.abs(RESULT_ORDER.indexOf(a) - RESULT_ORDER.indexOf(b));
}

/** Convert a player-perspective eval into the conventional white-positive value. */
export function toWhitePerspective(
  evaluation: NormalizedEval,
  player: Color,
): NormalizedEval {
  if (player === "white") return evaluation;
  return {
    cp: evaluation.cp === null ? null : -evaluation.cp,
    mate: evaluation.mate === null ? null : -evaluation.mate,
  };
}

export function formatEval(evaluation: NormalizedEval): string {
  if (evaluation.mate !== null) {
    return evaluation.mate > 0 ? `M${evaluation.mate}` : `-M${Math.abs(evaluation.mate)}`;
  }
  // Terminal checkmate is carried as a saturated centipawn value, not a mate
  // distance, so that flipping perspective works (there is no "-0").
  if (evaluation.cp !== null && evaluation.cp >= MATE_CP) return "#";
  if (evaluation.cp !== null && evaluation.cp <= -MATE_CP) return "-#";
  if (evaluation.cp === null) return "–";
  const pawns = evaluation.cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
