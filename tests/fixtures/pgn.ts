/**
 * Fixed PGNs covering the cases the analysis rules must survive.
 * Kept as source so tests never depend on the network.
 */

/** White wins by checkmate (Scholar's mate). Has clock comments. */
export const WHITE_MATE_WITH_CLOCK = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.01"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[ECO "C20"]
[ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening-Wayward-Queen-Attack"]
[TimeControl "600"]
[Termination "alice won by checkmate"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} 2. Qh5 {[%clk 0:09:55]} Nc6 {[%clk 0:09:50]}
3. Bc4 {[%clk 0:09:52]} Nf6 {[%clk 0:09:40]} 4. Qxf7# {[%clk 0:09:48]} 1-0`;

/** Black wins by checkmate (Fool's mate). No clock comments at all. */
export const BLACK_MATE_NO_CLOCK = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.02"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[TimeControl "180"]
[Termination "bob won by checkmate"]

1. f3 e5 2. g4 Qh4# 0-1`;

/** Draw by stalemate. */
export const STALEMATE_DRAW = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.03"]
[White "alice"]
[Black "bob"]
[Result "1/2-1/2"]
[TimeControl "600"]
[Termination "Game drawn by stalemate"]

1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. Qxc7 Rah6 5. h4 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3
8. Qxb8 Qh7 9. Qxc8 Kg6 10. Qe6 1/2-1/2`;

/** Castling, en passant and promotion all appear in this line. */
export const CASTLING_ENPASSANT_PROMOTION = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.04"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[TimeControl "900+10"]
[Termination "alice won by resignation"]

1. e4 Nf6 2. e5 d5 3. exd6 exd6 4. Nf3 Be7 5. Bc4 O-O 6. O-O Nc6 7. d4 Bg4 8. d5 Nb4
9. Re1 Nfxd5 10. Bxd5 Nxd5 11. Nc3 Nxc3 12. bxc3 Bxf3 13. Qxf3 c6 14. Qxc6 Qc7
15. Qxc7 Bd8 16. Qxb7 Bf6 17. Qxa8 Rxa8 18. Rb1 Rc8 19. Rb7 Rxc3 20. Bd2 Rxc2
21. Rxa7 Rxd2 22. a4 Rd4 23. a5 g6 24. a6 Kg7 25. Rb7 Rd5 26. a7 Ra5 27. a8=Q Rxa8 1-0`;

/**
 * White grabs material with 4.Nxe5? and is mated a few moves later (Legal-trap
 * shape). Used to check that the reported cause is the move that lost the game,
 * not the final move played once the position was already hopeless.
 */
export const BLUNDER_AFTER_DECIDED = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.05"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[TimeControl "600"]
[Termination "bob won by checkmate"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

/** A short game where the loser hangs a queen in one move. */
export const HUNG_QUEEN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.06"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[TimeControl "300"]
[Termination "bob won by resignation"]

1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 Bd6 5. Bg3 O-O 6. Bd3 c5 7. c3 Nc6 8. Nbd2 Qc7
9. Qc2 e5 10. dxe5 Nxe5 11. Nxe5 Bxe5 12. Bxe5 Qxe5 13. Qb3 Qxe3+ 0-1`;

/** Malformed PGN: the move text contains an illegal move. */
export const ILLEGAL_MOVE_PGN = `[Event "Broken"]
[White "alice"]
[Black "bob"]
[Result "*"]

1. e4 e5 2. Ke2 Qq9 *`;

export const ALL_VALID_FIXTURES = [
  { name: "white mate with clock", pgn: WHITE_MATE_WITH_CLOCK },
  { name: "black mate without clock", pgn: BLACK_MATE_NO_CLOCK },
  { name: "stalemate draw", pgn: STALEMATE_DRAW },
  { name: "castling/en passant/promotion", pgn: CASTLING_ENPASSANT_PROMOTION },
  { name: "blunder after decided", pgn: BLUNDER_AFTER_DECIDED },
  { name: "hung queen", pgn: HUNG_QUEEN },
];
