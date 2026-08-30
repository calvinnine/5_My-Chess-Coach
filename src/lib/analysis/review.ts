import {
  DECIDED_CP,
  expectedResult,
  formatEval,
  resultDistance,
  toClampedCp,
  type Color,
} from "./eval";
import type { AnalyzedMove } from "./analyzer";
import { THEME_LABELS, THEME_COACHING } from "@/lib/coaching/tags";

export interface TurningPoint {
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  bestMoveSan: string | null;
  bestLine: string | null;
  fenBefore: string;
  fenAfter: string;
  evalBeforeText: string;
  evalAfterText: string;
  centipawnLoss: number;
  classification: string;
  importance: number;
  themes: string[];
  explanation: string;
}

export interface StrengthMoment {
  ply: number;
  moveNumber: number;
  san: string;
  fenAfter: string;
  tags: string[];
  explanation: string;
}

/**
 * importance = swing × state × uniqueness × phase
 *
 * The state factor is what keeps the app from calling the 40th-move slip in a
 * long-lost position "the reason you lost".
 */
export function importanceOf(move: AnalyzedMove): number {
  const loss = move.centipawnLoss ?? 0;
  if (loss <= 0) return 0;

  const before = expectedResult(move.evalBefore);
  const after = expectedResult(move.evalAfter);
  const beforeCp = toClampedCp(move.evalBefore);
  const afterCp = toClampedCp(move.evalAfter);

  // Mate events dominate everything else.
  const allowedMate = move.themes.some((t) => t.tag === "allowed_mate");
  const missedMate = move.themes.some((t) => t.tag === "missed_mate");

  let stateWeight = 1;
  const bothDecidedSameSide =
    Math.abs(beforeCp) >= DECIDED_CP &&
    Math.abs(afterCp) >= DECIDED_CP &&
    Math.sign(beforeCp) === Math.sign(afterCp);
  if (bothDecidedSameSide) stateWeight = 0.1; // result was never in question
  else stateWeight = 1 + resultDistance(before, after) * 0.9;

  /*
   * How much of the game was still at stake before this move. A move played
   * from an already-lost position cannot be the reason the game was lost — the
   * game was decided earlier — so it is damped smoothly all the way down,
   * including its mate bonus. Positions that are already *won* are deliberately
   * not damped here: throwing away a win is exactly what should surface.
   */
  const stakes =
    beforeCp >= -150
      ? 1
      : Math.max(0.1, 1 - (-beforeCp - 150) / (DECIDED_CP - 150));

  const uniqueness =
    move.secondBestCp !== null
      ? 1 + Math.min(Math.abs(beforeCp - move.secondBestCp), 400) / 400
      : 1;

  const phaseWeight =
    move.phase === "opening" ? (move.ply <= 8 ? 0.3 : 0.7) : move.phase === "endgame" ? 1.1 : 1;

  const swing = Math.min(loss, 1000);
  let score = swing * stateWeight * uniqueness * phaseWeight;
  /*
   * Mate events get a bump rather than an override. A mate allowed out of a
   * playable position already produces a huge swing above; the bump exists so
   * that a *missed* mate — where the evaluation barely moves because the
   * position stays winning — still surfaces.
   */
  if (allowedMate) score += 1500;
  if (missedMate) score += 1200;
  return Math.round(score * stakes);
}

/**
 * The ply at which the game stopped being playable for the player: the first of
 * their moves that took a non-lost position to a lost one and never came back.
 * Returns null when no single move did that.
 */
export function collapsePly(moves: AnalyzedMove[]): number | null {
  const playerMoves = moves.filter((m) => m.isPlayerMove);
  for (let i = 0; i < playerMoves.length; i++) {
    const move = playerMoves[i];
    const before = toClampedCp(move.evalBefore);
    const after = toClampedCp(move.evalAfter);
    if (before <= -150 || after > -300) continue;
    // Only a collapse if the player never climbs back out of it.
    const recovered = playerMoves
      .slice(i + 1)
      .some((later) => toClampedCp(later.evalAfter) > -150);
    if (!recovered) return move.ply;
  }
  return null;
}

