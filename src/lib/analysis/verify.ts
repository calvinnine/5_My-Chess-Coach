import { Chess } from "chess.js";
import { parsePgn } from "@/lib/pgn/parse";
import { MATE_CP } from "./eval";
import { positionsOf, type PositionEval } from "./analyzer";

export interface EvaluationProblem {
  /** Index into the position list, so a bad upload can be located. */
  position: number;
  reason: string;
}

/**
 * Below this, a report is not a search result — the shallowest preset is
 * depth 12. Positions where the engine found a mate are exempt: a proven mate
 * can be reported at a low depth and is still correct.
 */
const MIN_SEARCH_DEPTH = 6;

/** Problems past this point add nothing; the upload is already rejected. */
const MAX_REPORTED = 10;

/**
 * Checks an analysis produced somewhere the server does not control.
 *
 * What can be checked is everything structural: that the evaluations line up
 * with the game the server stores, and that each principal variation starts
 * with a move that is actually legal in that position. What cannot be checked
 * is whether a centipawn number is the one Stockfish would have returned —
 * that is inherent to letting the client run the engine.
 *
 * Terminal positions are not checked but recomputed: their value follows from
 * the position alone, so the server derives it rather than trusting it.
 */
export function prepareUploadedEvaluations(
  pgn: string,
  evaluations: PositionEval[],
): { problems: EvaluationProblem[]; evaluations: PositionEval[] } {
  return inspect(pgn, evaluations);
}

function inspect(pgn: string, evaluations: PositionEval[]) {
  const problems: EvaluationProblem[] = [];
  const add = (position: number, reason: string) => {
    if (problems.length < MAX_REPORTED) problems.push({ position, reason });
  };

  let fens: string[];
  try {
    fens = positionsOf(parsePgn(pgn));
  } catch {
    return { problems: [{ position: -1, reason: "저장된 PGN을 읽을 수 없습니다." }], evaluations };
  }

  if (evaluations.length !== fens.length) {
    return {
      problems: [
        {
          position: -1,
          reason: `평가 개수가 맞지 않습니다: ${fens.length}개가 필요한데 ${evaluations.length}개를 받았습니다.`,
        },
      ],
      evaluations,
    };
  }

  const prepared: PositionEval[] = evaluations.map((evaluation, i) => {
    const fen = fens[i];
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      add(i, "포지션을 재생할 수 없습니다.");
      return evaluation;
    }

    if (chess.isGameOver()) {
      /*
       * Derived, not trusted. A delivered checkmate is stored as a saturated
       * centipawn score for the side to move rather than `mate 0`, because 0
       * has no sign and would not survive the flip between perspectives.
       */
      return {
        lines: [
          {
            multipv: 1,
            depth: 0,
            cp: chess.isCheckmate() ? -MATE_CP : 0,
            mate: null,
            moves: [],
          },
        ],
      };
    }

    if (evaluation.lines.length === 0) {
      add(i, "평가 라인이 비어 있습니다.");
      return evaluation;
    }

    const legal = new Set(
      chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`),
    );
    let previousMultipv = 0;

    for (const line of evaluation.lines) {
      if (line.multipv <= previousMultipv) {
        add(i, "MultiPV 번호가 순서대로가 아닙니다.");
        break;
      }
      previousMultipv = line.multipv;

      if ((line.cp === null) === (line.mate === null)) {
        add(i, "점수는 cp와 mate 중 정확히 하나여야 합니다.");
        break;
      }
      if (line.moves.length === 0) {
        add(i, "최선수 없이 점수만 보고됐습니다.");
        break;
      }
      if (!legal.has(line.moves[0])) {
        add(i, `이 포지션에서 둘 수 없는 수입니다: ${line.moves[0]}`);
        break;
      }
      if (line.mate === null && line.depth < MIN_SEARCH_DEPTH) {
        add(i, `탐색 깊이가 너무 얕습니다: ${line.depth}`);
        break;
      }
    }

    return evaluation;
  });

  return { problems, evaluations: prepared };
}
