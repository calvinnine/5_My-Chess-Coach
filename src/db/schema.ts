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
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("players_username_idx").on(t.username)],
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
    /** Number of analyzed games in the observation window. */
    sampleSize: integer("sample_size").notNull(),
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
