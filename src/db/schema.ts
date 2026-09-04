import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const players = sqliteTable(
  "players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Lower-cased handle. Used for every API path and lookup. */
    username: text("username").notNull(),
    /** Original casing as Chess.com presents it. */
    displayName: text("display_name").notNull(),
    joinedAt: integer("joined_at"),
    lastSyncedAt: integer("last_synced_at"),
    /** Last archive month fully synced, as "YYYY-MM". */
    lastSyncedMonth: text("last_synced_month"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /**
     * When this Chess.com account was proven to belong to whoever registered
     * it. Null means unproven: in a hosted deployment such a player has no
     * data of their own yet and cannot be signed in to.
     */
    verifiedAt: integer("verified_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("players_username_idx").on(t.username)],
);

/**
 * A signed-in browser.
 *
 * Only the hash of the token is stored: the raw token lives in the visitor's
 * cookie and nowhere else, so a copy of this table does not let anyone sign in
 * as someone else.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_player_idx").on(t.playerId),
  ],
);

/**
 * An outstanding "prove this account is yours" challenge.
 *
 * The visitor puts `code` somewhere in their public Chess.com profile and the
 * server reads it back through the public API. No password is ever involved —
 * this app must never ask for one.
 */
export const verificationChallenges = sqliteTable(
  "verification_challenges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Lower-cased Chess.com handle being claimed. */
    username: text("username").notNull(),
    code: text("code").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /**
     * Hash of the requester's address, used only to cap how many challenges one
     * caller may have outstanding. Hashed rather than stored raw: the address
     * is personal data and equality is all this needs.
     */
    requesterHash: text("requester_hash"),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("verification_challenges_username_idx").on(t.username),
    index("verification_challenges_requester_idx").on(t.requesterHash, t.expiresAt),
  ],
);

export const playerRatings = sqliteTable(
  "player_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    timeClass: text("time_class").notNull(), // rapid | blitz | bullet | daily
    rating: integer("rating").notNull(),
    recordedAt: integer("recorded_at").notNull().default(now),
  },
  (t) => [index("player_ratings_player_idx").on(t.playerId, t.timeClass)],
);

export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Chess.com game URL; the dedupe key. Falls back to "pgnhash:<sha1>". */
    externalUrl: text("external_url").notNull(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    playedAt: integer("played_at").notNull(),
    timeClass: text("time_class").notNull(),
    timeControl: text("time_control").notNull(),
    rules: text("rules").notNull().default("chess"),
    /**
     * human | coach | bot. Only `human` games feed coaching statistics: a
     * training game against a Chess.com coach or engine bot says nothing about
     * how the user performs against real opponents.
     */
    opponentKind: text("opponent_kind").notNull().default("human"),
    rated: integer("rated", { mode: "boolean" }).notNull().default(true),
    playerColor: text("player_color").notNull(), // white | black
    playerRating: integer("player_rating"),
    opponentUsername: text("opponent_username").notNull(),
    opponentRating: integer("opponent_rating"),
    result: text("result").notNull(), // win | loss | draw
    termination: text("termination"),
    ecoCode: text("eco_code"),
    openingName: text("opening_name"),
    pgn: text("pgn").notNull(),
    finalFen: text("final_fen"),
    chesscomAccuracy: real("chesscom_accuracy"),
    /** pending | running | completed | failed | skipped */
    analysisStatus: text("analysis_status").notNull().default("pending"),
    analysisVersion: text("analysis_version"),
    analysisError: text("analysis_error"),
    /** Set when PGN parsing failed; the raw PGN above is still preserved. */
    parseError: text("parse_error"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("games_external_url_idx").on(t.externalUrl),
    index("games_player_played_idx").on(t.playerId, t.playedAt),
    index("games_status_idx").on(t.analysisStatus),
    index("games_opponent_kind_idx").on(t.playerId, t.opponentKind),
  ],
);

export const moveAnalyses = sqliteTable(
  "move_analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ply: integer("ply").notNull(),
    moveNumber: integer("move_number").notNull(),
    color: text("color").notNull(), // white | black
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    fenBefore: text("fen_before").notNull(),
    fenAfter: text("fen_after").notNull(),
    /** Centipawns, always from the registered player's perspective. */
    evalBeforeCp: integer("eval_before_cp"),
    evalAfterCp: integer("eval_after_cp"),
    /** Mate distance from the player's perspective; negative = player gets mated. */
    mateBefore: integer("mate_before"),
    mateAfter: integer("mate_after"),
    bestMoveUci: text("best_move_uci"),
    bestMoveSan: text("best_move_san"),
    bestLine: text("best_line"),
    /** Second-best PV eval (MultiPV 2), player perspective. Used for "only move". */
    secondBestCp: integer("second_best_cp"),
    centipawnLoss: integer("centipawn_loss"),
    /** Internal grade: best | good | inaccuracy | mistake | blunder. Player moves only. */
    classification: text("classification"),
    themesJson: text("themes_json"),
    clockMs: integer("clock_ms"),
    /** opening | middlegame | endgame */
    phase: text("phase"),
    isPlayerMove: integer("is_player_move", { mode: "boolean" }).notNull(),
  },
  (t) => [
    uniqueIndex("move_analyses_game_ply_idx").on(t.gameId, t.ply),
    index("move_analyses_game_idx").on(t.gameId),
  ],
);

