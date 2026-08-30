import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { locateEngine } from "@/lib/engine/locate";
import { parseInfoLine, UciEngine } from "@/lib/engine/uci";
import { analyzeGame, PRESETS } from "@/lib/analysis/analyzer";
import { buildReview, collapsePly, importanceOf, selectTurningPoints } from "@/lib/analysis/review";
import { toClampedCp } from "@/lib/analysis/eval";
import {
  BLACK_MATE_NO_CLOCK,
  BLUNDER_AFTER_DECIDED,
  CASTLING_ENPASSANT_PROMOTION,
  HUNG_QUEEN,
  STALEMATE_DRAW,
  WHITE_MATE_WITH_CLOCK,
} from "../fixtures/pgn";

const location = locateEngine();
const withEngine = location.found ? describe : describe.skip;

// Fast settings: these tests check correctness of the pipeline, not depth.
const FAST = { ...PRESETS.fast, depth: 8, keyMomentDepth: 10 };

describe("UCI info parsing", () => {
  it("reads depth, multipv, score and pv", () => {
    const line = parseInfoLine(
      "info depth 18 seldepth 24 multipv 2 score cp -37 nodes 100 pv e2e4 e7e5 g1f3",
    );
    expect(line).toEqual({
      depth: 18,
      multipv: 2,
      cp: -37,
      mate: null,
      moves: ["e2e4", "e7e5", "g1f3"],
    });
  });

  it("reads a mate score", () => {
    const line = parseInfoLine("info depth 20 multipv 1 score mate -3 pv h7h8q");
    expect(line?.mate).toBe(-3);
    expect(line?.cp).toBeNull();
  });

  it("ignores lines with no pv or no score", () => {
    expect(parseInfoLine("info depth 1 currmove e2e4 currmovenumber 1")).toBeNull();
    expect(parseInfoLine("info string NNUE evaluation using nn-abc.nnue")).toBeNull();
  });
});

withEngine("Stockfish integration", () => {
  let engine: UciEngine;

  beforeAll(async () => {
    engine = new UciEngine({ binaryPath: location.path!, threads: 2, hashMb: 64, multiPv: 2 });
    await engine.start();
  }, 30_000);

  afterAll(async () => {
    await engine?.stop();
  });

  it("starts and reports its version", () => {
    expect(engine.versionName.toLowerCase()).toContain("stockfish");
  });

  it("returns MultiPV lines for a position", async () => {
    const result = await engine.evaluate(new Chess().fen(), { depth: 8 });
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines[0].moves.length).toBeGreaterThan(0);
  }, 30_000);

  it("finds mate in one", async () => {
    // Back-rank mate: white plays Ra8#.
    const result = await engine.evaluate("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", { depth: 12 });
    expect(result.lines[0].mate).toBe(1);
    expect(result.lines[0].moves[0]).toBe("a1a8");
  }, 30_000);

  it("scores relative to the side to move, which the analyzer must flip", async () => {
    // Black is a queen up; Stockfish reports a positive score for black to move.
    const fen = "4k3/8/8/8/8/8/q7/4K3 b - - 0 1";
    const result = await engine.evaluate(fen, { depth: 8 });
    const raw = result.lines[0];
    expect(raw.mate !== null || (raw.cp ?? 0) > 0).toBe(true);
  }, 30_000);

  it("stops cleanly when aborted mid-search", async () => {
    const controller = new AbortController();
    const promise = engine.evaluate(new Chess().fen(), {
      depth: 40,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);
    await expect(promise).rejects.toThrow();
    // The engine must still be usable afterwards.
    const after = await engine.evaluate(new Chess().fen(), { depth: 6 });
    expect(after.lines.length).toBeGreaterThan(0);
  }, 30_000);

  it("leaves no orphan process after stop()", async () => {
    const temp = new UciEngine({ binaryPath: location.path!, threads: 1, hashMb: 16 });
    await temp.start();
    expect(temp.isRunning).toBe(true);
    await temp.stop();
    expect(temp.isRunning).toBe(false);
  }, 30_000);
});

