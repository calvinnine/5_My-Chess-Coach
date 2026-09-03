import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
  repertoireGapPattern,
  topStrengths,
  topWeaknesses,
  type AggregatedPattern,
  type PatternGameInput,
} from "./patterns";
import { buildCurriculum, type Curriculum, type PhaseAccuracy } from "./curriculum";
import {
  inferRepertoire,
  isInRepertoire,
  splitByRepertoire,
  type Repertoire,
  type RepertoireSplit,
} from "./repertoire";
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
  /** Coach and bot games, excluded from every figure above. */
  practiceGames: number;
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
  /** Per-phase accuracy for the player's own moves. */
  phaseAccuracy: Record<"opening" | "middlegame" | "endgame", PhaseAccuracy | null>;
  curriculum: Curriculum;
  repertoire: {
    white: Repertoire["white"];
    black: Repertoire["black"];
  };
  repertoireSplit: RepertoireSplit;
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
export async function buildDashboard(playerId: number): Promise<DashboardData | null> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;

  /*
   * Coaching statistics use games against real opponents only. Coach and bot
   * training games are still stored and browsable, but including them would
   * distort win rates, opening records, and every pattern threshold.
   */
  const allGames = await db
    .select()
    .from(games)
    .where(and(eq(games.playerId, playerId), eq(games.opponentKind, "human")))
    .orderBy(desc(games.playedAt));

  const [practiceRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .where(and(eq(games.playerId, playerId), ne(games.opponentKind, "human")));
  const practiceGameCount = practiceRow?.count ?? 0;

  const analyzed = allGames.filter((g) => g.analysisStatus === "completed");
  const pending = allGames.filter((g) => g.analysisStatus === "pending");

  const ratings = await db
    .select()
    .from(playerRatings)
    .where(eq(playerRatings.playerId, playerId))
    .orderBy(desc(playerRatings.recordedAt));

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
    ? await db
        .select()
        .from(moveAnalyses)
        .where(and(inArray(moveAnalyses.gameId, analyzedIds), eq(moveAnalyses.isPlayerMove, true)))
    : [];

  const losses = moves.map((m) => m.centipawnLoss ?? 0);
  const averageLossCp = losses.length
    ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length)
    : null;
  const countBy = (grade: string) => moves.filter((m) => m.classification === grade).length;
  const perGame = (n: number) =>
    analyzed.length ? Math.round((n / analyzed.length) * 100) / 100 : null;

  // Occurrences for pattern aggregation come from the stored themes.
  const reviewRows = analyzedIds.length
    ? await db.select().from(gameReviews).where(inArray(gameReviews.gameId, analyzedIds))
    : [];
  const reviewsById = new Map(reviewRows.map((r) => [r.gameId, r]));

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

  /*
   * Repertoire is inferred from every stored game, not only the analysed ones:
   * how often the player reaches an opening is a fact about their play, and it
   * does not depend on whether the engine has been through the game yet.
   */
  const repertoire = inferRepertoire(
    allGames.map((g) => ({
      openingFamily: openingFamily(g.openingName),
      playerColor: g.playerColor as "white" | "black",
    })),
  );

  const averageLossByGame = new Map<number, number | null>();
  for (const [gameId, gameMoves] of movesByGame) {
    const losses = gameMoves.map((m) => m.centipawnLoss ?? 0);
    averageLossByGame.set(
      gameId,
      losses.length ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length) : null,
    );
  }

  const repertoireSplit = splitByRepertoire(
    repertoire,
    analyzed.map((g) => ({
      openingFamily: openingFamily(g.openingName),
      playerColor: g.playerColor as "white" | "black",
      result: g.result as "win" | "loss" | "draw",
      averageLossCp: averageLossByGame.get(g.id) ?? null,
    })),
  );

  // The worst off-repertoire games make the case concrete.
  const offRepertoire = analyzed
    .filter(
      (g) =>
        isInRepertoire(repertoire, {
          openingFamily: openingFamily(g.openingName),
          playerColor: g.playerColor as "white" | "black",
        }) === false,
    )
    .sort(
      (a, b) => (averageLossByGame.get(b.id) ?? 0) - (averageLossByGame.get(a.id) ?? 0),
    );

  /*
   * Phase accuracy. Only the player's own moves count — the opponent's moves
   * are in the evaluation stream but never in the player's statistics.
   */
  const totalBlunders = moves.filter((m) => m.classification === "blunder").length;
  const phaseAccuracy = Object.fromEntries(
    (["opening", "middlegame", "endgame"] as const).map((phase) => {
      const inPhase = moves.filter((m) => m.phase === phase);
      if (inPhase.length === 0) return [phase, null];
      const blunders = inPhase.filter((m) => m.classification === "blunder").length;
      return [
        phase,
        {
          plies: inPhase.length,
          averageLossCp: Math.round(
            inPhase.reduce((sum, m) => sum + (m.centipawnLoss ?? 0), 0) / inPhase.length,
          ),
          blunders,
          mistakes: inPhase.filter((m) => m.classification === "mistake").length,
          blunderShare: totalBlunders > 0 ? blunders / totalBlunders : 0,
          blundersPerGame: analyzed.length
            ? Math.round((blunders / analyzed.length) * 100) / 100
            : 0,
        } satisfies PhaseAccuracy,
      ];
    }),
  ) as Record<"opening" | "middlegame" | "endgame", PhaseAccuracy | null>;

  const allPatterns = aggregatePatterns(patternInput);

  const repertoireGap = repertoireGapPattern(repertoireSplit, {
    sampleSize: analyzed.length,
    evidenceGameIds: offRepertoire.slice(0, 6).map((g) => g.id),
    evidence: offRepertoire.slice(0, 6).map((g) => ({
      gameId: g.id,
      ply: 1,
      moveNumber: 1,
      san: g.openingName ?? "오프닝 미상",
      detail: `${g.playerColor === "white" ? "백" : "흑"} · ${g.openingName ?? "오프닝 미상"} · 평균 손실 ${averageLossByGame.get(g.id) ?? "?"}cp`,
    })),
    periodStart: allGames.at(-1)?.playedAt ?? null,
    periodEnd: allGames[0]?.playedAt ?? null,
  });
  if (repertoireGap) allPatterns.push(repertoireGap);

  return {
    playerId,
    username: player.username,
    displayName: player.displayName,
    totalGames: allGames.length,
    practiceGames: practiceGameCount,
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
    phaseAccuracy,
    curriculum: buildCurriculum({
      analyzedGames: analyzed.length,
      patterns: allPatterns,
      phaseAccuracy,
      repertoireSplit,
    }),
    repertoire,
    repertoireSplit,
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
export async function savePatterns(playerId: number, computed: AggregatedPattern[]) {
  await db.transaction(async (tx) => {
    await tx.delete(patternsTable).where(eq(patternsTable.playerId, playerId));
    for (const p of computed) {
      await tx.insert(patternsTable).values({
          playerId,
          patternType: p.patternType,
          tag: p.tag,
          label: p.label,
          description: p.description,
          sampleSize: p.sampleSize,
          windowSize: p.windowSize,
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
      });
    }
  });
}

/** Persists this week's tasks, replacing any still-open generated ones. */
export async function saveTrainingTasks(playerId: number, drafts: TrainingTaskDraft[]) {
  const dueDate = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  await db.transaction(async (tx) => {
    await tx
      .delete(trainingTasks)
      .where(and(eq(trainingTasks.playerId, playerId), eq(trainingTasks.status, "open")));
    for (const draft of drafts) {
      await tx.insert(trainingTasks).values({
          playerId,
          patternTag: draft.patternTag,
          title: draft.title,
          instruction: draft.instruction,
          targetCount: draft.targetCount,
          targetMinutes: draft.targetMinutes,
          completionCriteria: draft.completionCriteria,
        dueDate,
        status: "open",
      });
    }
  });
  return await db.select().from(trainingTasks).where(eq(trainingTasks.playerId, playerId));
}
