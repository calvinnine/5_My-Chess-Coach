import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games, moveAnalyses } from "@/db/schema";
import { AbortError, UciEngine } from "@/lib/engine/uci";
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
export function recoverStaleJobs(): number {
  const stale = db
    .update(games)
    .set({ analysisStatus: "pending", analysisError: null })
    .where(eq(games.analysisStatus, "running"))
    .returning({ id: games.id })
    .all();
  return stale.length;
}

export function currentSettings(): AnalysisSettings {
  const preset = getSetting(SETTING_KEYS.analysisPreset) ?? "standard";
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
export function startAnalysis(options: StartOptions = {}): JobState {
  if (jobRef.state.running) throw new Error("이미 분석이 진행 중입니다.");

  const location = locateEngine(getSetting(SETTING_KEYS.stockfishPath));
  if (!location.found || !location.path) throw new EngineMissingError();

  const targets = selectTargets(options);
  if (targets.length === 0) {
    return { ...jobRef.state, total: 0, stage: "done", finishedAt: Date.now() };
  }

  const controller = new AbortController();
  jobRef.controller = controller;
  jobRef.state = {
    ...initialState,
    running: true,
    total: targets.length,
    startedAt: Date.now(),
    engineVersion: location.version,
  };

  void runJob(
    targets.map((g) => g.id),
    location.path,
    controller.signal,
  );
  return getJobState();
}

function selectTargets(options: StartOptions) {
  if (options.gameIds?.length) {
    return db
      .select({ id: games.id })
      .from(games)
      .where(and(inArray(games.id, options.gameIds), eq(games.rules, "chess")))
      .all();
  }
  const rows = db
    .select({ id: games.id, playedAt: games.playedAt })
    .from(games)
    .where(
      options.playerId
        ? and(eq(games.analysisStatus, "pending"), eq(games.playerId, options.playerId), eq(games.rules, "chess"))
        : and(eq(games.analysisStatus, "pending"), eq(games.rules, "chess")),
    )
    .all()
    .sort((a, b) => b.playedAt - a.playedAt);
  return rows.slice(0, options.limit ?? 10);
}

async function runJob(gameIds: number[], binaryPath: string, signal: AbortSignal) {
  const settings = currentSettings();
  const threads = Number(getSetting(SETTING_KEYS.threads) ?? 2);
  const hashMb = Number(getSetting(SETTING_KEYS.hashMb) ?? 128);
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
      const game = db.select().from(games).where(eq(games.id, gameId)).get();
      if (!game) continue;

      jobRef.state.currentGameId = gameId;
      jobRef.state.currentGameLabel = `vs ${game.opponentUsername}`;
      jobRef.state.positionsDone = 0;
      jobRef.state.positionsTotal = 0;
      jobRef.state.stage = "scan";

      db.update(games)
        .set({ analysisStatus: "running", analysisError: null })
        .where(eq(games.id, gameId))
        .run();

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

        persistAnalysis(gameId, game, result);
        jobRef.state.completed++;
      } catch (err) {
        if (err instanceof AbortError || signal.aborted) {
          // Leave it pending so it can be picked up again next run.
          db.update(games)
            .set({ analysisStatus: "pending" })
            .where(eq(games.id, gameId))
            .run();
          break;
        }
        jobRef.state.failed++;
        jobRef.state.lastError = err instanceof Error ? err.message : String(err);
        db.update(games)
          .set({
            analysisStatus: "failed",
            analysisError: jobRef.state.lastError,
          })
          .where(eq(games.id, gameId))
          .run();
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

function persistAnalysis(
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
  const existingReview = db
    .select({ userThoughts: gameReviews.userThoughts, userPostmortem: gameReviews.userPostmortem })
    .from(gameReviews)
    .where(eq(gameReviews.gameId, gameId))
    .get();

  db.transaction((tx) => {
    tx.delete(moveAnalyses).where(eq(moveAnalyses.gameId, gameId)).run();
    for (const move of result.moves) {
      tx.insert(moveAnalyses)
        .values({
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
        })
        .run();
    }

    tx.insert(gameReviews)
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
      })
      .run();

    tx.update(games)
      .set({ analysisStatus: "completed", analysisVersion: version, analysisError: null })
      .where(eq(games.id, gameId))
      .run();
  });
}
