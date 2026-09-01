import { describe, expect, it } from "vitest";
import {
  gradeAttempt,
  isPuzzleWorthy,
  selectPuzzles,
  toPuzzle,
  PUZZLE_MIN_LOSS,
  PUZZLE_MIN_MARGIN,
  type PuzzleCandidate,
} from "@/lib/coaching/puzzles";

/** A legal middlegame position with white to move. */
const FEN = "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9";

function candidate(overrides: Partial<PuzzleCandidate> = {}): PuzzleCandidate {
  return {
    moveAnalysisId: 1,
    gameId: 10,
    ply: 17,
    moveNumber: 9,
    color: "white",
    fenBefore: FEN,
    playedUci: "a2a3",
    playedSan: "a3",
    bestMoveUci: "f3e5",
    bestMoveSan: "Ne5",
    bestLine: "Ne5 Nxe5 dxe5",
    centipawnLoss: 250,
    evalBeforeCp: 40,
    mateBefore: null,
    secondBestCp: -120,
    themes: ["hanging_piece"],
    playedAt: 1_700_000_000,
    opponentUsername: "opponent",
    ...overrides,
  };
}

describe("what makes a fair puzzle", () => {
  it("accepts a clear mistake with one clearly best answer", () => {
    expect(isPuzzleWorthy(candidate())).toBe(true);
  });

  it("rejects a position where the player already found the best move", () => {
    expect(isPuzzleWorthy(candidate({ playedUci: "f3e5" }))).toBe(false);
  });

  it("rejects a small inaccuracy", () => {
    expect(isPuzzleWorthy(candidate({ centipawnLoss: PUZZLE_MIN_LOSS - 1 }))).toBe(false);
  });

  it("rejects a position with two equally good answers", () => {
    /*
     * Without a clear margin the grader would mark a perfectly good move wrong,
     * which teaches the player something false.
     */
    expect(
      isPuzzleWorthy(candidate({ evalBeforeCp: 40, secondBestCp: 40 - (PUZZLE_MIN_MARGIN - 1) })),
    ).toBe(false);
  });

  it("rejects a position that was already decided", () => {
    expect(isPuzzleWorthy(candidate({ evalBeforeCp: 900 }))).toBe(false);
    expect(isPuzzleWorthy(candidate({ evalBeforeCp: -900 }))).toBe(false);
  });

  it("rejects positions involving a forced mate", () => {
    // A mate exercise is a different task; mixing them muddles both.
    expect(isPuzzleWorthy(candidate({ mateBefore: 3 }))).toBe(false);
  });

  it("rejects a stored best move that is not legal in the position", () => {
    expect(isPuzzleWorthy(candidate({ bestMoveUci: "a1a8", bestMoveSan: "Ra8" }))).toBe(false);
  });

  it("rejects a position whose side to move is not the player", () => {
    expect(isPuzzleWorthy(candidate({ color: "black" }))).toBe(false);
  });

  it("rejects a malformed FEN rather than throwing", () => {
    expect(isPuzzleWorthy(candidate({ fenBefore: "not a fen" }))).toBe(false);
  });

  it("rejects a candidate with no engine recommendation", () => {
    expect(isPuzzleWorthy(candidate({ bestMoveUci: null, bestMoveSan: null }))).toBe(false);
  });
});

describe("building the puzzle", () => {
  it("puts the player on move in their own orientation", () => {
    const puzzle = toPuzzle(candidate())!;
    expect(puzzle.orientation).toBe("white");
    expect(puzzle.fen).toBe(FEN);
    expect(puzzle.solutionSan).toBe("Ne5");
  });

  it("writes a prompt matching the weakness being practised", () => {
    expect(toPuzzle(candidate({ themes: ["allowed_fork"] }))!.prompt).toContain("두 기물");
    expect(toPuzzle(candidate({ themes: ["hanging_piece"] }))!.prompt).toContain("보호받지");
  });

  it("falls back to a neutral prompt for an untagged position", () => {
    expect(toPuzzle(candidate({ themes: [] }))!.prompt).toContain("더 나은 수");
  });

  it("records how much better the answer is than the runner-up", () => {
    expect(toPuzzle(candidate({ evalBeforeCp: 40, secondBestCp: -160 }))!.marginCp).toBe(200);
  });
});

describe("choosing a practice set", () => {
  const set = [
    candidate({ moveAnalysisId: 1, centipawnLoss: 150, themes: ["hanging_piece"] }),
    candidate({ moveAnalysisId: 2, centipawnLoss: 400, themes: ["allowed_fork"] }),
    candidate({ moveAnalysisId: 3, centipawnLoss: 300, themes: ["hanging_piece"] }),
    // Not puzzle-worthy: no margin over the runner-up.
    candidate({ moveAnalysisId: 4, centipawnLoss: 900, secondBestCp: 40, themes: ["hanging_piece"] }),
  ];

  it("filters by the weakness being practised", () => {
    expect(selectPuzzles(set, { tag: "hanging_piece" }).map((p) => p.id)).toEqual([3, 1]);
  });

  it("orders by how much the mistake cost", () => {
    expect(selectPuzzles(set).map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it("drops candidates that would be unfair puzzles", () => {
    expect(selectPuzzles(set).map((p) => p.id)).not.toContain(4);
  });

  it("pushes already-solved positions to the back without hiding them", () => {
    // Solving one once is not the same as having fixed the habit.
    const ordered = selectPuzzles(set, { solvedIds: new Set([2]) }).map((p) => p.id);
    expect(ordered).toEqual([3, 1, 2]);
  });

  it("respects the requested size", () => {
    expect(selectPuzzles(set, { limit: 2 })).toHaveLength(2);
  });
});

describe("grading", () => {
  const puzzle = toPuzzle(candidate())!;

  it("accepts the engine's move", () => {
    expect(gradeAttempt(puzzle, "f3e5")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(gradeAttempt(puzzle, "a2a3")).toBe(false);
    expect(gradeAttempt(puzzle, "d1c2")).toBe(false);
  });
});
