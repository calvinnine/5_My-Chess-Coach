import { describe, expect, it } from "vitest";
import {
  isLosingToMate,
  isWinningByMate,
  centipawnLoss,
  classifyMove,
  expectedResult,
  formatEval,
  toClampedCp,
  toPlayerPerspective,
  toScalarCp,
  toWhitePerspective,
  MATE_CP,
} from "@/lib/analysis/eval";

describe("perspective conversion", () => {
  it("keeps the sign when the side to move is the player", () => {
    expect(toPlayerPerspective({ cp: 120, mate: null }, "white", "white")).toEqual({
      cp: 120,
      mate: null,
    });
    expect(toPlayerPerspective({ cp: 120, mate: null }, "black", "black")).toEqual({
      cp: 120,
      mate: null,
    });
  });

  it("flips the sign when the opponent is to move", () => {
    expect(toPlayerPerspective({ cp: 120, mate: null }, "white", "black")).toEqual({
      cp: -120,
      mate: null,
    });
    expect(toPlayerPerspective({ cp: -300, mate: null }, "black", "white")).toEqual({
      cp: 300,
      mate: null,
    });
  });

  it("flips mate distances too", () => {
    // Black to move with mate in 3 means the white player is getting mated.
    expect(toPlayerPerspective({ cp: null, mate: 3 }, "black", "white")).toEqual({
      cp: null,
      mate: -3,
    });
  });

  it("round-trips back to the white-positive axis", () => {
    const playerEval = { cp: 250, mate: null };
    expect(toWhitePerspective(playerEval, "black")).toEqual({ cp: -250, mate: null });
    expect(toWhitePerspective(playerEval, "white")).toEqual({ cp: 250, mate: null });
  });
});

describe("mate score normalisation", () => {
  it("orders shorter mates ahead of longer ones", () => {
    expect(toScalarCp({ cp: null, mate: 1 })).toBeGreaterThan(toScalarCp({ cp: null, mate: 5 }));
    expect(toScalarCp({ cp: null, mate: -1 })).toBeLessThan(toScalarCp({ cp: null, mate: -5 }));
  });

  it("puts any mate beyond any centipawn score", () => {
    expect(toScalarCp({ cp: null, mate: 12 })).toBeGreaterThan(toScalarCp({ cp: 5000, mate: null }));
    expect(toScalarCp({ cp: null, mate: 12 })).toBeLessThanOrEqual(MATE_CP);
  });

  it("treats mate 0 as being mated right now", () => {
    expect(toScalarCp({ cp: null, mate: 0 })).toBe(-MATE_CP);
  });

  it("formats mate and centipawn values distinctly", () => {
    expect(formatEval({ cp: null, mate: 3 })).toBe("M3");
    expect(formatEval({ cp: null, mate: -2 })).toBe("-M2");
    expect(formatEval({ cp: 150, mate: null })).toBe("+1.50");
    expect(formatEval({ cp: -25, mate: null })).toBe("-0.25");
  });
});

describe("centipawn loss", () => {
  it("is never negative even when the played move scores better", () => {
    expect(centipawnLoss({ cp: 10, mate: null }, { cp: 90, mate: null })).toBe(0);
  });

  it("measures the drop from the player's perspective", () => {
    expect(centipawnLoss({ cp: 50, mate: null }, { cp: -150, mate: null })).toBe(200);
  });

  it("clamps swings inside already-decided territory", () => {
    // +30 pawns down to +9 pawns is not a 2100cp mistake.
    const loss = centipawnLoss({ cp: 3000, mate: null }, { cp: 900, mate: null });
    expect(loss).toBe(100);
  });

  it("treats allowing mate as a maximal loss", () => {
    const loss = centipawnLoss({ cp: 0, mate: null }, { cp: null, mate: -2 });
    expect(loss).toBeGreaterThanOrEqual(1000);
  });
});