withEngine("game analysis", () => {
  let engine: UciEngine;

  beforeAll(async () => {
    engine = new UciEngine({ binaryPath: location.path!, threads: 2, hashMb: 64, multiPv: 2 });
    await engine.start();
  }, 30_000);

  afterAll(async () => {
    await engine?.stop();
  });

  it("analyses every fixture without crashing", async () => {
    const fixtures = [
      { pgn: WHITE_MATE_WITH_CLOCK, color: "white" as const },
      { pgn: BLACK_MATE_NO_CLOCK, color: "black" as const },
      { pgn: STALEMATE_DRAW, color: "white" as const },
      { pgn: HUNG_QUEEN, color: "white" as const },
      { pgn: BLUNDER_AFTER_DECIDED, color: "white" as const },
      { pgn: CASTLING_ENPASSANT_PROMOTION, color: "white" as const },
    ];
    for (const fixture of fixtures) {
      const result = await analyzeGame(fixture.pgn, fixture.color, engine, FAST);
      expect(result.moves.length).toBeGreaterThan(0);
      // Only the registered player's moves get a quality verdict.
      for (const move of result.moves) {
        if (move.isPlayerMove) expect(move.color).toBe(fixture.color);
        else expect(move.classification).toBeNull();
      }
    }
  }, 300_000);

  it("never records a negative centipawn loss", async () => {
    const result = await analyzeGame(HUNG_QUEEN, "white", engine, FAST);
    for (const move of result.moves) {
      if (move.centipawnLoss !== null) expect(move.centipawnLoss).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("gives both sides a mirrored view of the same game", async () => {
    // Analysed as white and as black, the evaluations must be mirror images.
    // The engine's own numbers wobble a little between searches, so this checks
    // the sign relationship rather than exact equality: a perspective bug flips
    // signs, it does not shift a score by a few centipawns.
    const asWhite = await analyzeGame(WHITE_MATE_WITH_CLOCK, "white", engine, FAST);
    const asBlack = await analyzeGame(WHITE_MATE_WITH_CLOCK, "black", engine, FAST);
    for (let i = 0; i < asWhite.moves.length; i++) {
      const w = toClampedCp(asWhite.moves[i].evalAfter);
      const b = toClampedCp(asBlack.moves[i].evalAfter);
      expect(Math.abs(w + b)).toBeLessThanOrEqual(60);
      if (Math.abs(w) > 150) expect(Math.sign(w)).toBe(-Math.sign(b));
    }
  }, 180_000);

  it("sees the losing side of a mate as losing", async () => {
    const result = await analyzeGame(WHITE_MATE_WITH_CLOCK, "black", engine, FAST);
    const last = result.moves.at(-1)!;
    expect(toClampedCp(last.evalAfter)).toBeLessThan(0);
  }, 120_000);

  it("does not blame the final move of an already lost game", async () => {
    const result = await analyzeGame(BLUNDER_AFTER_DECIDED, "white", engine, FAST);
    const turningPoints = selectTurningPoints(result.moves);
    const lastPlayerPly = result.moves.filter((m) => m.isPlayerMove).at(-1)!.ply;
    // The real mistake happens early; the final move in a lost position must not
    // outrank it.
    if (turningPoints.length > 0) {
      expect(turningPoints[0].ply).toBeLessThan(lastPlayerPly);
    }
  }, 120_000);

  it("reports at most three turning points", async () => {
    const result = await analyzeGame(HUNG_QUEEN, "white", engine, FAST);
    expect(selectTurningPoints(result.moves).length).toBeLessThanOrEqual(3);
  }, 120_000);

  it("builds a review that stands alone without any LLM", async () => {
    const result = await analyzeGame(HUNG_QUEEN, "white", engine, FAST);
    const review = buildReview({
      moves: result.moves,
      result: "loss",
      playerColor: "white",
      openingName: "Queen's Pawn Opening",
      termination: "기권",
    });
    expect(review.headline.length).toBeGreaterThan(0);
    expect(review.checklist.length).toBeGreaterThan(0);
    expect(review.reflectionQuestion.length).toBeGreaterThan(0);
    expect(review.overallSummary).toContain("평균 평가 손실");
  }, 120_000);

  it("can be cancelled part-way through a game", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await expect(
      analyzeGame(CASTLING_ENPASSANT_PROMOTION, "white", engine, PRESETS.precise, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  }, 60_000);
});

describe("turning point weighting (no engine required)", () => {
  const base = {
    ply: 30,
    moveNumber: 15,
    color: "white" as const,
    san: "Qd2",
    uci: "d1d2",
    fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1",
    fenAfter: "8/8/8/8/8/8/8/8 b - - 0 1",
    bestMoveUci: null,
    bestMoveSan: null,
    bestLine: null,
    secondBestCp: null,
    themes: [],
    strengths: [],
    clockMs: null,
    phase: "middlegame" as const,
    isPlayerMove: true,
    classification: "blunder" as const,
  };

  it("ranks a game-losing move above an equally large drop in a lost position", () => {
    const decisive = importanceOf({
      ...base,
      evalBefore: { cp: 50, mate: null },
      evalAfter: { cp: -450, mate: null },
      centipawnLoss: 500,
    });
    const irrelevant = importanceOf({
      ...base,
      evalBefore: { cp: -900, mate: null },
      evalAfter: { cp: -1400, mate: null },
      centipawnLoss: 500,
    });
    expect(decisive).toBeGreaterThan(irrelevant * 3);
  });

  function playerMove(
    ply: number,
    beforeCp: number,
    afterCp: number,
  ) {
    return {
      ...base,
      ply,
      moveNumber: Math.ceil(ply / 2),
      evalBefore: { cp: beforeCp, mate: null },
      evalAfter: { cp: afterCp, mate: null },
      centipawnLoss: Math.max(0, beforeCp - afterCp),
    };
  }

  it("finds the move that lost the game, not a later one", () => {
    const moves = [
      playerMove(9, 70, -450), // the collapse
      playerMove(11, -450, -520),
      playerMove(13, -520, -1000), // allows mate, but the game was already gone
    ];
    expect(collapsePly(moves)).toBe(9);
    const picked = selectTurningPoints(moves);
    expect(picked[0].ply).toBe(9);
  });

  it("names the most important turning point in the headline, not the earliest", () => {
    const moves = [
      playerMove(10, 50, -170), // earlier, but minor
      playerMove(16, 450, -470), // the move that actually decided the game
    ];
    const review = buildReview({
      moves,
      result: "loss",
      playerColor: "white",
      openingName: null,
      termination: null,
    });
    const points = selectTurningPoints(moves);
    const mostImportant = [...points].sort((a, b) => b.importance - a.importance)[0];
    expect(mostImportant.moveNumber).toBe(8);
    expect(review.headline).toContain(`${mostImportant.moveNumber}수째`);
    // Listing order stays board order so the reader can follow the game.
    expect(points.map((p) => p.ply)).toEqual([...points.map((p) => p.ply)].sort((a, b) => a - b));
  });

  it("does not treat a dip the player recovered from as the collapse", () => {
    const moves = [
      playerMove(9, 70, -400),
      playerMove(11, -400, 20), // back to playable
      playerMove(13, 20, -600),
    ];
    expect(collapsePly(moves)).toBe(13);
  });

  it("de-emphasises small losses in the first few moves", () => {
    const opening = importanceOf({
      ...base,
      ply: 6,
      phase: "opening",
      evalBefore: { cp: 20, mate: null },
      evalAfter: { cp: -60, mate: null },
      centipawnLoss: 80,
    });
    const middlegame = importanceOf({
      ...base,
      evalBefore: { cp: 20, mate: null },
      evalAfter: { cp: -60, mate: null },
      centipawnLoss: 80,
    });
    expect(opening).toBeLessThan(middlegame);
  });
});
