import { Chess, type Square, type PieceSymbol } from "chess.js";
import {
  DECIDED_CP,
  isLosingToMate,
  isWinningByMate,
  toClampedCp,
  type Color,
  type NormalizedEval,
} from "./eval";
import type { Phase } from "@/lib/pgn/parse";

export const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

export const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "폰",
  n: "나이트",
  b: "비숍",
  r: "룩",
  q: "퀸",
  k: "킹",
};

function short(color: Color): "w" | "b" {
  return color === "white" ? "w" : "b";
}

/**
 * Squares holding a piece of `color` that the opponent can win material on:
 * either undefended while attacked, or attacked by something cheaper.
 * A deliberately shallow check — it feeds hypotheses, never a verdict.
 */
export function loosePieces(fen: string, color: Color): Array<{ square: Square; piece: PieceSymbol }> {
  const chess = new Chess(fen);
  const me = short(color);
  const them = me === "w" ? "b" : "w";
  const out: Array<{ square: Square; piece: PieceSymbol }> = [];

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== me || cell.type === "k") continue;
      const attackers = chess.attackers(cell.square, them);
      if (attackers.length === 0) continue;
      const defenders = chess.attackers(cell.square, me);
      const cheapestAttacker = Math.min(
        ...attackers.map((sq) => PIECE_VALUE[chess.get(sq)!.type]),
      );
      if (defenders.length === 0 || cheapestAttacker < PIECE_VALUE[cell.type]) {
        out.push({ square: cell.square, piece: cell.type });
      }
    }
  }
  return out;
}

/** Best immediate material gain available to the side to move, in centipawns. */
export function bestCaptureGain(fen: string): { gain: number; san: string | null } {
  const chess = new Chess(fen);
  let best = 0;
  let bestSan: string | null = null;
  for (const move of chess.moves({ verbose: true })) {
    if (!move.captured) continue;
    const target = move.to as Square;
    const gain = PIECE_VALUE[move.captured];
    const defenders = new Chess(fen).attackers(
      target,
      chess.turn() === "w" ? "b" : "w",
    );
    const net = defenders.length > 0 ? gain - PIECE_VALUE[move.piece] : gain;
    if (net > best) {
      best = net;
      bestSan = move.san;
    }
  }
  return { gain: best, san: bestSan };
}

/** Does the move at `uci` from `fen` attack two or more valuable enemy pieces? */
export function isFork(fenAfterMove: string, moverColor: Color, toSquare: Square): boolean {
  const chess = new Chess(fenAfterMove);
  const piece = chess.get(toSquare);
  if (!piece) return false;
  const them = short(moverColor) === "w" ? "b" : "w";
  let valuableTargets = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== them) continue;
      if (PIECE_VALUE[cell.type] <= PIECE_VALUE[piece.type] && cell.type !== "k") continue;
      if (chess.attackers(cell.square, short(moverColor)).includes(toSquare)) {
        valuableTargets++;
      }
    }
  }
  return valuableTargets >= 2;
}

/** King on the back rank with no pawn escape square and few defenders. */
export function hasBackRankWeakness(fen: string, color: Color): boolean {
  const chess = new Chess(fen);
  const me = short(color);
  const kingSquare = chess.findPiece({ color: me, type: "k" })[0];
  if (!kingSquare) return false;
  const rank = kingSquare[1];
  const homeRank = me === "w" ? "1" : "8";
  if (rank !== homeRank) return false;

  const file = kingSquare.charCodeAt(0);
  const escapeRank = me === "w" ? "2" : "7";
  for (const df of [-1, 0, 1]) {
    const f = String.fromCharCode(file + df);
    if (f < "a" || f > "h") continue;
    const sq = `${f}${escapeRank}` as Square;
    const occupant = chess.get(sq);
    if (!occupant || occupant.color !== me) return false; // escape square exists
  }
  return true;
}

export interface ThemeContext {
  fenBefore: string;
  fenAfter: string;
  playerColor: Color;
  san: string;
  toSquare: Square;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  evalBefore: NormalizedEval;
  evalAfter: NormalizedEval;
  loss: number;
  ply: number;
  phase: Phase;
  clockMs: number | null;
  previousClockMs: number | null;
  /** Player-perspective eval gap between the engine's top two moves. */
  onlyMoveGapCp: number | null;
  /** SANs of this player's earlier moves, for repetition checks. */
  previousPlayerMoves: Array<{ san: string; toSquare: string; fromSquare: string }>;
}

export interface DetectedTheme {
  tag: string;
  detail: string;
}