/**
 * Picks at most `limit` decisive moments, collapsing runs of the same cause so
 * a single collapse is not reported three times.
 *
 * Once the game has demonstrably been decided by an earlier move, everything
 * after it is damped hard. Without this, the move that finally allows mate in a
 * long-lost position outranks the move that actually lost the game.
 */
export function selectTurningPoints(moves: AnalyzedMove[], limit = 3): TurningPoint[] {
  const collapse = collapsePly(moves);
  const candidates = moves
    .filter((m) => m.isPlayerMove && (m.centipawnLoss ?? 0) >= 50)
    .map((m) => ({
      move: m,
      importance: Math.round(
        importanceOf(m) * (collapse !== null && m.ply > collapse ? 0.25 : 1),
      ),
    }))
    .filter((c) => c.importance >= 60)
    .sort((a, b) => b.importance - a.importance);

  const picked: typeof candidates = [];
  for (const candidate of candidates) {
    const duplicate = picked.some((p) => {
      const sharesCause = candidate.move.themes.some((t) =>
        p.move.themes.some((u) => u.tag === t.tag),
      );
      const adjacent = Math.abs(p.move.ply - candidate.move.ply) <= 4;
      return sharesCause && adjacent;
    });
    if (duplicate) continue;
    picked.push(candidate);
    if (picked.length === limit) break;
  }

  return picked
    .sort((a, b) => a.move.ply - b.move.ply)
    .map(({ move, importance }) => ({
      ply: move.ply,
      moveNumber: move.moveNumber,
      color: move.color,
      san: move.san,
      bestMoveSan: move.bestMoveSan,
      bestLine: move.bestLine,
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      evalBeforeText: formatEval(move.evalBefore),
      evalAfterText: formatEval(move.evalAfter),
      centipawnLoss: move.centipawnLoss ?? 0,
      classification: move.classification ?? "inaccuracy",
      importance,
      themes: move.themes.map((t) => t.tag),
      explanation: explainTurningPoint(move),
    }));
}

function moveLabel(move: AnalyzedMove) {
  return move.color === "white"
    ? `${move.moveNumber}. ${move.san}`
    : `${move.moveNumber}...${move.san}`;
}

function explainTurningPoint(move: AnalyzedMove): string {
  const parts: string[] = [];
  const before = formatEval(move.evalBefore);
  const after = formatEval(move.evalAfter);
  parts.push(
    `${moveLabel(move)}로 평가가 ${before}에서 ${after}로 움직였습니다.`,
  );
  if (move.bestMoveSan) {
    parts.push(
      `엔진 추천은 ${move.bestMoveSan}${move.bestLine ? ` (${move.bestLine})` : ""}였습니다.`,
    );
  }
  const causes = move.themes.filter((t) => THEME_LABELS[t.tag]).slice(0, 2);
  if (causes.length > 0) {
    parts.push(causes.map((c) => c.detail).join(" "));
  }
  return parts.join(" ");
}

export function selectStrengths(moves: AnalyzedMove[], limit = 3): StrengthMoment[] {
  const scored = moves
    .filter((m) => m.isPlayerMove && m.strengths.length > 0)
    .map((m) => ({
      move: m,
      score:
        m.strengths.length * 100 +
        Math.max(0, toClampedCp(m.evalAfter) - toClampedCp(m.evalBefore)),
    }))
    .sort((a, b) => b.score - a.score);

  const picked: typeof scored = [];
  const usedTags = new Set<string>();
  for (const candidate of scored) {
    const tag = candidate.move.strengths[0].tag;
    if (usedTags.has(tag)) continue;
    usedTags.add(tag);
    picked.push(candidate);
    if (picked.length === limit) break;
  }

  return picked
    .sort((a, b) => a.move.ply - b.move.ply)
    .map(({ move }) => ({
      ply: move.ply,
      moveNumber: move.moveNumber,
      san: move.san,
      fenAfter: move.fenAfter,
      tags: move.strengths.map((s) => s.tag),
      explanation: `${moveLabel(move)}: ${move.strengths.map((s) => s.detail).join(" ")}`,
    }));
}

