import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  gameReviews,
  games,
  moveAnalyses,
  patterns as patternsTable,
  playerRatings,
  players,
  trainingTasks,
} from "@/db/schema";
import { openingFamily } from "@/lib/pgn/parse";
import {
  aggregatePatterns,
  MIN_SAMPLE_GAMES,
  topStrengths,
  topWeaknesses,
  type AggregatedPattern,
  type PatternGameInput,
} from "./patterns";
import { buildTrainingTasks, type TrainingTaskDraft } from "./training";

export interface RecordSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  score: number;
}

export interface DashboardData {
  playerId: number;
  username: string;
  displayName: string;
  totalGames: number;
  analyzedGames: number;
  pendingGames: number;
  hasEnoughSample: boolean;
  minSample: number;
  ratings: Array<{ timeClass: string; rating: number; recordedAt: number }>;
  ratingHistory: Array<{ timeClass: string; points: Array<{ at: number; rating: number }> }>;
  records: { last10: RecordSummary; last30: RecordSummary; last90: RecordSummary };
  byColor: { white: RecordSummary; black: RecordSummary };
  byTimeClass: Array<{ timeClass: string } & RecordSummary>;
  byOpening: Array<{ opening: string; asColor: string } & RecordSummary>;
  accuracy: {
    averageLossCp: number | null;
    blundersPerGame: number | null;
    mistakesPerGame: number | null;
    inaccuraciesPerGame: number | null;
  };
  weaknesses: AggregatedPattern[];
  strengths: AggregatedPattern[];
  allPatterns: AggregatedPattern[];
  trainingTasks: TrainingTaskDraft[];
  recentGames: Array<{
    id: number;
    playedAt: number;
    opponentUsername: string;
    result: string;
    playerColor: string;
    timeClass: string;
    openingName: string | null;
    analysisStatus: string;
  }>;
}

function emptyRecord(): RecordSummary {
  return { games: 0, wins: 0, losses: 0, draws: 0, score: 0 };
}

function tally(rows: Array<{ result: string }>): RecordSummary {
  const record = emptyRecord();
  for (const row of rows) {
    record.games++;
    if (row.result === "win") record.wins++;
    else if (row.result === "loss") record.losses++;
    else record.draws++;
  }
  record.score = record.games ? (record.wins + record.draws * 0.5) / record.games : 0;
  return record;
}

/**
 * Builds everything the dashboard shows.
 *
 * Nothing here invents a claim: pattern status is decided by
 * `aggregatePatterns`, and below MIN_SAMPLE_GAMES analysed games the UI is told
 * to render "관찰 중" instead of a diagnosis.
 */
