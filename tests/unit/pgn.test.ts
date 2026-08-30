import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  openingFamily,
  openingNameFromEcoUrl,
  parseClockComment,
  parsePgn,
  phaseFor,
  PgnParseError,
} from "@/lib/pgn/parse";
import {
  ALL_VALID_FIXTURES,
  BLACK_MATE_NO_CLOCK,
  CASTLING_ENPASSANT_PROMOTION,
  ILLEGAL_MOVE_PGN,
  WHITE_MATE_WITH_CLOCK,
} from "../fixtures/pgn";

describe("PGN parsing", () => {
  it("parses every fixture without throwing", () => {
    for (const fixture of ALL_VALID_FIXTURES) {
      const parsed = parsePgn(fixture.pgn);
      expect(parsed.moves.length, fixture.name).toBeGreaterThan(0);
    }
  });

  it("produces FENs that chain: each move's after is the next move's before", () => {
    const parsed = parsePgn(CASTLING_ENPASSANT_PROMOTION);
    for (let i = 1; i < parsed.moves.length; i++) {
      expect(parsed.moves[i].fenBefore).toBe(parsed.moves[i - 1].fenAfter);
    }
  });

  it("handles castling, en passant and promotion", () => {
    const sans = parsePgn(CASTLING_ENPASSANT_PROMOTION).moves.map((m) => m.san);
    expect(sans).toContain("O-O");
    expect(sans).toContain("exd6"); // en passant capture
    expect(sans.some((s) => s.includes("="))).toBe(true);
  });

  it("emits UCI with the promotion piece appended", () => {
    const promotion = parsePgn(CASTLING_ENPASSANT_PROMOTION).moves.find((m) =>
      m.san.includes("="),
    );
    expect(promotion?.uci).toMatch(/^[a-h][1-8][a-h][1-8]q$/);
  });

  it("reads clock comments when present", () => {
    const parsed = parsePgn(WHITE_MATE_WITH_CLOCK);
    expect(parsed.moves[0].clockMs).toBe(598_000);
    expect(parsed.moves.every((m) => m.clockMs !== null)).toBe(true);
  });

  it("leaves clocks null when the PGN has no comments", () => {
    const parsed = parsePgn(BLACK_MATE_NO_CLOCK);
    expect(parsed.moves.every((m) => m.clockMs === null)).toBe(true);
  });

  it("records the final position", () => {
    const parsed = parsePgn(BLACK_MATE_NO_CLOCK);
    expect(new Chess(parsed.finalFen).isCheckmate()).toBe(true);
  });

  it("throws a typed error on an illegal move so the raw PGN can still be stored", () => {
    expect(() => parsePgn(ILLEGAL_MOVE_PGN)).toThrow(PgnParseError);
    try {
      parsePgn(ILLEGAL_MOVE_PGN);
    } catch (err) {
      expect((err as PgnParseError).kind).toBe("invalid");
    }
  });

  it("separates an aborted game from a genuinely broken PGN", () => {
    /*
     * Chess.com records aborted games with headers but no moves. That is a
     * normal record, not a parse failure, and it must not surface to the user
     * as an error.
     */
    const aborted = `[Event "Live Chess"]
[Site "Chess.com"]
[White "alice"]
[Black "bob"]
[Result "1/2-1/2"]
[CurrentPosition "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]

1/2-1/2`;
    try {
      parsePgn(aborted);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PgnParseError);
      expect((err as PgnParseError).kind).toBe("empty");
    }
  });
});

describe("clock comment parsing", () => {
  it("converts h:mm:ss to milliseconds", () => {
    expect(parseClockComment("[%clk 0:01:30]")).toBe(90_000);
    expect(parseClockComment("[%clk 1:00:00]")).toBe(3_600_000);
    expect(parseClockComment("[%clk 0:00:09.5]")).toBe(9_500);
  });

  it("returns null when there is no clock", () => {
    expect(parseClockComment(undefined)).toBeNull();
    expect(parseClockComment("just a comment")).toBeNull();
  });
});

describe("opening names", () => {
  it("derives a readable name from the Chess.com ECO url", () => {
    expect(
      openingNameFromEcoUrl("https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation"),
    ).toBe("Sicilian Defense Najdorf Variation");
  });

  it("groups variations into a family", () => {
    expect(openingFamily("Sicilian Defense Najdorf Variation")).toBe("Sicilian Defense");
    expect(openingFamily(null)).toBeNull();
  });
});

describe("game phase", () => {
  const START = new Chess().fen();

  it("calls the first moves the opening", () => {
    expect(phaseFor(4, START)).toBe("opening");
  });

  it("calls a bare king-and-pawn position the endgame regardless of ply", () => {
    expect(phaseFor(6, "8/5k2/8/8/8/8/5K2/8 w - - 0 1")).toBe("endgame");
  });

  it("calls a full board past the opening the middlegame", () => {
    expect(phaseFor(30, START)).toBe("middlegame");
  });
});
