import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { prepareUploadedEvaluations } from "@/lib/analysis/verify";
import { positionsOf, rebuildAnalysis, type PositionEval } from "@/lib/analysis/analyzer";
import { MATE_CP } from "@/lib/analysis/eval";
import { parsePgn } from "@/lib/pgn/parse";
import { HUNG_QUEEN, WHITE_MATE_WITH_CLOCK } from "../fixtures/pgn";

/**
 * Builds an upload the way an honest browser would: one entry per position,
 * a legal first move, a plausible score.
 */
function honestUpload(pgn: string, depth = 16): PositionEval[] {
  return positionsOf(parsePgn(pgn)).map((fen) => {
    const chess = new Chess(fen);
    if (chess.isGameOver()) {
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
    const legal = chess.moves({ verbose: true });
    return {
      lines: legal.slice(0, 2).map((m, i) => ({
        multipv: i + 1,
        depth,
        cp: 20 - i * 40,
        mate: null,
        moves: [`${m.from}${m.to}${m.promotion ?? ""}`],
      })),
    };
  });
}

describe("accepting an analysis the server did not run", () => {
  it("accepts a well-formed upload", () => {
    const { problems } = prepareUploadedEvaluations(HUNG_QUEEN, honestUpload(HUNG_QUEEN));
    expect(problems).toEqual([]);
  });

  it("rejects an upload with the wrong number of positions", () => {
    const upload = honestUpload(HUNG_QUEEN).slice(0, -1);
    const { problems } = prepareUploadedEvaluations(HUNG_QUEEN, upload);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain("평가 개수가 맞지 않습니다");
  });

  it("rejects a principal variation that is illegal in its position", () => {
    // The one thing a fabricated analysis cannot fake cheaply.
    const upload = honestUpload(HUNG_QUEEN);
    upload[4] = { lines: [{ multipv: 1, depth: 16, cp: 0, mate: null, moves: ["a1a8"] }] };
    const { problems } = prepareUploadedEvaluations(HUNG_QUEEN, upload);
    expect(problems.map((p) => p.position)).toContain(4);
    expect(problems[0].reason).toContain("둘 수 없는 수");
  });

  it("rejects a score claiming to be both a mate and a centipawn count", () => {
    const upload = honestUpload(HUNG_QUEEN);
    upload[2].lines[0] = { ...upload[2].lines[0], mate: 3 };
    expect(prepareUploadedEvaluations(HUNG_QUEEN, upload).problems[0].reason).toContain(
      "정확히 하나",
    );
  });

  it("rejects a score with neither a mate nor a centipawn count", () => {
    const upload = honestUpload(HUNG_QUEEN);
    upload[2].lines[0] = { ...upload[2].lines[0], cp: null };
    expect(prepareUploadedEvaluations(HUNG_QUEEN, upload).problems[0].reason).toContain(
      "정확히 하나",
    );
  });

  it("rejects a search too shallow to be one of the presets", () => {
    // Otherwise a client could upload depth-1 noise and have it stored as coaching.
    const { problems } = prepareUploadedEvaluations(HUNG_QUEEN, honestUpload(HUNG_QUEEN, 2));
    expect(problems[0].reason).toContain("탐색 깊이");
  });

  it("accepts a shallow report when the engine found a mate", () => {
    // A proven mate is correct at any depth; rejecting it would be a false alarm.
    const upload = honestUpload(HUNG_QUEEN);
    upload[2].lines = [{ ...upload[2].lines[0], depth: 1, cp: null, mate: 2 }];
    expect(prepareUploadedEvaluations(HUNG_QUEEN, upload).problems).toEqual([]);
  });

  it("rejects out-of-order MultiPV numbering", () => {
    const upload = honestUpload(HUNG_QUEEN);
    upload[3].lines = [
      { ...upload[3].lines[0], multipv: 2 },
      { ...upload[3].lines[1], multipv: 1 },
    ];
    expect(prepareUploadedEvaluations(HUNG_QUEEN, upload).problems[0].reason).toContain(
      "MultiPV",
    );
  });

  it("rejects an empty evaluation for a position that needed a search", () => {
    const upload = honestUpload(HUNG_QUEEN);
    upload[5] = { lines: [] };
    expect(prepareUploadedEvaluations(HUNG_QUEEN, upload).problems[0].reason).toContain(
      "비어 있습니다",
    );
  });
});

describe("terminal positions are derived, not trusted", () => {
  it("overwrites a checkmate score the client got wrong", () => {
    const upload = honestUpload(WHITE_MATE_WITH_CLOCK);
    const last = upload.length - 1;
    // A client claiming the delivered mate is a dead draw.
    upload[last] = { lines: [{ multipv: 1, depth: 30, cp: 0, mate: null, moves: [] }] };

    const { problems, evaluations } = prepareUploadedEvaluations(
      WHITE_MATE_WITH_CLOCK,
      upload,
    );
    expect(problems).toEqual([]);
    expect(evaluations[last].lines[0].cp).toBe(-MATE_CP);
  });

  it("stores a delivered mate as a signed score rather than mate 0", () => {
    // 0 has no sign, so it could not be flipped between perspectives.
    const { evaluations } = prepareUploadedEvaluations(
      WHITE_MATE_WITH_CLOCK,
      honestUpload(WHITE_MATE_WITH_CLOCK),
    );
    const last = evaluations.length - 1;
    expect(evaluations[last].lines[0].mate).toBeNull();
    expect(evaluations[last].lines[0].cp).toBe(-MATE_CP);
  });
});

describe("rebuilding the analysis on the server", () => {
  it("grades the moves from the uploaded scores and the stored PGN", () => {
    const { evaluations } = prepareUploadedEvaluations(HUNG_QUEEN, honestUpload(HUNG_QUEEN));
    const { moves } = rebuildAnalysis(HUNG_QUEEN, "white", evaluations);

    expect(moves).toHaveLength(parsePgn(HUNG_QUEEN).moves.length);
    // Grading is the server's own work: every player move gets a verdict.
    for (const move of moves.filter((m) => m.isPlayerMove)) {
      expect(move.centipawnLoss).not.toBeNull();
      expect(move.classification).not.toBeNull();
    }
    expect(moves.filter((m) => !m.isPlayerMove).every((m) => m.classification === null)).toBe(
      true,
    );
  });

  it("refuses a set of evaluations that does not match the game", () => {
    expect(() =>
      rebuildAnalysis(HUNG_QUEEN, "white", honestUpload(HUNG_QUEEN).slice(0, 3)),
    ).toThrow(/평가 개수/);
  });

  it("reads the same game differently for each side", () => {
    const { evaluations } = prepareUploadedEvaluations(HUNG_QUEEN, honestUpload(HUNG_QUEEN));
    const white = rebuildAnalysis(HUNG_QUEEN, "white", evaluations).moves;
    const black = rebuildAnalysis(HUNG_QUEEN, "black", evaluations).moves;
    expect(white.filter((m) => m.isPlayerMove).length).toBeGreaterThan(0);
    expect(black.filter((m) => m.isPlayerMove).length).toBeGreaterThan(0);
    // The same ply cannot belong to both players.
    expect(white.map((m) => m.isPlayerMove)).toEqual(black.map((m) => !m.isPlayerMove));
  });
});
