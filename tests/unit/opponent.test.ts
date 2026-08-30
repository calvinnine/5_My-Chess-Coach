import { describe, expect, it } from "vitest";
import { classifyOpponent, pgnHeader } from "@/lib/chesscom/opponent";

function pgn(event: string, white = "Calvinnine", black = "someone") {
  return `[Event "${event}"]
[Site "Chess.com"]
[White "${white}"]
[Black "${black}"]
[Result "1-0"]

1. e4 e5 1-0`;
}

describe("opponent classification", () => {
  it("reads a PGN header", () => {
    expect(pgnHeader(pgn("Live Chess"), "Event")).toBe("Live Chess");
    expect(pgnHeader(pgn("Live Chess"), "Missing")).toBeNull();
  });

  it("treats an ordinary live game as human", () => {
    expect(classifyOpponent(pgn("Live Chess"))).toBe("human");
  });

  it("detects Chess.com coach games", () => {
    expect(classifyOpponent(pgn("Play vs Coach", "Coach-Dante", "Calvinnine"))).toBe("coach");
  });

  it("detects bot games", () => {
    expect(classifyOpponent(pgn("Computer opponent"))).toBe("bot");
  });

  it("does not misclassify real players whose names contain coach or bot", () => {
    /*
     * Regression guard: matching on the username would drop these real rated
     * games from the user's record. Only the Event header is authoritative.
     */
    expect(classifyOpponent(pgn("Live Chess", "Calvinnine", "coachc12"))).toBe("human");
    expect(classifyOpponent(pgn("Live Chess", "Calvinnine", "bothamra"))).toBe("human");
    expect(classifyOpponent(pgn("Live Chess", "Botvinnik_fan", "Calvinnine"))).toBe("human");
  });
});
