/** Trimmed but structurally faithful Chess.com PubAPI responses. */

export const PROFILE_RESPONSE = {
  player_id: 1234567,
  "@id": "https://api.chess.com/pub/player/testuser",
  url: "https://www.chess.com/member/TestUser",
  username: "TestUser",
  followers: 12,
  country: "https://api.chess.com/pub/country/KR",
  joined: 1600000000,
  last_online: 1756500000,
  status: "basic",
};

export const STATS_RESPONSE = {
  chess_rapid: {
    last: { rating: 1234, date: 1756500000, rd: 30 },
    best: { rating: 1300, date: 1750000000 },
    record: { win: 100, loss: 90, draw: 10 },
  },
  chess_blitz: {
    last: { rating: 1100, date: 1756400000, rd: 40 },
    record: { win: 50, loss: 55, draw: 5 },
  },
};

export const ARCHIVES_RESPONSE = {
  archives: [
    "https://api.chess.com/pub/player/testuser/games/2026/06",
    "https://api.chess.com/pub/player/testuser/games/2026/07",
    "https://api.chess.com/pub/player/testuser/games/2026/08",
  ],
};

const SAMPLE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.01"]
[White "TestUser"]
[Black "Opponent"]
[Result "1-0"]
[ECO "C20"]
[ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening-Wayward-Queen-Attack"]
[TimeControl "600"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

/** One standard game (with accuracies) and one variant that must not be analysed. */
export function monthlyGames() {
  return {
    games: [
      {
        url: "https://www.chess.com/game/live/1000000001",
        pgn: SAMPLE_PGN,
        time_control: "600",
        end_time: 1754000000,
        rated: true,
        tcn: "mCZR",
        uuid: "aaaa",
        initial_setup: "",
        fen: "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq -",
        time_class: "rapid",
        rules: "chess",
        white: { rating: 1234, result: "win", username: "TestUser", uuid: "u1" },
        black: { rating: 1200, result: "checkmated", username: "Opponent", uuid: "u2" },
        accuracies: { white: 91.2, black: 42.5 },
      },
      {
        // No accuracies field at all — must not be treated as required.
        url: "https://www.chess.com/game/live/1000000002",
        pgn: SAMPLE_PGN.replace("1-0", "0-1").replace('[Result "1-0"]', '[Result "0-1"]'),
        time_control: "180",
        end_time: 1754100000,
        rated: true,
        time_class: "blitz",
        rules: "chess",
        white: { rating: 1100, result: "resigned", username: "Opponent", uuid: "u2" },
        black: { rating: 1150, result: "win", username: "TestUser", uuid: "u1" },
      },
      {
        url: "https://www.chess.com/game/live/1000000003",
        pgn: SAMPLE_PGN,
        time_control: "600",
        end_time: 1754200000,
        rated: true,
        time_class: "rapid",
        rules: "chess960",
        white: { rating: 1234, result: "win", username: "TestUser", uuid: "u1" },
        black: { rating: 1200, result: "checkmated", username: "Opponent", uuid: "u2" },
      },
      // Structurally broken entry: must be dropped without killing the month.
      { url: "https://www.chess.com/game/live/1000000004", pgn: 42 },
    ],
  };
}