export function buildDashboard(playerId: number): DashboardData | null {
  const player = db.select().from(players).where(eq(players.id, playerId)).get();
  if (!player) return null;

  const allGames = db
    .select()
    .from(games)
    .where(eq(games.playerId, playerId))
    .orderBy(desc(games.playedAt))
    .all();

  const analyzed = allGames.filter((g) => g.analysisStatus === "completed");
  const pending = allGames.filter((g) => g.analysisStatus === "pending");

  const ratings = db
    .select()
    .from(playerRatings)
    .where(eq(playerRatings.playerId, playerId))
    .orderBy(desc(playerRatings.recordedAt))
    .all();

  const latestByClass = new Map<string, (typeof ratings)[number]>();
  for (const r of ratings) if (!latestByClass.has(r.timeClass)) latestByClass.set(r.timeClass, r);

  const historyByClass = new Map<string, Array<{ at: number; rating: number }>>();
  for (const r of [...ratings].reverse()) {
    const list = historyByClass.get(r.timeClass) ?? [];
    list.push({ at: r.recordedAt, rating: r.rating });
    historyByClass.set(r.timeClass, list);
  }

  const byOpeningMap = new Map<string, { rows: typeof allGames; asColor: string }>();
  for (const g of allGames) {
    const family = openingFamily(g.openingName) ?? "기타";
    const key = `${family}|${g.playerColor}`;
    const bucket = byOpeningMap.get(key) ?? { rows: [], asColor: g.playerColor };
    bucket.rows.push(g);
    byOpeningMap.set(key, bucket);
  }

  const analyzedIds = analyzed.map((g) => g.id);
  const moves = analyzedIds.length
    ? db
        .select()
        .from(moveAnalyses)
        .where(and(inArray(moveAnalyses.gameId, analyzedIds), eq(moveAnalyses.isPlayerMove, true)))
        .all()
    : [];

  const losses = moves.map((m) => m.centipawnLoss ?? 0);
  const averageLossCp = losses.length
    ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length)
    : null;
  const countBy = (grade: string) => moves.filter((m) => m.classification === grade).length;
  const perGame = (n: number) =>
    analyzed.length ? Math.round((n / analyzed.length) * 100) / 100 : null;

  // Occurrences for pattern aggregation come from the stored themes.
  const reviewsById = new Map(
    analyzedIds.length
      ? db
          .select()
          .from(gameReviews)
          .where(inArray(gameReviews.gameId, analyzedIds))
          .all()
          .map((r) => [r.gameId, r])
      : [],
  );

  const movesByGame = new Map<number, typeof moves>();
  for (const m of moves) {
    const list = movesByGame.get(m.gameId) ?? [];
    list.push(m);
    movesByGame.set(m.gameId, list);
  }

  const patternInput: PatternGameInput[] = analyzed.map((g) => {
    const gameMoves = movesByGame.get(g.id) ?? [];
    const review = reviewsById.get(g.id);
    const turningPlies = new Set<number>(
      review?.turningPointsJson
        ? (JSON.parse(review.turningPointsJson) as Array<{ ply: number }>).map((t) => t.ply)
        : [],
    );

    const occurrences: PatternGameInput["occurrences"] = [];
    for (const m of gameMoves) {
      if (!m.themesJson) continue;
      let parsed: { themes?: Array<{ tag: string; detail: string }>; strengths?: Array<{ tag: string; detail: string }> };
      try {
        parsed = JSON.parse(m.themesJson);
      } catch {
        continue;
      }
      // Weakness themes only count when the move actually mattered.
      const countsAsWeakness =
        turningPlies.has(m.ply) ||
        m.classification === "blunder" ||
        m.classification === "mistake";
      if (countsAsWeakness) {
        for (const t of parsed.themes ?? []) {
          occurrences.push({
            tag: t.tag,
            ply: m.ply,
            moveNumber: m.moveNumber,
            san: m.san,
            detail: t.detail,
          });
        }
      }
      for (const s of parsed.strengths ?? []) {
        occurrences.push({
          tag: s.tag,
          ply: m.ply,
          moveNumber: m.moveNumber,
          san: m.san,
          detail: s.detail,
        });
      }
    }

    return {
      gameId: g.id,
      playedAt: g.playedAt,
      openingFamily: openingFamily(g.openingName),
      opponentUsername: g.opponentUsername,
      result: g.result as "win" | "loss" | "draw",
      occurrences,
    };
  });

  const allPatterns = aggregatePatterns(patternInput);

  return {
    playerId,
    username: player.username,
    displayName: player.displayName,
    totalGames: allGames.length,
    analyzedGames: analyzed.length,
    pendingGames: pending.length,
    hasEnoughSample: analyzed.length >= MIN_SAMPLE_GAMES,
    minSample: MIN_SAMPLE_GAMES,
    ratings: [...latestByClass.values()].map((r) => ({
      timeClass: r.timeClass,
      rating: r.rating,
      recordedAt: r.recordedAt,
    })),
    ratingHistory: [...historyByClass.entries()].map(([timeClass, points]) => ({
      timeClass,
      points,
    })),
    records: {
      last10: tally(allGames.slice(0, 10)),
      last30: tally(allGames.slice(0, 30)),
      last90: tally(allGames.slice(0, 90)),
    },
    byColor: {
      white: tally(allGames.filter((g) => g.playerColor === "white")),
      black: tally(allGames.filter((g) => g.playerColor === "black")),
    },
    byTimeClass: [...new Set(allGames.map((g) => g.timeClass))].map((timeClass) => ({
      timeClass,
      ...tally(allGames.filter((g) => g.timeClass === timeClass)),
    })),
    byOpening: [...byOpeningMap.entries()]
      .map(([key, bucket]) => ({
        opening: key.split("|")[0],
        asColor: bucket.asColor,
        ...tally(bucket.rows),
      }))
      .filter((o) => o.games >= 2)
      .sort((a, b) => b.games - a.games)
      .slice(0, 8),
    accuracy: {
      averageLossCp,
      blundersPerGame: perGame(countBy("blunder")),
      mistakesPerGame: perGame(countBy("mistake")),
      inaccuraciesPerGame: perGame(countBy("inaccuracy")),
    },
    weaknesses: topWeaknesses(allPatterns),
    strengths: topStrengths(allPatterns),
    allPatterns,
    trainingTasks: buildTrainingTasks(allPatterns, analyzed.length),
    recentGames: allGames.slice(0, 8).map((g) => ({
      id: g.id,
      playedAt: g.playedAt,
      opponentUsername: g.opponentUsername,
      result: g.result,
      playerColor: g.playerColor,
      timeClass: g.timeClass,
      openingName: g.openingName,
      analysisStatus: g.analysisStatus,
    })),
  };
}

/**
 * Writes the freshly computed patterns to the database, replacing the previous
 * snapshot. The dashboard itself renders from the in-memory result; this keeps
 * the stored copy in step so exports and later queries see the same picture.
 */
export function savePatterns(playerId: number, computed: AggregatedPattern[]) {
  db.transaction((tx) => {
    tx.delete(patternsTable).where(eq(patternsTable.playerId, playerId)).run();
    for (const p of computed) {
      tx.insert(patternsTable)
        .values({
          playerId,
          patternType: p.patternType,
          tag: p.tag,
          label: p.label,
          description: p.description,
          sampleSize: p.sampleSize,
          occurrenceCount: p.occurrenceCount,
          gameCount: p.gameCount,
          distinctOpenings: p.distinctOpenings,
          severityScore: p.severityScore,
          confidenceScore: p.confidenceScore,
          status: p.status,
          evidenceGameIdsJson: JSON.stringify(p.evidenceGameIds),
          evidenceJson: JSON.stringify(p.evidence),
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        })
        .run();
    }
  });
}

/** Persists this week's tasks, replacing any still-open generated ones. */
export function saveTrainingTasks(playerId: number, drafts: TrainingTaskDraft[]) {
  const dueDate = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  db.transaction((tx) => {
    tx.delete(trainingTasks)
      .where(and(eq(trainingTasks.playerId, playerId), eq(trainingTasks.status, "open")))
      .run();
    for (const draft of drafts) {
      tx.insert(trainingTasks)
        .values({
          playerId,
          patternTag: draft.patternTag,
          title: draft.title,
          instruction: draft.instruction,
          targetCount: draft.targetCount,
          targetMinutes: draft.targetMinutes,
          completionCriteria: draft.completionCriteria,
          dueDate,
          status: "open",
        })
        .run();
    }
  });
  return db.select().from(trainingTasks).where(eq(trainingTasks.playerId, playerId)).all();
}