/**
 * Turns one analysed move into candidate cause tags.
 *
 * These are hypotheses about *why* a move was weak, not proofs. The coaching
 * layer only promotes a tag to a personal trait after it repeats across games.
 */
export function detectThemes(ctx: ThemeContext): DetectedTheme[] {
  const themes: DetectedTheme[] = [];
  const {
    fenBefore,
    fenAfter,
    playerColor,
    loss,
    phase,
    evalBefore,
    evalAfter,
  } = ctx;
  const opponent: Color = playerColor === "white" ? "black" : "white";
  const beforeCp = toClampedCp(evalBefore);
  const afterCp = toClampedCp(evalAfter);
  const alreadyDecided =
    Math.abs(beforeCp) >= DECIDED_CP && Math.sign(beforeCp) === Math.sign(afterCp);

  // --- Mate-level events, always reported ---
  if (isLosingToMate(evalAfter) && !isLosingToMate(evalBefore)) {
    themes.push({ tag: "allowed_mate", detail: `${ctx.san} 이후 상대에게 강제 메이트가 생겼습니다.` });
  }
  if (evalBefore.mate !== null && evalBefore.mate > 0 && !isWinningByMate(evalAfter)) {
    themes.push({
      tag: "missed_mate",
      detail: `강제 메이트(M${evalBefore.mate})가 있었지만 ${ctx.bestMoveSan ?? ctx.bestMoveUci ?? "다른 수"}를 두지 않았습니다.`,
    });
  }

  if (loss < 50 || alreadyDecided) {
    // Below this the move is fine; above it but already decided, we still record
    // the clock themes but not a cause narrative.
    pushClockThemes(themes, ctx, loss);
    pushOpeningThemes(themes, ctx);
    return themes;
  }

  // --- Material left loose after the move ---
  const looseAfter = loosePieces(fenAfter, playerColor);
  const looseBefore = loosePieces(fenBefore, playerColor);
  const newlyLoose = looseAfter.filter(
    (p) => !looseBefore.some((q) => q.square === p.square),
  );
  if (newlyLoose.length > 0) {
    const worst = newlyLoose.reduce((a, b) =>
      PIECE_VALUE[a.piece] >= PIECE_VALUE[b.piece] ? a : b,
    );
    themes.push({
      tag: "hanging_piece",
      detail: `${worst.square}의 ${PIECE_NAMES[worst.piece]}가 충분한 보호 없이 남았습니다.`,
    });
  }

  // --- Opponent's strongest reply ---
  const replyCapture = bestCaptureGain(fenAfter);
  if (replyCapture.gain >= 200 && replyCapture.san) {
    themes.push({
      tag: "missed_opponent_threat",
      detail: `상대에게 ${replyCapture.san}로 재료를 얻는 수가 생겼습니다.`,
    });
  }
  const opponentReplies = new Chess(fenAfter).moves({ verbose: true });
  const forkReply = opponentReplies.find((m) => {
    const probe = new Chess(fenAfter);
    probe.move(m.san);
    return isFork(probe.fen(), opponent, m.to as Square);
  });
  if (forkReply) {
    themes.push({
      tag: "allowed_fork",
      detail: `${forkReply.san}로 두 기물이 동시에 공격받을 수 있습니다.`,
    });
  }

  // --- Missed opportunity on our own side ---
  const ourBest = bestCaptureGain(fenBefore);
  if (ourBest.gain >= 200 && ourBest.san && ourBest.san !== ctx.san) {
    themes.push({
      tag: "missed_material",
      detail: `${ourBest.san}로 재료를 얻을 수 있었습니다.`,
    });
  }

  // --- King safety and structure ---
  if (hasBackRankWeakness(fenAfter, playerColor) && !hasBackRankWeakness(fenBefore, playerColor)) {
    themes.push({ tag: "back_rank", detail: "킹의 백랭크 탈출로가 막혔습니다." });
  }
  if (new Chess(fenAfter).isAttacked(
    new Chess(fenAfter).findPiece({ color: short(playerColor), type: "k" })[0] as Square,
    short(opponent),
  )) {
    themes.push({ tag: "king_safety", detail: "수를 둔 뒤 킹이 직접 공격받는 상태입니다." });
  }

  // --- Decision-habit signals ---
  if (ctx.onlyMoveGapCp !== null && ctx.onlyMoveGapCp >= 150) {
    themes.push({
      tag: "only_move_position",
      detail: "최선수와 차선수의 차이가 커서 정확한 계산이 필요한 장면이었습니다.",
    });
  }
  if (beforeCp >= 150 && afterCp < 0) {
    themes.push({
      tag: "squandered_advantage",
      detail: "유리한 흐름을 한 수로 반대편에 넘겨주었습니다.",
    });
  }
  if (beforeCp <= -150 && loss >= 200) {
    themes.push({
      tag: "passive_when_worse",
      detail: "불리한 상황에서 버티는 대신 상황을 더 나쁘게 만들었습니다.",
    });
  }

  pushClockThemes(themes, ctx, loss);
  pushOpeningThemes(themes, ctx);

  if (phase === "endgame" && loss >= 200) {
    themes.push({ tag: "endgame_technique", detail: "엔드게임 전환 과정에서 큰 손실이 났습니다." });
  }

  return dedupe(themes);
}

