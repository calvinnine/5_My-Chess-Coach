/** Who the game was actually played against. */
export type OpponentKind = "human" | "coach" | "bot";

/*
 * Chess.com labels non-human games in the PGN Event header. Matching on the
 * username instead would be wrong: real players are called things like
 * "coachc12" and "bothamra", and excluding them would silently drop real games
 * from the user's record.
 */
const COACH_EVENTS = ["play vs coach", "coach game"];
const BOT_EVENTS = ["computer opponent", "play vs bot", "bot game", "vs computer"];

/** Reads the value of a PGN header tag, or null when absent. */
export function pgnHeader(pgn: string, tag: string): string | null {
  const match = new RegExp(`^\\[${tag}\\s+"([^"]*)"\\]`, "m").exec(pgn);
  return match ? match[1] : null;
}

export function classifyOpponent(pgn: string): OpponentKind {
  const event = (pgnHeader(pgn, "Event") ?? "").toLowerCase().trim();
  if (COACH_EVENTS.some((e) => event.includes(e))) return "coach";
  if (BOT_EVENTS.some((e) => event.includes(e))) return "bot";
  return "human";
}

export const OPPONENT_KIND_LABEL: Record<OpponentKind, string> = {
  human: "사람",
  coach: "코치 연습",
  bot: "봇 연습",
};
