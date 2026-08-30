import { TAG_BY_ID, WEAKNESS_TAGS, STRENGTH_TAGS } from "./tags";

/** Minimum analysed games before any personal trait may be stated. */
export const MIN_SAMPLE_GAMES = 10;
export const CANDIDATE_WINDOW = 20;
export const CANDIDATE_MIN_GAMES = 3;
export const CONFIRMED_WINDOW = 30;
export const CONFIRMED_MIN_GAMES = 5;
export const CONFIRMED_MIN_OPENINGS = 2;
export const OPENING_SPECIFIC_MIN = 3;

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
  sampleSize: number;
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

    // Opening-specific problem: same family repeatedly.
    const byOpening = new Map<string, number>();
    for (const g of inConfirmed) {
      if (!g.openingFamily) continue;
      byOpening.set(g.openingFamily, (byOpening.get(g.openingFamily) ?? 0) + 1);
    }
    const openingSpecific =
      [...byOpening.entries()].find(([, count]) => count >= OPENING_SPECIFIC_MIN)?.[0] ??
      null;

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
