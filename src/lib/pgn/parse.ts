import { Chess } from "chess.js";

export interface ParsedMove {
  ply: number;
  moveNumber: number;
  color: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  /** Remaining clock in ms, from the PGN %clk comment when present. */
  clockMs: number | null;
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  finalFen: string;
  ecoCode: string | null;
  openingName: string | null;
}

export class PgnParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PgnParseError";
  }
}

const CLOCK_RE = /\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/;

export function parseClockComment(comment: string | undefined): number | null {
  if (!comment) return null;
  const m = CLOCK_RE.exec(comment);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/**
 * Derives a human opening name from the ECO URL Chess.com puts in the PGN,
 * e.g. ".../openings/Sicilian-Defense-Najdorf-Variation" -> "Sicilian Defense
 * Najdorf Variation". Returns null when the tag is absent.
 */
export function openingNameFromEcoUrl(url: string | undefined): string | null {
  if (!url) return null;
  const slug = url.split("/").filter(Boolean).pop();
  if (!slug) return null;
  return decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim() || null;
}

/** Family used for "same opening" comparisons: the first two words of the name. */
export function openingFamily(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return null;
  return parts.slice(0, 2).join(" ");
}

export function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new PgnParseError(`PGN을 해석하지 못했습니다: ${(err as Error).message}`);
  }

  const headers = chess.getHeaders() as unknown as Record<string, string>;
  const history = chess.history({ verbose: true });
  const comments = chess.getComments();
  const commentByFen = new Map(comments.map((c) => [c.fen, c.comment]));

  if (history.length === 0) {
    throw new PgnParseError("PGN에 수가 없습니다.");
  }

  const moves: ParsedMove[] = history.map((move, index) => {
    const ply = index + 1;
    const promotion = move.promotion ? move.promotion : "";
    return {
      ply,
      moveNumber: Math.floor(index / 2) + 1,
      color: move.color === "w" ? "white" : "black",
      san: move.san,
      uci: `${move.from}${move.to}${promotion}`,
      fenBefore: move.before,
      fenAfter: move.after,
      // chess.js keys a move comment by the FEN *after* the move it follows.
      clockMs: parseClockComment(commentByFen.get(move.after)),
    };
  });

  return {
    headers,
    moves,
    finalFen: moves[moves.length - 1].fenAfter,
    ecoCode: headers.ECO ?? null,
    openingName:
      openingNameFromEcoUrl(headers.ECOUrl) ?? headers.Opening ?? null,
  };
}

/** Total pieces on the board, used for the crude phase split. */
export function pieceCount(fen: string): number {
  const placement = fen.split(" ")[0];
  return (placement.match(/[prnbqkPRNBQK]/g) ?? []).length;
}

export function nonPawnMaterial(fen: string): number {
  const placement = fen.split(" ")[0];
  const values: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };
  let total = 0;
  for (const ch of placement) {
    const v = values[ch.toLowerCase()];
    if (v && ch.toLowerCase() !== ch.toUpperCase()) total += v;
  }
  return total;
}

export type Phase = "opening" | "middlegame" | "endgame";

/**
 * Phase by ply and remaining material. Deliberately simple and deterministic —
 * it only feeds weighting and summaries, never a verdict on its own.
 */
export function phaseFor(ply: number, fenBefore: string): Phase {
  const material = nonPawnMaterial(fenBefore);
  if (material <= 16) return "endgame";
  if (ply <= 16) return "opening";
  return "middlegame";
}
