/** Pure mapping of Chess.com result codes. Kept free of server-only imports. */

const LOSS_CODES = new Set([
  "checkmated",
  "timeout",
  "resigned",
  "lose",
  "abandoned",
  "kingofthehill",
  "threecheck",
  "bughousepartnerlose",
]);

const DRAW_CODES = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

export const TERMINATION_LABELS: Record<string, string> = {
  checkmated: "체크메이트",
  timeout: "시간패",
  resigned: "기권",
  abandoned: "기권(이탈)",
  agreed: "합의 무승부",
  repetition: "동형반복",
  stalemate: "스테일메이트",
  insufficient: "기물 부족",
  "50move": "50수 규칙",
  timevsinsufficient: "시간 대 기물 부족",
  win: "승리",
};

export function resultFor(code: string | undefined): "win" | "loss" | "draw" {
  if (!code) return "draw";
  if (code === "win") return "win";
  if (DRAW_CODES.has(code)) return "draw";
  if (LOSS_CODES.has(code)) return "loss";
  return "draw";
}