function pushClockThemes(themes: DetectedTheme[], ctx: ThemeContext, loss: number) {
  const { clockMs, previousClockMs } = ctx;
  if (clockMs === null) return;
  if (loss >= 100 && clockMs <= 30_000) {
    themes.push({
      tag: "time_trouble",
      detail: `남은 시간 ${(clockMs / 1000).toFixed(0)}초에서 나온 오류입니다.`,
    });
  }
  if (previousClockMs !== null) {
    const spentMs = previousClockMs - clockMs;
    if (loss >= 200 && spentMs >= 0 && spentMs < 5_000 && clockMs > 60_000) {
      themes.push({
        tag: "instant_blunder",
        detail: `시간이 충분한데 ${(spentMs / 1000).toFixed(1)}초 만에 둔 수입니다.`,
      });
    }
    if (spentMs >= 120_000 && clockMs < 120_000) {
      themes.push({
        tag: "clock_mismanagement",
        detail: "한 수에 시간을 크게 쓰고 남은 시간이 부족해졌습니다.",
      });
    }
  }
}

function pushOpeningThemes(themes: DetectedTheme[], ctx: ThemeContext) {
  if (ctx.phase !== "opening" || ctx.ply > 20) return;
  const moves = ctx.previousPlayerMoves;
  // Same piece walked around repeatedly while pieces sit at home.
  const chain = moves.filter((m) => m.toSquare === ctx.previousPlayerMoves.at(-1)?.toSquare);
  if (chain.length >= 2 && ctx.loss >= 50) {
    themes.push({
      tag: "repeated_piece_move",
      detail: "오프닝에서 같은 기물을 반복해 움직였습니다.",
    });
  }
  const chess = new Chess(ctx.fenAfter);
  const backRank = ctx.playerColor === "white" ? "1" : "8";
  const undeveloped = ["b", "c", "f", "g"].filter((file) => {
    const piece = chess.get(`${file}${backRank}` as Square);
    return piece && (piece.type === "n" || piece.type === "b");
  }).length;
  if (ctx.ply >= 12 && undeveloped >= 3 && ctx.loss >= 50) {
    themes.push({
      tag: "development_delay",
      detail: "마이너 기물이 아직 초기 위치에 남아 있습니다.",
    });
  }
}

function dedupe(themes: DetectedTheme[]): DetectedTheme[] {
  const seen = new Set<string>();
  return themes.filter((t) => {
    if (seen.has(t.tag)) return false;
    seen.add(t.tag);
    return true;
  });
}

/** Positive things worth telling the player about. */
export function detectStrengths(ctx: ThemeContext): DetectedTheme[] {
  const out: DetectedTheme[] = [];
  const beforeCp = toClampedCp(ctx.evalBefore);
  const afterCp = toClampedCp(ctx.evalAfter);
  const gain = afterCp - beforeCp;

  if (ctx.onlyMoveGapCp !== null && ctx.onlyMoveGapCp >= 150 && ctx.loss < 20) {
    out.push({
      tag: "found_only_move",
      detail: "다른 수로는 흐름이 크게 나빠지는 장면에서 정확한 수를 찾았습니다.",
    });
  }
  if (gain >= 150 && ctx.loss < 20) {
    out.push({ tag: "tactical_alertness", detail: `${ctx.san}로 흐름을 확실히 가져왔습니다.` });
  }
  if (beforeCp <= -150 && ctx.loss < 20 && ctx.phase !== "opening") {
    out.push({ tag: "resilient_defense", detail: "불리한 상황에서 최선의 방어를 이어갔습니다." });
  }
  if (ctx.phase === "endgame" && beforeCp >= 150 && ctx.loss < 20) {
    out.push({ tag: "endgame_conversion", detail: "엔드게임에서 우위를 정확하게 유지했습니다." });
  }
  if (ctx.clockMs !== null && ctx.clockMs <= 30_000 && ctx.loss < 20 && beforeCp > -300) {
    out.push({ tag: "time_pressure_composure", detail: "시간 압박 속에서도 정확하게 두었습니다." });
  }
  return dedupe(out);
}
