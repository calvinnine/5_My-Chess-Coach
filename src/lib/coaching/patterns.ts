import { TAG_BY_ID, WEAKNESS_TAGS, STRENGTH_TAGS } from "./tags";
import type { RepertoireSplit } from "./repertoire";

/** Minimum analysed games before any personal trait may be stated. */
export const MIN_SAMPLE_GAMES = 10;
export const CANDIDATE_WINDOW = 20;
export const CANDIDATE_MIN_GAMES = 3;
export const CONFIRMED_WINDOW = 30;
export const CONFIRMED_MIN_GAMES = 5;
export const CONFIRMED_MIN_OPENINGS = 2;
export const OPENING_SPECIFIC_MIN = 3;
/** How much more often than usual it must happen there to count as specific. */
export const OPENING_SPECIFIC_LIFT = 1.5;

export interface PatternGameInput {
  gameId: number;
  playedAt: number;
  openingFamily: string | null;
  opponentUsername: string;
  result: "win" | "loss" | "draw";
  /** One entry per detected occurrence, with the ply it happened on. */
  occurrences: Array<{ tag: string; ply: number; moveNumber: number; san: string; detail: string }>;
}

export type PatternStatus = "observing" | "candidate" | "confirmed";

export interface AggregatedPattern {
  tag: string;
  label: string;
  description: string;
  patternType: "weakness" | "strength";
  status: PatternStatus;
  /** Total analysed games available. Drives the observing/confirmed gate. */
  sampleSize: number;
  /**
   * How many games the counts below actually cover — the recent window, not the
   * whole sample. Reporting `gameCount` against `sampleSize` understates the
   * frequency badly: 20 of the last 30 is not 20 of 314.
   */
  windowSize: number;
  occurrenceCount: number;
  gameCount: number;
  distinctOpenings: number;
  distinctOpponents: number;
  severityScore: number;
  confidenceScore: number;
  evidenceGameIds: number[];
  evidence: Array<{
    gameId: number;
    ply: number;
    moveNumber: number;
    san: string;
    detail: string;
  }>;
  openingSpecific: string | null;
  periodStart: number | null;
  periodEnd: number | null;
}

/**
 * Rolls per-game occurrences up into personal patterns.
 *
 * The thresholds here are the guard against over-generalising: below
 * MIN_SAMPLE_GAMES analysed games nothing is ever promoted past "observing",
 * and a weakness is only "confirmed" when it repeats across different openings.
 *
 * Pure and deterministic — the same games always yield the same scores.
 */
export function aggregatePatterns(games: PatternGameInput[]): AggregatedPattern[] {
  const sorted = [...games].sort((a, b) => b.playedAt - a.playedAt);
  const sampleSize = sorted.length;
  const candidateWindow = sorted.slice(0, CANDIDATE_WINDOW);
  const confirmedWindow = sorted.slice(0, CONFIRMED_WINDOW);

  const tagIds = new Set<string>();
  for (const game of sorted) for (const occ of game.occurrences) tagIds.add(occ.tag);

  const results: AggregatedPattern[] = [];

  for (const tag of tagIds) {
    const def = TAG_BY_ID[tag];
    if (!def) continue;
    const isStrength = STRENGTH_TAGS.some((t) => t.tag === tag);

    const inConfirmed = confirmedWindow.filter((g) =>
      g.occurrences.some((o) => o.tag === tag),
    );
    const inCandidate = candidateWindow.filter((g) =>
      g.occurrences.some((o) => o.tag === tag),
    );
    if (inConfirmed.length === 0) continue;

    const occurrences = inConfirmed.flatMap((g) =>
      g.occurrences.filter((o) => o.tag === tag).map((o) => ({ ...o, gameId: g.gameId })),
    );
    const openings = new Set(
      inConfirmed.map((g) => g.openingFamily).filter((o): o is string => Boolean(o)),
    );
    const opponents = new Set(inConfirmed.map((g) => g.opponentUsername));

    let status: PatternStatus = "observing";
    if (sampleSize >= MIN_SAMPLE_GAMES) {
      if (
        inConfirmed.length >= CONFIRMED_MIN_GAMES &&
        openings.size >= CONFIRMED_MIN_OPENINGS
      ) {
        status = "confirmed";
      } else if (inCandidate.length >= CANDIDATE_MIN_GAMES) {
        status = "candidate";
      }
    }

    /*
     * Opening-specific problem.
     *
     * Raw counts do not work here: the opening played most often collects the
     * most occurrences and gets flagged every time, which is how the most-played
     * defence ended up labelled as the cause of weaknesses it was actually
     * *below* average for. What makes a problem opening-specific is that it
     * happens disproportionately often there.
     */
    const affectedByOpening = new Map<string, number>();
    const playedByOpening = new Map<string, number>();
    for (const g of confirmedWindow) {
      if (!g.openingFamily) continue;
      playedByOpening.set(g.openingFamily, (playedByOpening.get(g.openingFamily) ?? 0) + 1);
    }
    for (const g of inConfirmed) {
      if (!g.openingFamily) continue;
      affectedByOpening.set(g.openingFamily, (affectedByOpening.get(g.openingFamily) ?? 0) + 1);
    }

    const overallRate = inConfirmed.length / Math.max(1, confirmedWindow.length);
    const openingSpecific =
      [...affectedByOpening.entries()]
        .map(([family, affected]) => ({
          family,
          affected,
          rate: affected / Math.max(1, playedByOpening.get(family) ?? 1),
        }))
        .filter(
          (o) =>
            o.affected >= OPENING_SPECIFIC_MIN &&
            o.rate >= overallRate * OPENING_SPECIFIC_LIFT,
        )
        // Most disproportionate first, then most affected, then name.
        .sort(
          (a, b) => b.rate - a.rate || b.affected - a.affected || a.family.localeCompare(b.family),
        )[0]?.family ?? null;

    const frequency = inConfirmed.length / Math.max(1, confirmedWindow.length);
    const severityScore = round2(frequency * def.weight * 100);

    // Confidence blends sample size, repetition, and variety of contexts.
    const sampleFactor = Math.min(1, sampleSize / CONFIRMED_WINDOW);
    const repeatFactor = Math.min(1, inConfirmed.length / CONFIRMED_MIN_GAMES);
    const varietyFactor = Math.min(1, (openings.size + opponents.size) / 6);
    const confidenceScore = round2(
      (sampleFactor * 0.4 + repeatFactor * 0.4 + varietyFactor * 0.2) * 100,
    );

    results.push({
      tag,
      label: def.label,
      description: def.description,
      patternType: isStrength ? "strength" : "weakness",
      status,
      sampleSize,
      windowSize: confirmedWindow.length,
      occurrenceCount: occurrences.length,
      gameCount: inConfirmed.length,
      distinctOpenings: openings.size,
      distinctOpponents: opponents.size,
      severityScore,
      confidenceScore,
      evidenceGameIds: [...new Set(inConfirmed.map((g) => g.gameId))],
      evidence: occurrences
        .slice()
        .sort((a, b) => a.gameId - b.gameId || a.ply - b.ply)
        .slice(0, 6),
      openingSpecific,
      periodStart: sorted.at(-1)?.playedAt ?? null,
      periodEnd: sorted[0]?.playedAt ?? null,
    });
  }

  // Deterministic ordering: severity, then repetition, then tag name.
  return results.sort(
    (a, b) =>
      b.severityScore - a.severityScore ||
      b.gameCount - a.gameCount ||
      a.tag.localeCompare(b.tag),
  );
}

