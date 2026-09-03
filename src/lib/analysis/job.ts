import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games, moveAnalyses } from "@/db/schema";
import { UciEngine } from "@/lib/engine/uci";
import { AbortError } from "@/lib/engine/types";
import { locateEngine } from "@/lib/engine/locate";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { analysisVersion, analyzeGame, PRESETS, type AnalysisSettings } from "./analyzer";
import { buildReview } from "./review";
import type { Color } from "./eval";

export interface JobState {
  running: boolean;
  cancelRequested: boolean;
  total: number;
  completed: number;
  failed: number;
  currentGameId: number | null;
  currentGameLabel: string | null;
  positionsDone: number;
  positionsTotal: number;
  stage: "idle" | "scan" | "key-moments" | "done";
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  engineVersion: string | null;
}

const initialState: JobState = {
  running: false,
  cancelRequested: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentGameId: null,
  currentGameLabel: null,
  positionsDone: 0,
  positionsTotal: 0,
  stage: "idle",
  startedAt: null,
  finishedAt: null,
  lastError: null,
  engineVersion: null,
};

// One job at a time, surviving hot reloads in dev.
const globalForJob = globalThis as unknown as {
  __chessCoachJob?: { state: JobState; controller: AbortController | null; engine: UciEngine | null };
};

const jobRef =
  globalForJob.__chessCoachJob ??
  (globalForJob.__chessCoachJob = { state: { ...initialState }, controller: null, engine: null });

export function getJobState(): JobState {
  return { ...jobRef.state };
}

export function requestCancel() {
  if (!jobRef.state.running) return false;
  jobRef.state.cancelRequested = true;
  jobRef.controller?.abort();
  return true;
}

/**
 * A previous process died mid-analysis. Any row still marked `running` is not
 * actually running, so put it back in the queue.
 */
export async function recoverStaleJobs(): Promise<number> {
  const stale = await db
    .update(games)
    .set({ analysisStatus: "pending", analysisError: null })
    .where(eq(games.analysisStatus, "running"))
    .returning({ id: games.id });
  return stale.length;
}

export async function currentSettings(): Promise<AnalysisSettings> {
  const preset = (await getSetting(SETTING_KEYS.analysisPreset)) ?? "standard";
  return PRESETS[preset] ?? PRESETS.standard;
}

export interface StartOptions {
  gameIds?: number[];
  limit?: number;
  playerId?: number;
}

export class EngineMissingError extends Error {
  constructor() {
    super(
      "Stockfish 실행 파일을 찾지 못했습니다. `brew install stockfish`로 설치하거나 설정에서 경로를 직접 지정해 주세요.",
    );
    this.name = "EngineMissingError";
  }
}

/**
 * Starts a batch analysis in the background and returns immediately.
 * Throws only when the job cannot be started at all (engine missing, or a job
 * is already running).
 */
export async function startAnalysis(options: StartOptions = {}): Promise<JobState> {
  if (jobRef.state.running) throw new Error("이미 분석이 진행 중입니다.");
  /*
   * Claim the slot before the first `await`. While this function was
   * synchronous the guard above was atomic; now that the settings and the
   * target list are read asynchronously, two requests could both get past it
   * and start two engines writing to the same games.
   */
  jobRef.state = { ...initialState, running: true, startedAt: Date.now() };

  try {
    const location = locateEngine(await getSetting(SETTING_KEYS.stockfishPath));
    if (!location.found || !location.path) throw new EngineMissingError();

    const targets = await selectTargets(options);
    if (targets.length === 0) {
      jobRef.state = { ...initialState, total: 0, stage: "done", finishedAt: Date.now() };
      return getJobState();
    }

    const controller = new AbortController();
    jobRef.controller = controller;
    jobRef.state = {
      ...jobRef.state,
      total: targets.length,
      engineVersion: location.version,
    };

    void runJob(
      targets.map((g) => g.id),
      location.path,
      controller.signal,
    );
    return getJobState();
  } catch (err) {
    // Nothing is running, so the claim must not be left behind.
    jobRef.state = { ...initialState };
    jobRef.controller = null;
    throw err;
  }
}

async function selectTargets(options: StartOptions) {
  if (options.gameIds?.length) {
    return await db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          inArray(games.id, options.gameIds),
          eq(games.rules, "chess"),
          eq(games.opponentKind, "human"),
        ),
      );
  }
  const rows = await db
    .select({ id: games.id, playedAt: games.playedAt })
    .from(games)
    .where(
      options.playerId
        ? and(
            eq(games.analysisStatus, "pending"),
            eq(games.playerId, options.playerId),
            eq(games.rules, "chess"),
            eq(games.opponentKind, "human"),
          )
        : and(
            eq(games.analysisStatus, "pending"),
            eq(games.rules, "chess"),
            eq(games.opponentKind, "human"),
          ),
    );
  rows.sort((a, b) => b.playedAt - a.playedAt);
  return rows.slice(0, options.limit ?? 10);
}

