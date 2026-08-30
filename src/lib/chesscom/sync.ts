import "server-only";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { games, playerRatings, players, syncCache } from "@/db/schema";
import { openingFamily, openingNameFromEcoUrl, parsePgn, PgnParseError } from "@/lib/pgn/parse";
import {
  ChessComClient,
  ChessComError,
  parseArchiveUrl,
  type ConditionalCache,
} from "./client";
import type { ChessComGame } from "./schemas";
import { resultFor, TERMINATION_LABELS } from "./result";
import { classifyOpponent } from "./opponent";

const DEFAULT_FIRST_RUN_MONTHS = 3;

/** SQLite-backed ETag store so repeat syncs stay cheap and polite. */
const dbCache: ConditionalCache = {
  get(url) {
    const row = db.select().from(syncCache).where(eq(syncCache.url, url)).get();
    return row ? { etag: row.etag, lastModified: row.lastModified } : undefined;
  },
  set(url, value) {
    db.insert(syncCache)
      .values({ url, etag: value.etag ?? null, lastModified: value.lastModified ?? null })
      .onConflictDoUpdate({
        target: syncCache.url,
        set: {
          etag: value.etag ?? null,
          lastModified: value.lastModified ?? null,
          fetchedAt: sql`(unixepoch())`,
        },
      })
      .run();
  },
};

export interface RegisterResult {
  playerId: number;
  username: string;
  displayName: string;
  ratings: Array<{ timeClass: string; rating: number }>;
}

export async function registerPlayer(rawUsername: string): Promise<RegisterResult> {
  const username = rawUsername.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,25}$/.test(username)) {
    throw new ChessComError(
      "사용자명 형식이 올바르지 않습니다. 3~25자의 영문·숫자·_·- 만 사용할 수 있습니다.",
      "not_found",
    );
  }

  const client = new ChessComClient({ cache: dbCache });
  let profile;
  try {
    const res = await client.getProfile(username);
    profile = res.data;
  } catch (err) {
    if (err instanceof ChessComError && err.kind === "not_found") {
      throw new ChessComError(
        `Chess.com에 '${rawUsername}' 사용자가 없습니다. 철자를 확인해 주세요.`,
        "not_found",
        404,
      );
    }
    throw err;
  }
  if (!profile) {
    // 304 on a profile we have never stored should not happen, but be safe.
    throw new ChessComError("프로필 응답이 비어 있습니다.", "invalid_response");
  }

  const existing = db.select().from(players).where(eq(players.username, username)).get();
  let playerId: number;
  if (existing) {
    playerId = existing.id;
    db.update(players)
      .set({ displayName: profile.username, joinedAt: profile.joined ?? existing.joinedAt })
      .where(eq(players.id, playerId))
      .run();
  } else {
    const inserted = db
      .insert(players)
      .values({
        username,
        displayName: profile.username,
        joinedAt: profile.joined ?? null,
      })
      .returning({ id: players.id })
      .get();
    playerId = inserted.id;
  }

  const ratings: Array<{ timeClass: string; rating: number }> = [];
  try {
    const stats = (await client.getStats(username)).data;
    const buckets: Array<[string, number | undefined]> = [
      ["rapid", stats?.chess_rapid?.last?.rating],
      ["blitz", stats?.chess_blitz?.last?.rating],
      ["bullet", stats?.chess_bullet?.last?.rating],
      ["daily", stats?.chess_daily?.last?.rating],
    ];
    for (const [timeClass, rating] of buckets) {
      if (typeof rating !== "number") continue;
      ratings.push({ timeClass, rating });
      const latest = db
        .select()
        .from(playerRatings)
        .where(
          and(eq(playerRatings.playerId, playerId), eq(playerRatings.timeClass, timeClass)),
        )
        .orderBy(sql`recorded_at desc`)
        .limit(1)
        .get();
      // Only record a new point when the rating actually moved.
      if (!latest || latest.rating !== rating) {
        db.insert(playerRatings).values({ playerId, timeClass, rating }).run();
      }
    }
  } catch {
    // Stats are nice to have; a failure here must not block registration.
  }

  return { playerId, username, displayName: profile.username, ratings };
}