/** Minimum off-repertoire games before the gap is worth reporting. */
export const REPERTOIRE_GAP_MIN_GAMES = 15;
/** How much worse off-repertoire play must be, in centipawns, to count. */
export const REPERTOIRE_GAP_MIN_LOSS = 6;

/**
 * Turns a repertoire split into a pattern, when the gap is real.
 *
 * This is a cross-game observation by nature — no single move shows it — so it
 * is built here rather than detected per ply. It still obeys the same rules as
 * every other weakness: enough sample, a measured effect, and evidence games.
 */
export function repertoireGapPattern(
  split: RepertoireSplit,
  options: {
    sampleSize: number;
    evidenceGameIds: number[];
    evidence: AggregatedPattern["evidence"];
    periodStart: number | null;
    periodEnd: number | null;
  },
): AggregatedPattern | null {
  const def = TAG_BY_ID.out_of_repertoire;
  if (!def) return null;
  if (options.sampleSize < MIN_SAMPLE_GAMES) return null;
  if (split.outside.games < REPERTOIRE_GAP_MIN_GAMES) return null;
  if (split.inside.games < REPERTOIRE_GAP_MIN_GAMES) return null;
  if (split.lossGapCp === null || split.lossGapCp < REPERTOIRE_GAP_MIN_LOSS) return null;

  // Severity scales with the size of the gap, capped so it cannot dwarf
  // everything else: 20cp worse off-repertoire is a big effect.
  const severityScore = round2(Math.min(1, split.lossGapCp / 20) * def.weight * 100);

  // Confidence comes from how much evidence sits on the thinner side of the
  // comparison, plus how consistently the two sides disagree.
  const sampleFactor = Math.min(1, split.outside.games / (REPERTOIRE_GAP_MIN_GAMES * 2));
  const effectFactor = Math.min(1, split.lossGapCp / 15);
  const scoreFactor =
    split.scoreGap !== null ? Math.min(1, Math.max(0, split.scoreGap) / 0.15) : 0;
  const confidenceScore = round2(
    (sampleFactor * 0.45 + effectFactor * 0.35 + scoreFactor * 0.2) * 100,
  );

  const scoreText =
    split.scoreGap !== null
      ? ` 승률은 ${(split.inside.score * 100).toFixed(0)}% → ${(split.outside.score * 100).toFixed(0)}%로 내려갑니다.`
      : "";

  return {
    tag: def.tag,
    label: def.label,
    description:
      `주력 오프닝에서는 평균 손실 ${split.inside.averageLossCp}cp인데, ` +
      `그 밖에서는 ${split.outside.averageLossCp}cp입니다.${scoreText}`,
    patternType: "weakness",
    status: "confirmed",
    sampleSize: options.sampleSize,
    windowSize: split.inside.games + split.outside.games,
    occurrenceCount: split.outside.games,
    gameCount: split.outside.games,
    distinctOpenings: 0,
    distinctOpponents: 0,
    severityScore,
    confidenceScore,
    evidenceGameIds: options.evidenceGameIds,
    evidence: options.evidence,
    openingSpecific: null,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
  };
}

export function topWeaknesses(patterns: AggregatedPattern[], limit = 3) {
  const rank: Record<PatternStatus, number> = { confirmed: 2, candidate: 1, observing: 0 };
  return patterns
    .filter((p) => p.patternType === "weakness")
    .sort(
      (a, b) =>
        rank[b.status] - rank[a.status] ||
        b.severityScore - a.severityScore ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, limit);
}

export function topStrengths(patterns: AggregatedPattern[], limit = 3) {
  return patterns.filter((p) => p.patternType === "strength").slice(0, limit);
}

export const WEAKNESS_TAG_IDS = WEAKNESS_TAGS.map((t) => t.tag);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
