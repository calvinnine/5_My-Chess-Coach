"use client";

import { useMemo } from "react";
import { Chessboard } from "react-chessboard";

export interface BoardArrow {
  from: string;
  to: string;
  tone: "actual" | "best";
}

/**
 * Read-only review board. Dragging is off on purpose: this app never plays
 * moves, it only walks through games that already happened.
 */
export default function ReviewBoard({
  fen,
  orientation,
  arrows = [],
  highlight = [],
}: {
  fen: string;
  orientation: "white" | "black";
  arrows?: BoardArrow[];
  highlight?: string[];
}) {
  const options = useMemo(
    () => ({
      position: fen,
      boardOrientation: orientation,
      allowDragging: false,
      allowDrawingArrows: false,
      showAnimations: false,
      id: "review-board",
      lightSquareStyle: { backgroundColor: "var(--color-board-light)" },
      darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
      boardStyle: {
        borderRadius: "10px",
        overflow: "hidden",
        border: "1px solid var(--color-line-strong)",
      },
      squareStyles: Object.fromEntries(
        highlight.map((square) => [
          square,
          { boxShadow: "inset 0 0 0 3px var(--color-gold)" },
        ]),
      ),
      arrows: arrows.map((a) => ({
        startSquare: a.from,
        endSquare: a.to,
        color: a.tone === "best" ? "var(--color-accent)" : "var(--color-ink-faint)",
      })),
    }),
    [fen, orientation, arrows, highlight],
  );

  // The board fills its container in both axes, so the container must be square.
  return (
    <div className="aspect-square w-full">
      <Chessboard options={options} />
    </div>
  );
}