export const gameReviews = sqliteTable(
  "game_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turningPointsJson: text("turning_points_json"),
    strengthsJson: text("strengths_json"),
    openingSummary: text("opening_summary"),
    middlegameSummary: text("middlegame_summary"),
    endgameSummary: text("endgame_summary"),
    timeSummary: text("time_summary"),
    overallSummary: text("overall_summary"),
    checklistJson: text("checklist_json"),
    reflectionQuestion: text("reflection_question"),
    userThoughts: text("user_thoughts"),
    userPostmortem: text("user_postmortem"),
    generatedBy: text("generated_by").notNull().default("rules"), // rules | llm | user
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("game_reviews_game_idx").on(t.gameId)],
);

export const patterns = sqliteTable(
  "patterns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    patternType: text("pattern_type").notNull(), // weakness | strength
    /** Stable tag id from src/lib/coaching/tags.ts */
    tag: text("tag").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    /** Total analysed games at the time this snapshot was computed. */
    sampleSize: integer("sample_size").notNull(),
    /** Games the counts below cover — the recent window, not the whole sample. */
    windowSize: integer("window_size").notNull().default(0),
    occurrenceCount: integer("occurrence_count").notNull(),
    /** How many distinct games it showed up in. */
    gameCount: integer("game_count").notNull(),
    distinctOpenings: integer("distinct_openings").notNull().default(0),
    severityScore: real("severity_score").notNull(),
    confidenceScore: real("confidence_score").notNull(),
    /** observing | candidate | confirmed */
    status: text("status").notNull(),
    evidenceGameIdsJson: text("evidence_game_ids_json").notNull(),
    evidenceJson: text("evidence_json"),
    periodStart: integer("period_start"),
    periodEnd: integer("period_end"),
    computedAt: integer("computed_at").notNull().default(now),
  },
  (t) => [index("patterns_player_idx").on(t.playerId, t.patternType)],
);

export const trainingTasks = sqliteTable(
  "training_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    patternId: integer("pattern_id"),
    patternTag: text("pattern_tag"),
    title: text("title").notNull(),
    instruction: text("instruction").notNull(),
    targetCount: integer("target_count"),
    targetMinutes: integer("target_minutes"),
    completionCriteria: text("completion_criteria"),
    dueDate: integer("due_date"),
    status: text("status").notNull().default("open"), // open | done | dropped
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("training_tasks_player_idx").on(t.playerId, t.status)],
);

/**
 * One row per attempt at a puzzle built from the player's own mistake.
 * Kept as a log rather than a status so repeat practice stays visible.
 */
export const puzzleAttempts = sqliteTable(
  "puzzle_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** The move_analyses row the puzzle came from. */
    moveAnalysisId: integer("move_analysis_id")
      .notNull()
      .references(() => moveAnalyses.id, { onDelete: "cascade" }),
    /** Weakness tag the puzzle was practised under, when filtered. */
    tag: text("tag"),
    attemptUci: text("attempt_uci").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    attemptedAt: integer("attempted_at").notNull().default(now),
  },
  (t) => [
    index("puzzle_attempts_player_idx").on(t.playerId, t.attemptedAt),
    index("puzzle_attempts_move_idx").on(t.moveAnalysisId),
  ],
);

/**
 * The one permit to be talking to Chess.com right now.
 *
 * Chess.com asks that requests be serial. A queue inside the process cannot
 * deliver that once the app is deployed: serverless instances scale out and
 * each gets its own module state, so "global" has to mean the database.
 *
 * A single row, claimed by conditional update. The lease expires on its own so
 * an instance killed mid-sync cannot block everyone else forever.
 */
export const syncLeases = sqliteTable("sync_leases", {
  id: integer("id").primaryKey(),
  holderPlayerId: integer("holder_player_id"),
  acquiredAt: integer("acquired_at"),
  expiresAt: integer("expires_at").notNull().default(0),
});

/** ETag / Last-Modified cache for conditional Chess.com requests. */
export const syncCache = sqliteTable(
  "sync_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    url: text("url").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedAt: integer("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("sync_cache_url_idx").on(t.url)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});
