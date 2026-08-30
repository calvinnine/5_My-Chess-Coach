import { Chess, type Square } from "chess.js";
import {
  AbortError,
  type AnalysisEngine,
  type PvLine,
} from "@/lib/engine/types";
import { parsePgn, phaseFor, type ParsedGame } from "@/lib/pgn/parse";
import {
  centipawnLoss,
  classifyMove,
  MATE_CP,
  toClampedCp,
  toPlayerPerspective,
  type Color,
  type MoveGrade,
  type NormalizedEval,
} from "./eval";
import { detectStrengths, detectThemes, type DetectedTheme } from "./themes";

export interface AnalysisSettings {
  /** Base search depth for every ply. */
  depth: number;
  /** Deeper re-check for the handful of decisive moments. */
  keyMomentDepth: number;
  multiPv: number;
  /** Low-spec mode: fixed time per move instead of a fixed depth. */
  movetimeMs?: number;
}

export const PRESETS: Record<string, AnalysisSettings> = {
  fast: { depth: 12, keyMomentDepth: 16, multiPv: 2 },
  standard: { depth: 16, keyMomentDepth: 20, multiPv: 2 },
  precise: { depth: 20, keyMomentDepth: 24, multiPv: 2 },
};

export interface AnalyzedMove {
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: NormalizedEval;
  evalAfter: NormalizedEval;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  bestLine: string | null;
  secondBestCp: number | null;
  centipawnLoss: number | null;
  classification: MoveGrade | null;
  themes: DetectedTheme[];
  strengths: DetectedTheme[];
  clockMs: number | null;
  phase: ReturnType<typeof phaseFor>;
  isPlayerMove: boolean;
}

export interface AnalyzeGameResult {
  moves: AnalyzedMove[];
  parsed: ParsedGame;
  engineVersion: string;
  settings: AnalysisSettings;
}

export interface AnalyzeProgress {
  done: number;
  total: number;
  stage: "scan" | "key-moments";
}

/** Stable identifier stored on the game so old analyses can be told apart. */
export function analysisVersion(engineVersion: string, settings: AnalysisSettings) {
  return `${engineVersion} | d${settings.depth}/k${settings.keyMomentDepth}/mpv${settings.multiPv}${
    settings.movetimeMs ? `/mt${settings.movetimeMs}` : ""
  } | rules-v1`;
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

function lineToSan(fen: string, moves: string[], maxPlies = 6): string {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of moves.slice(0, maxPlies)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sans.push(move.san);
    } catch {
      break;
    }
  }
  return sans.join(" ");
}