async function runJob(gameIds: number[], binaryPath: string, signal: AbortSignal) {
  const settings = await currentSettings();
  const threads = Number((await getSetting(SETTING_KEYS.threads)) ?? 2);
  const hashMb = Number((await getSetting(SETTING_KEYS.hashMb)) ?? 128);
  const engine = new UciEngine({
    binaryPath,
    threads: Number.isFinite(threads) ? threads : 2,
    hashMb: Number.isFinite(hashMb) ? hashMb : 128,
    multiPv: settings.multiPv,
  });
  jobRef.engine = engine;

  try {
    await engine.start();
    jobRef.state.engineVersion = engine.versionName;

    for (const gameId of gameIds) {
      if (signal.aborted) break;
      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) continue;

      jobRef.state.currentGameId = gameId;
      jobRef.state.currentGameLabel = `vs ${game.opponentUsername}`;
      jobRef.state.positionsDone = 0;
      jobRef.state.positionsTotal = 0;
      jobRef.state.stage = "scan";

      await db
        .update(games)
        .set({ analysisStatus: "running", analysisError: null })
        .where(eq(games.id, gameId));

      try {
        const result = await analyzeGame(
          game.pgn,
          game.playerColor as Color,
          engine,
          settings,
          {
            signal,
            onProgress: (p) => {
              jobRef.state.positionsDone = p.done;
              jobRef.state.positionsTotal = p.total;
              jobRef.state.stage = p.stage;
            },
          },
        );

        await persistAnalysis(gameId, game, result);
        jobRef.state.completed++;
      } catch (err) {
        if (err instanceof AbortError || signal.aborted) {
          // Leave it pending so it can be picked up again next run.
          await db
            .update(games)
            .set({ analysisStatus: "pending" })
            .where(eq(games.id, gameId));
          break;
        }
        jobRef.state.failed++;
        jobRef.state.lastError = err instanceof Error ? err.message : String(err);
        await db
          .update(games)
          .set({
            analysisStatus: "failed",
            analysisError: jobRef.state.lastError,
          })
          .where(eq(games.id, gameId));
      }
    }
  } catch (err) {
    jobRef.state.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    await engine.stop();
    jobRef.engine = null;
    jobRef.controller = null;
    jobRef.state.running = false;
    jobRef.state.stage = "done";
    jobRef.state.currentGameId = null;
    jobRef.state.finishedAt = Date.now();
  }
}

async function persistAnalysis(
  gameId: number,
  game: typeof games.$inferSelect,
  result: Awaited<ReturnType<typeof analyzeGame>>,
) {
  const review = buildReview({
    moves: result.moves,
    result: game.result as "win" | "loss" | "draw",
    playerColor: game.playerColor as Color,
    openingName: game.openingName,
    termination: game.termination,
  });

  const version = analysisVersion(result.engineVersion, result.settings);
  const [existingReview] = await db
    .select({ userThoughts: gameReviews.userThoughts, userPostmortem: gameReviews.userPostmortem })
    .from(gameReviews)
    .where(eq(gameReviews.gameId, gameId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx.delete(moveAnalyses).where(eq(moveAnalyses.gameId, gameId));
    for (const move of result.moves) {
      await tx.insert(moveAnalyses).values({
        gameId,
        ply: move.ply,
        moveNumber: move.moveNumber,
        color: move.color,
        san: move.san,
        uci: move.uci,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        evalBeforeCp: move.evalBefore.cp,
        evalAfterCp: move.evalAfter.cp,
        mateBefore: move.evalBefore.mate,
        mateAfter: move.evalAfter.mate,
        bestMoveUci: move.bestMoveUci,
        bestMoveSan: move.bestMoveSan,
        bestLine: move.bestLine,
        secondBestCp: move.secondBestCp,
        centipawnLoss: move.centipawnLoss,
        classification: move.classification,
        themesJson: JSON.stringify({ themes: move.themes, strengths: move.strengths }),
        clockMs: move.clockMs,
        phase: move.phase,
        isPlayerMove: move.isPlayerMove,
      });
    }

    await tx
      .insert(gameReviews)
      .values({
        gameId,
        turningPointsJson: JSON.stringify(review.turningPoints),
        strengthsJson: JSON.stringify(review.strengths),
        openingSummary: review.openingSummary,
        middlegameSummary: review.middlegameSummary,
        endgameSummary: review.endgameSummary,
        timeSummary: review.timeSummary,
        overallSummary: review.overallSummary,
        checklistJson: JSON.stringify(review.checklist),
        reflectionQuestion: review.reflectionQuestion,
        // User-written notes survive re-analysis.
        userThoughts: existingReview?.userThoughts ?? null,
        userPostmortem: existingReview?.userPostmortem ?? null,
        generatedBy: "rules",
      })
      .onConflictDoUpdate({
        target: gameReviews.gameId,
        set: {
          turningPointsJson: JSON.stringify(review.turningPoints),
          strengthsJson: JSON.stringify(review.strengths),
          openingSummary: review.openingSummary,
          middlegameSummary: review.middlegameSummary,
          endgameSummary: review.endgameSummary,
          timeSummary: review.timeSummary,
          overallSummary: review.overallSummary,
          checklistJson: JSON.stringify(review.checklist),
          reflectionQuestion: review.reflectionQuestion,
          generatedBy: "rules",
        },
      });

    await tx
      .update(games)
      .set({ analysisStatus: "completed", analysisVersion: version, analysisError: null })
      .where(eq(games.id, gameId));
  });
}