export interface SyncOptions {
  /** How many months back to pull on a first sync. */
  months?: number;
  /** Stop after this many newly inserted games (0 = no cap). */
  maxNewGames?: number;
  signal?: AbortSignal;
  onProgress?: (p: { month: string; inserted: number; scanned: number }) => void;
}

export interface SyncSummary {
  playerId: number;
  username: string;
  monthsChecked: string[];
  monthsSkipped: string[];
  inserted: number;
  duplicates: number;
  skippedVariants: number;
  abortedGames: number;
  practiceGames: number;
  parseFailures: number;
  rejectedBySchema: number;
  errors: string[];
}

/**
 * Pulls monthly archives into the local database.
 *
 * Requests run one month at a time. Every game is keyed by its Chess.com URL,
 * so running this twice never duplicates a game. Raw PGN is always stored, even
 * when parsing fails — the failure is recorded on the row instead.
 */
export async function syncPlayerGames(
  username: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const normalized = username.trim().toLowerCase();
  const player = db.select().from(players).where(eq(players.username, normalized)).get();
  if (!player) {
    throw new ChessComError("먼저 선수를 등록해 주세요.", "not_found");
  }

  const client = new ChessComClient({ cache: dbCache });
  const summary: SyncSummary = {
    playerId: player.id,
    username: normalized,
    monthsChecked: [],
    monthsSkipped: [],
    inserted: 0,
    duplicates: 0,
    skippedVariants: 0,
    abortedGames: 0,
    practiceGames: 0,
    parseFailures: 0,
    rejectedBySchema: 0,
    errors: [],
  };

  let archives: string[];
  try {
    archives = await client.getArchives(normalized);
  } catch (err) {
    summary.errors.push(
      err instanceof Error ? err.message : "아카이브 목록을 가져오지 못했습니다.",
    );
    return summary;
  }

  const monthsBack = options.months ?? DEFAULT_FIRST_RUN_MONTHS;
  let targets = archives.slice(-monthsBack);
  if (player.lastSyncedMonth) {
    // Incremental: only re-request the last synced month and everything after.
    const fromIndex = archives.findIndex((url) => {
      const parsed = parseArchiveUrl(url);
      return parsed && monthKey(parsed.year, parsed.month) >= player.lastSyncedMonth!;
    });
    if (fromIndex >= 0) targets = archives.slice(fromIndex);
  }

  for (const archiveUrl of targets) {
    if (options.signal?.aborted) break;
    if (options.maxNewGames && summary.inserted >= options.maxNewGames) break;

    const parsed = parseArchiveUrl(archiveUrl);
    if (!parsed) continue;
    const key = monthKey(parsed.year, parsed.month);

    let monthly;
    try {
      monthly = await client.getMonthlyGames(normalized, parsed.year, parsed.month);
    } catch (err) {
      // One bad month must not abort the rest, and must not touch the DB.
      summary.errors.push(
        `${key}: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
      );
      continue;
    }

    if (monthly.notModified) {
      summary.monthsSkipped.push(key);
      continue;
    }

    summary.monthsChecked.push(key);
    summary.rejectedBySchema += monthly.rejected;

    let insertedThisMonth = 0;
    let truncated = false;
    for (const game of monthly.games) {
      if (options.maxNewGames && summary.inserted >= options.maxNewGames) {
        truncated = true;
        break;
      }
      const outcome = storeGame(player.id, normalized, game);
      if (outcome === "inserted") {
        summary.inserted++;
        insertedThisMonth++;
      } else if (outcome === "duplicate") summary.duplicates++;
      else if (outcome === "variant") summary.skippedVariants++;
      else if (outcome === "no_moves") summary.abortedGames++;
      else if (outcome === "practice") summary.practiceGames++;
      else if (outcome === "parse_failed") {
        summary.inserted++;
        summary.parseFailures++;
        insertedThisMonth++;
      }
    }

    options.onProgress?.({
      month: key,
      inserted: insertedThisMonth,
      scanned: monthly.games.length,
    });

    /*
     * Only remember this month's validators once every game in the response is
     * in the database. If the run stopped early on `maxNewGames`, caching now
     * would make the next request a 304 and the unread games would never come.
     */
    if (!truncated) {
      client.commitCache(monthly.url, monthly.cacheHeaders);
      db.update(players)
        .set({ lastSyncedMonth: key, lastSyncedAt: Math.floor(Date.now() / 1000) })
        .where(eq(players.id, player.id))
        .run();
    }
  }

  db.update(players)
    .set({ lastSyncedAt: Math.floor(Date.now() / 1000) })
    .where(eq(players.id, player.id))
    .run();

  return summary;
}

type StoreOutcome =
  | "inserted"
  | "duplicate"
  | "variant"
  | "parse_failed"
  | "no_moves"
  | "practice"
  | "invalid";

function storeGame(
  playerId: number,
  username: string,
  game: ChessComGame,
): StoreOutcome {
  if (!game.pgn) return "invalid";

  const isWhite = game.white.username.toLowerCase() === username;
  const isBlack = game.black.username.toLowerCase() === username;
  if (!isWhite && !isBlack) return "invalid";

  const playerColor = isWhite ? "white" : "black";
  const side = isWhite ? game.white : game.black;
  const opponent = isWhite ? game.black : game.white;

  // URL is the dedupe key; only hash the PGN when there is no URL at all.
  const externalUrl =
    game.url ?? `pgnhash:${crypto.createHash("sha1").update(game.pgn).digest("hex")}`;

  const existing = db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.externalUrl, externalUrl))
    .get();
  if (existing) return "duplicate";

  const rules = game.rules ?? "chess";
  const isStandard = rules === "chess";
  // Coach and bot training games say nothing about play against real opponents.
  const opponentKind = classifyOpponent(game.pgn);
  const isHuman = opponentKind === "human";

  let parseError: string | null = null;
  let noMoves = false;
  let finalFen: string | null = game.fen ?? null;
  let ecoCode: string | null = game.eco ?? null;
  let openingName: string | null = null;
  try {
    const parsed = parsePgn(game.pgn);
    finalFen = parsed.finalFen;
    ecoCode = parsed.ecoCode ?? ecoCode;
    openingName = parsed.openingName;
  } catch (err) {
    // Keep the raw PGN and record why it could not be read.
    parseError = err instanceof Error ? err.message : "PGN 파싱 실패";
    noMoves = err instanceof PgnParseError && err.kind === "empty";
    openingName = openingNameFromEcoUrl(undefined);
  }

  const accuracy = isWhite ? game.accuracies?.white : game.accuracies?.black;

  db.insert(games)
    .values({
      externalUrl,
      playerId,
      playedAt: game.end_time ?? Math.floor(Date.now() / 1000),
      timeClass: game.time_class ?? "unknown",
      timeControl: game.time_control ?? "unknown",
      rules,
      opponentKind,
      rated: game.rated ?? false,
      playerColor,
      playerRating: side.rating ?? null,
      opponentUsername: opponent.username,
      opponentRating: opponent.rating ?? null,
      result: resultFor(side.result),
      termination: TERMINATION_LABELS[side.result ?? ""] ?? side.result ?? null,
      ecoCode,
      openingName,
      pgn: game.pgn,
      finalFen,
      chesscomAccuracy: typeof accuracy === "number" ? accuracy : null,
      // An aborted game has nothing to analyse; that is "skipped", not "failed".
      analysisStatus:
        !isStandard || noMoves || !isHuman
          ? "skipped"
          : parseError
            ? "failed"
            : "pending",
      analysisError: isHuman
        ? parseError
        : "코치·봇 연습 게임은 분석 대상에서 제외합니다.",
      parseError,
    })
    .run();

  if (!isStandard) return "variant";
  if (!isHuman) return "practice";
  if (noMoves) return "no_moves";
  return parseError ? "parse_failed" : "inserted";
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export { openingFamily };
export { resultFor } from "./result";
