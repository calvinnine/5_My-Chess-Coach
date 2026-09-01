/**
 * What the player actually prepares, inferred from what they actually play.
 *
 * The app deliberately does not ask the user to declare a repertoire. Declared
 * and real repertoires drift apart, and the thing that matters for coaching is
 * the second one: which positions they have seen enough times to have a plan in.
 */

/** A family must reach this share of the player's games with that colour. */
export const REPERTOIRE_MIN_SHARE = 0.05;
/** …and this many games, so a small sample cannot manufacture a repertoire. */
export const REPERTOIRE_MIN_GAMES = 8;
/** Below this many games with a colour, no claim is made either way. */
export const REPERTOIRE_MIN_SAMPLE = 30;

export interface RepertoireGameInput {
  openingFamily: string | null;
  playerColor: "white" | "black";
}

export interface ColourRepertoire {
  color: "white" | "black";
  /** Analysed games with this colour. */
  sampleSize: number;
  /** Families the player plays often enough to be considered prepared. */
  prepared: Array<{ family: string; games: number; share: number }>;
  /** True when there were too few games to infer anything. */
  undetermined: boolean;
}

export type Repertoire = Record<"white" | "black", ColourRepertoire>;

function inferForColour(
  games: RepertoireGameInput[],
  color: "white" | "black",
): ColourRepertoire {
  const mine = games.filter((g) => g.playerColor === color);
  const sampleSize = mine.length;
  if (sampleSize < REPERTOIRE_MIN_SAMPLE) {
    return { color, sampleSize, prepared: [], undetermined: true };
  }

  const counts = new Map<string, number>();
  for (const g of mine) {
    if (!g.openingFamily) continue;
    counts.set(g.openingFamily, (counts.get(g.openingFamily) ?? 0) + 1);
  }

  const prepared = [...counts.entries()]
    .map(([family, count]) => ({ family, games: count, share: count / sampleSize }))
    .filter((f) => f.games >= REPERTOIRE_MIN_GAMES && f.share >= REPERTOIRE_MIN_SHARE)
    // Deterministic: by frequency, then name.
    .sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));

  return { color, sampleSize, prepared, undetermined: false };
}

export function inferRepertoire(games: RepertoireGameInput[]): Repertoire {
  return {
    white: inferForColour(games, "white"),
    black: inferForColour(games, "black"),
  };
}

/**
 * Whether a game was played inside the prepared repertoire.
 *
 * Returns null when no judgement can be made — too few games with that colour,
 * or the opening could not be identified. Null is not "outside": treating an
 * unknown as a departure would invent a weakness out of missing data.
 */
export function isInRepertoire(
  repertoire: Repertoire,
  game: RepertoireGameInput,
): boolean | null {
  const forColour = repertoire[game.playerColor];
  if (forColour.undetermined || forColour.prepared.length === 0) return null;
  if (!game.openingFamily) return null;
  return forColour.prepared.some((f) => f.family === game.openingFamily);
}

export interface RepertoireSplit {
  inside: { games: number; score: number; averageLossCp: number | null };
  outside: { games: number; score: number; averageLossCp: number | null };
  /** outside − inside, in centipawns. Positive means worse off-repertoire. */
  lossGapCp: number | null;
  /** inside − outside, as a score fraction. Positive means worse off-repertoire. */
  scoreGap: number | null;
}

export interface RepertoireSplitInput {
  openingFamily: string | null;
  playerColor: "white" | "black";
  result: "win" | "loss" | "draw";
  averageLossCp: number | null;
}

const points = (result: "win" | "loss" | "draw") =>
  result === "win" ? 1 : result === "draw" ? 0.5 : 0;

/**
 * Compares performance inside and outside the inferred repertoire.
 *
 * This is what turns "you lose more as black" into something actionable: the
 * question is not the colour, it is whether the player is in a position they
 * have prepared for.
 */
export function splitByRepertoire(
  repertoire: Repertoire,
  games: RepertoireSplitInput[],
): RepertoireSplit {
  const buckets = { inside: [] as RepertoireSplitInput[], outside: [] as RepertoireSplitInput[] };
  for (const game of games) {
    const verdict = isInRepertoire(repertoire, game);
    if (verdict === null) continue;
    buckets[verdict ? "inside" : "outside"].push(game);
  }

  const summarise = (rows: RepertoireSplitInput[]) => {
    if (rows.length === 0) return { games: 0, score: 0, averageLossCp: null };
    const withLoss = rows.filter((r) => r.averageLossCp !== null);
    return {
      games: rows.length,
      score: rows.reduce((sum, r) => sum + points(r.result), 0) / rows.length,
      averageLossCp: withLoss.length
        ? Math.round(
            withLoss.reduce((sum, r) => sum + (r.averageLossCp ?? 0), 0) / withLoss.length,
          )
        : null,
    };
  };

  const inside = summarise(buckets.inside);
  const outside = summarise(buckets.outside);

  return {
    inside,
    outside,
    lossGapCp:
      inside.averageLossCp !== null && outside.averageLossCp !== null
        ? outside.averageLossCp - inside.averageLossCp
        : null,
    scoreGap:
      inside.games > 0 && outside.games > 0 ? inside.score - outside.score : null,
  };
}
