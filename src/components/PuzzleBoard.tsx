"use client";

import { useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

/**
 * A board the player can move on, for solving one position.
 *
 * Only legal moves are accepted, and only one move is taken — the exercise is
 * "find the move", not "play out the line". Promotions default to a queen;
 * under-promotion is never the point of these puzzles.
 */
export default function PuzzleBoard({
  fen,
  orientation,
  disabled,
  highlight,
  arrows = [],
  onMove,
}: {
  fen: string;
  orientation: "white" | "black";
  disabled?: boolean;
  highlight?: string[];
  arrows?: Array<{ from: string; to: string; tone: "solution" | "played" }>;
  onMove: (uci: string, san: string) => void;
}) {
  const [selected, setSelected] = useState<Square | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);

  const legalFrom = useMemo(() => {
    if (!selected) return [] as string[];
    return chess.moves({ square: selected, verbose: true }).map((m) => m.to);
  }, [chess, selected]);

  function attempt(from: Square, to: Square): boolean {
    const probe = new Chess(fen);
    let move;
    try {
      move = probe.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    if (!move) return false;
    onMove(`${move.from}${move.to}${move.promotion ?? ""}`, move.san);
    setSelected(null);
    return true;
  }

  const options = useMemo(
    () => ({
      position: fen,
      boardOrientation: orientation,
      allowDragging: !disabled,
      allowDrawingArrows: false,
      showAnimations: false,
      id: "puzzle-board",
      lightSquareStyle: { backgroundColor: "var(--color-board-light)" },
      darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
      boardStyle: {
        borderRadius: "10px",
        overflow: "hidden",
        border: "1px solid var(--color-line-strong)",
      },
      squareStyles: {
        ...Object.fromEntries(
          (highlight ?? []).map((square) => [
            square,
            { boxShadow: "inset 0 0 0 3px var(--color-gold)" },
          ]),
        ),
        ...(selected
          ? { [selected]: { boxShadow: "inset 0 0 0 3px var(--color-accent)" } }
          : {}),
        ...Object.fromEntries(
          legalFrom.map((square) => [
            square,
            {
              background:
                "radial-gradient(circle, var(--color-accent) 18%, transparent 20%)",
            },
          ]),
        ),
      },
      arrows: arrows.map((a) => ({
        startSquare: a.from,
        endSquare: a.to,
        color:
          a.tone === "solution" ? "var(--color-win)" : "var(--color-ink-faint)",
      })),
      onPieceDrop: ({
        sourceSquare,
        targetSquare,
      }: {
        sourceSquare: string;
        targetSquare: string | null;
      }) => {
        if (disabled || !targetSquare) return false;
        return attempt(sourceSquare as Square, targetSquare as Square);
      },
      onSquareClick: ({ square }: { square: string }) => {
        if (disabled) return;
        const target = square as Square;
        if (selected) {
          if (target === selected) {
            setSelected(null);
            return;
          }
          if (attempt(selected, target)) return;
        }
        // Selecting is only meaningful on a piece that can actually move.
        const piece = chess.get(target);
        if (piece && piece.color === chess.turn()) setSelected(target);
        else setSelected(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fen, orientation, disabled, highlight, arrows, selected, legalFrom, chess],
  );

  return (
    <div className="aspect-square w-full">
      <Chessboard options={options} />
    </div>
  );
}