export interface PhaseStats {
  moves: number;
  averageLoss: number;
  worstLoss: number;
}

export function phaseStats(moves: AnalyzedMove[], phase: string): PhaseStats {
  const relevant = moves.filter((m) => m.isPlayerMove && m.phase === phase);
  if (relevant.length === 0) return { moves: 0, averageLoss: 0, worstLoss: 0 };
  const losses = relevant.map((m) => m.centipawnLoss ?? 0);
  return {
    moves: relevant.length,
    averageLoss: Math.round(losses.reduce((a, b) => a + b, 0) / losses.length),
    worstLoss: Math.max(...losses),
  };
}

export interface RuleBasedReview {
  headline: string;
  openingSummary: string;
  middlegameSummary: string;
  endgameSummary: string;
  timeSummary: string;
  overallSummary: string;
  turningPoints: TurningPoint[];
  strengths: StrengthMoment[];
  checklist: string[];
  reflectionQuestion: string;
}

export interface ReviewInput {
  moves: AnalyzedMove[];
  result: "win" | "loss" | "draw";
  playerColor: Color;
  openingName: string | null;
  termination: string | null;
}

/**
 * The rules-only coaching text. This is what the app shows when no LLM key is
 * configured, so it must stand on its own.
 */
export function buildReview(input: ReviewInput): RuleBasedReview {
  const { moves, result, openingName } = input;
  const playerMoves = moves.filter((m) => m.isPlayerMove);
  const turningPoints = selectTurningPoints(moves);
  const strengths = selectStrengths(moves);

  const opening = phaseStats(moves, "opening");
  const middlegame = phaseStats(moves, "middlegame");
  const endgame = phaseStats(moves, "endgame");
  const averageLoss =
    playerMoves.length > 0
      ? Math.round(
          playerMoves.reduce((sum, m) => sum + (m.centipawnLoss ?? 0), 0) /
            playerMoves.length,
        )
      : 0;
  const blunders = playerMoves.filter((m) => m.classification === "blunder").length;
  const mistakes = playerMoves.filter((m) => m.classification === "mistake").length;

  /*
   * Turning points are listed in board order, but the headline must name the
   * move that actually decided the game — the highest-importance one.
   */
  const decisive = [...turningPoints].sort((a, b) => b.importance - a.importance)[0];
  const resultWord = result === "win" ? "승리" : result === "loss" ? "패배" : "무승부";

  let headline: string;
  if (!decisive) {
    headline =
      result === "win"
        ? `큰 실수 없이 흐름을 유지해 ${resultWord}로 이어진 게임입니다.`
        : `한 번의 결정적 실수보다 작은 손실이 쌓인 ${resultWord} 게임입니다 (평균 손실 ${averageLoss}cp).`;
  } else {
    const causeTag = decisive.themes.find((t) => THEME_LABELS[t]);
    const cause = causeTag ? THEME_LABELS[causeTag] : "계산 부족";
    headline = `이 게임의 분기점은 ${decisive.moveNumber}수째 ${decisive.san}이며, 원인은 ${cause}에 가깝습니다.`;
  }

  const openingSummary =
    opening.moves === 0
      ? "오프닝 구간 데이터가 없습니다."
      : `${openingName ?? "오프닝"} 구간에서 ${opening.moves}수를 두었고 평균 손실은 ${opening.averageLoss}cp입니다.` +
        (opening.worstLoss >= 150
          ? ` 다만 최대 ${opening.worstLoss}cp를 잃은 수가 있었습니다.`
          : " 큰 문제는 없었습니다.");

  const middlegameSummary =
    middlegame.moves === 0
      ? "미들게임에 도달하기 전에 끝난 게임입니다."
      : `미들게임 ${middlegame.moves}수의 평균 손실은 ${middlegame.averageLoss}cp이고, 중대 실수 ${blunders}회·실수 ${mistakes}회가 이 게임 전체에서 나왔습니다.`;

  const endgameSummary =
    endgame.moves === 0
      ? "엔드게임까지 가지 않았습니다."
      : `엔드게임 ${endgame.moves}수의 평균 손실은 ${endgame.averageLoss}cp입니다.`;

  const timeSummary = buildTimeSummary(playerMoves);

  const overallSummary = [
    headline,
    `형이 둔 ${playerMoves.length}수의 평균 평가 손실은 ${averageLoss}cp입니다.`,
    turningPoints.length > 0
      ? `승패를 가른 장면 ${turningPoints.length}개를 선별했습니다.`
      : "이 게임에서는 결정적 전환점이라 부를 만한 장면이 없었습니다.",
    input.termination ? `종료 사유: ${input.termination}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const checklist = buildChecklist(turningPoints, playerMoves);
  const reflectionQuestion = decisive
    ? `${decisive.moveNumber}수째 ${decisive.san}을 두기 전에 어떤 후보수를 검토했고, 상대의 어떤 응수를 예상했나요?`
    : "이 게임에서 가장 오래 고민한 수는 무엇이었고, 그때 무엇이 헷갈렸나요?";

  return {
    headline,
    openingSummary,
    middlegameSummary,
    endgameSummary,
    timeSummary,
    overallSummary,
    turningPoints,
    strengths,
    checklist,
    reflectionQuestion,
  };
}

function buildTimeSummary(playerMoves: AnalyzedMove[]): string {
  const withClock = playerMoves.filter((m) => m.clockMs !== null);
  if (withClock.length === 0) return "이 PGN에는 시계 기록이 없어 시간 사용을 분석하지 않았습니다.";

  const timeTrouble = withClock.filter((m) =>
    m.themes.some((t) => t.tag === "time_trouble"),
  ).length;
  const instant = withClock.filter((m) =>
    m.themes.some((t) => t.tag === "instant_blunder"),
  ).length;
  const finalClock = withClock.at(-1)?.clockMs ?? 0;

  const parts = [`마지막 남은 시간은 약 ${Math.round(finalClock / 1000)}초입니다.`];
  if (timeTrouble > 0) parts.push(`시간 부족 상태에서 나온 오류가 ${timeTrouble}회 있습니다.`);
  if (instant > 0)
    parts.push(`시간이 충분한데도 즉시 두어 크게 손해 본 수가 ${instant}회 있습니다.`);
  if (timeTrouble === 0 && instant === 0) parts.push("시간 사용에서 뚜렷한 문제는 없었습니다.");
  return parts.join(" ");
}

function buildChecklist(
  turningPoints: TurningPoint[],
  playerMoves: AnalyzedMove[],
): string[] {
  const tags = new Set<string>();
  for (const tp of turningPoints) for (const t of tp.themes) tags.add(t);
  const items: string[] = [];
  for (const tag of tags) {
    const advice = THEME_COACHING[tag];
    if (advice && !items.includes(advice)) items.push(advice);
    if (items.length === 3) break;
  }
  if (items.length === 0) {
    const worst = [...playerMoves].sort(
      (a, b) => (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0),
    )[0];
    items.push(
      worst && (worst.centipawnLoss ?? 0) >= 50
        ? "수를 두기 전 상대의 체크·잡기·위협을 순서대로 한 번 확인하기"
        : "이번 게임의 좋은 습관(후보수 비교, 상대 위협 확인)을 다음 게임에서도 그대로 유지하기",
    );
  }
  return items;
}