describe("move classification", () => {
  const grade = (before: number, after: number) => {
    const b = { cp: before, mate: null };
    const a = { cp: after, mate: null };
    return classifyMove({ before: b, after: a, loss: centipawnLoss(b, a), ply: 20 });
  };

  it("uses the documented thresholds in a balanced position", () => {
    expect(grade(0, -10)).toBe("best");
    expect(grade(0, -30)).toBe("good");
    expect(grade(0, -70)).toBe("inaccuracy");
    expect(grade(0, -150)).toBe("mistake");
    expect(grade(0, -400)).toBe("blunder");
  });

  it("does not call a decided position's slip a blunder", () => {
    // Still completely winning before and after.
    expect(grade(900, 620)).toBe("inaccuracy");
    // Still completely lost before and after.
    expect(grade(-900, -1500)).toBe("inaccuracy");
  });

  it("flags allowing mate regardless of centipawn arithmetic", () => {
    const before = { cp: 200, mate: null };
    const after = { cp: null, mate: -1 };
    expect(
      classifyMove({ before, after, loss: centipawnLoss(before, after), ply: 30 }),
    ).toBe("blunder");
  });

  it("flags throwing away a forced mate in a level game", () => {
    const before = { cp: null, mate: 2 };
    const after = { cp: 100, mate: null };
    expect(
      classifyMove({ before, after, loss: centipawnLoss(before, after), ply: 30 }),
    ).toBe("blunder");
  });

  it("does not dramatise a missed mate when the game is won anyway", () => {
    const before = { cp: null, mate: 4 };
    const after = { cp: 1500, mate: null };
    expect(
      classifyMove({ before, after, loss: centipawnLoss(before, after), ply: 30 }),
    ).toBe("inaccuracy");
  });

  it("does not punish being mated when already being mated", () => {
    const before = { cp: null, mate: -3 };
    const after = { cp: null, mate: -1 };
    expect(
      classifyMove({ before, after, loss: centipawnLoss(before, after), ply: 40 }),
    ).not.toBe("blunder");
  });
});

describe("delivered checkmate", () => {
  /*
   * Regression: a finished checkmate used to be stored as `mate: 0`. Negating 0
   * does nothing, so both players' views of the same mate came out as "mated".
   * It is now carried as a saturated centipawn score, which does flip.
   */
  const matedSideToMove = { cp: -MATE_CP, mate: null };

  it("looks lost to the side that got mated and won to the other", () => {
    const forMated = toPlayerPerspective(matedSideToMove, "black", "black");
    const forMater = toPlayerPerspective(matedSideToMove, "black", "white");
    expect(toScalarCp(forMated)).toBeLessThan(0);
    expect(toScalarCp(forMater)).toBeGreaterThan(0);
    expect(toScalarCp(forMated)).toBe(-toScalarCp(forMater));
  });

  it("is recognised as a mate by the helpers", () => {
    expect(isLosingToMate({ cp: -MATE_CP, mate: null })).toBe(true);
    expect(isWinningByMate({ cp: MATE_CP, mate: null })).toBe(true);
    expect(isLosingToMate({ cp: null, mate: -3 })).toBe(true);
    expect(isWinningByMate({ cp: null, mate: 3 })).toBe(true);
    expect(isLosingToMate({ cp: -500, mate: null })).toBe(false);
    expect(isWinningByMate({ cp: 500, mate: null })).toBe(false);
  });

  it("renders as a mate symbol on both sides", () => {
    expect(formatEval({ cp: MATE_CP, mate: null })).toBe("#");
    expect(formatEval({ cp: -MATE_CP, mate: null })).toBe("-#");
  });
});

describe("expected result buckets", () => {
  it("maps evaluations onto coarse outcomes", () => {
    expect(expectedResult({ cp: 800, mate: null })).toBe("winning");
    expect(expectedResult({ cp: 200, mate: null })).toBe("better");
    expect(expectedResult({ cp: 0, mate: null })).toBe("equal");
    expect(expectedResult({ cp: -200, mate: null })).toBe("worse");
    expect(expectedResult({ cp: null, mate: -3 })).toBe("losing");
  });

  it("clamps display values symmetrically", () => {
    expect(toClampedCp({ cp: 5000, mate: null })).toBe(1000);
    expect(toClampedCp({ cp: -5000, mate: null })).toBe(-1000);
  });
});