function sideToMoveOf(fen: string): Color {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

function evalFromLine(line: PvLine | undefined, fen: string, player: Color): NormalizedEval {
  if (!line) return { cp: null, mate: null };
  return toPlayerPerspective({ cp: line.cp, mate: line.mate }, sideToMoveOf(fen), player);
}

/**
 * Runs an engine over one game and produces per-ply records.
 *
 * Works against any `AnalysisEngine`: local Stockfish over a pipe, or the WASM
 * build in a browser worker. Nothing in this function is runtime-specific.
 *
 * Every position is evaluated exactly once: the evaluation of position *i* is
 * simultaneously "after move i" and "before move i+1". All evaluations leaving
 * this function are already normalised to `playerColor`.
 */
export async function analyzeGame(
  pgn: string,
  playerColor: Color,
  engine: AnalysisEngine,
  settings: AnalysisSettings,
  options: { signal?: AbortSignal; onProgress?: (p: AnalyzeProgress) => void } = {},
): Promise<AnalyzeGameResult> {
  const parsed = parsePgn(pgn);
  const { moves } = parsed;

  // Positions: index 0 is before move 1; index i is after move i.
  const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
  const evaluations: Array<{ lines: PvLine[] } | null> = new Array(fens.length).fill(null);

  const total = fens.length;
  for (let i = 0; i < fens.length; i++) {
    if (options.signal?.aborted) throw new AbortError();
    const chess = new Chess(fens[i]);
    if (chess.isGameOver()) {
      /*
       * Terminal position: no search needed, and Stockfish returns no PV here.
       * A delivered checkmate is stored as a saturated centipawn score for the
       * side to move rather than `mate 0`, because 0 has no sign and would not
       * survive the flip into the other player's perspective.
       */
      evaluations[i] = {
        lines: chess.isCheckmate()
          ? [{ multipv: 1, depth: 0, cp: -MATE_CP, mate: null, moves: [] }]
          : [{ multipv: 1, depth: 0, cp: 0, mate: null, moves: [] }],
      };
    } else {
      const result = await engine.evaluate(fens[i], {
        depth: settings.movetimeMs ? undefined : settings.depth,
        movetimeMs: settings.movetimeMs,
        signal: options.signal,
      });
      evaluations[i] = result;
    }
    options.onProgress?.({ done: i + 1, total, stage: "scan" });
  }

  const build = () => buildMoves(parsed, playerColor, evaluations, fens);
  let analyzed = build();

  // Second pass: re-search the few moments that actually decided the game.
  const keyPlies = topImportancePlies(analyzed, 3);
  if (keyPlies.length > 0 && !settings.movetimeMs) {
    let done = 0;
    for (const ply of keyPlies) {
      if (options.signal?.aborted) throw new AbortError();
      for (const index of [ply - 1, ply]) {
        const chess = new Chess(fens[index]);
        if (chess.isGameOver()) continue;
        evaluations[index] = await engine.evaluate(fens[index], {
          depth: settings.keyMomentDepth,
          signal: options.signal,
        });
      }
      done++;
      options.onProgress?.({ done, total: keyPlies.length, stage: "key-moments" });
    }
    analyzed = build();
  }

  return {
    moves: analyzed,
    parsed,
    engineVersion: engine.versionName,
    settings,
  };
}

function buildMoves(
  parsed: ParsedGame,
  playerColor: Color,
  evaluations: Array<{ lines: PvLine[] } | null>,
  fens: string[],
): AnalyzedMove[] {
  const out: AnalyzedMove[] = [];
  const playerMoveHistory: Array<{ san: string; toSquare: string; fromSquare: string }> = [];
  let previousPlayerClock: number | null = null;

  for (let i = 0; i < parsed.moves.length; i++) {
    const move = parsed.moves[i];
    const isPlayerMove = move.color === playerColor;
    const beforeEvalLines = evaluations[i]?.lines ?? [];
    const afterEvalLines = evaluations[i + 1]?.lines ?? [];

    const evalBefore = evalFromLine(beforeEvalLines[0], fens[i], playerColor);
    const evalAfter = evalFromLine(afterEvalLines[0], fens[i + 1], playerColor);

    const bestUci = beforeEvalLines[0]?.moves[0] ?? null;
    const bestSan = bestUci ? uciToSan(move.fenBefore, bestUci) : null;
    const bestLine = beforeEvalLines[0]
      ? lineToSan(move.fenBefore, beforeEvalLines[0].moves)
      : null;

    const secondEval = beforeEvalLines[1]
      ? evalFromLine(beforeEvalLines[1], fens[i], playerColor)
      : null;
    const onlyMoveGapCp =
      isPlayerMove && secondEval
        ? Math.abs(toClampedCp(evalBefore) - toClampedCp(secondEval))
        : null;

    const loss = isPlayerMove ? centipawnLoss(evalBefore, evalAfter) : null;
    const phase = phaseFor(move.ply, move.fenBefore);
    const classification =
      isPlayerMove && loss !== null
        ? classifyMove({ before: evalBefore, after: evalAfter, loss, ply: move.ply })
        : null;

    let themes: DetectedTheme[] = [];
    let strengths: DetectedTheme[] = [];
    if (isPlayerMove && loss !== null) {
      const ctx = {
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        playerColor,
        san: move.san,
        toSquare: move.uci.slice(2, 4) as Square,
        bestMoveUci: bestUci,
        bestMoveSan: bestSan,
        evalBefore,
        evalAfter,
        loss,
        ply: move.ply,
        phase,
        clockMs: move.clockMs,
        previousClockMs: previousPlayerClock,
        onlyMoveGapCp,
        previousPlayerMoves: [...playerMoveHistory],
      };
      themes = detectThemes(ctx);
      strengths = detectStrengths(ctx);
      playerMoveHistory.push({
        san: move.san,
        toSquare: move.uci.slice(2, 4),
        fromSquare: move.uci.slice(0, 2),
      });
      previousPlayerClock = move.clockMs;
    }

    out.push({
      ply: move.ply,
      moveNumber: move.moveNumber,
      color: move.color,
      san: move.san,
      uci: move.uci,
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      evalBefore,
      evalAfter,
      bestMoveUci: bestUci,
      bestMoveSan: bestSan,
      bestLine,
      secondBestCp: secondEval ? toClampedCp(secondEval) : null,
      centipawnLoss: loss,
      classification,
      themes,
      strengths,
      clockMs: move.clockMs,
      phase,
      isPlayerMove,
    });
  }
  return out;
}

function topImportancePlies(moves: AnalyzedMove[], count: number): number[] {
  return moves
    .filter((m) => m.isPlayerMove && (m.centipawnLoss ?? 0) >= 100)
    .sort((a, b) => (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0))
    .slice(0, count)
    .map((m) => m.ply);
}
