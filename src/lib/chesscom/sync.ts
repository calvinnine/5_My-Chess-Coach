import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { monthKey, selectArchiveTargets } from "./archive-window";

/** SQLite-backed ETag store so repeat syncs stay cheap and polite. */
const dbCache: ConditionalCache = {
  async get(url) {
    const [row] = await db.select().from(syncCache).where(eq(syncCache.url, url)).limit(1);
    return row ? { etag: row.etag, lastModified: row.lastModified } : undefined;
  },
  async set(url, value) {
    await db
      .insert(syncCache)
      .values({ url, etag: value.etag ?? null, lastModified: value.lastModified ?? null })
      .onConflictDoUpdate({
        target: syncCache.url,
        set: {
          etag: value.etag ?? null,
          lastModified: value.lastModified ?? null,
          fetchedAt: sql`(unixepoch())`,
        },
      });
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
    // The profile request is unconditional, so an empty body is a real fault.
    throw new ChessComError("프로필 응답이 비어 있습니다.", "invalid_response");
  }

  const [existing] = await db
    .select()
    .from(players)
    .where(eq(players.username, username))
    .limit(1);
  let playerId: number;
  if (existing) {
    playerId = existing.id;
    await db
      .update(players)
      .set({ displayName: profile.username, joinedAt: profile.joined ?? existing.joinedAt })
      .where(eq(players.id, playerId));
  } else {
    const [inserted] = await db
      .insert(players)
      .values({
        username,
        displayName: profile.username,
        joinedAt: profile.joined ?? null,
      })
      .returning({ id: players.id });
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
      const [latest] = await db
        .select()
        .from(playerRatings)
        .where(
          and(eq(playerRatings.playerId, playerId), eq(playerRatings.timeClass, timeClass)),
        )
        .orderBy(sql`recorded_at desc`)
        .limit(1);
      // Only record a new point when the rating actually moved.
      if (!latest || latest.rating !== rating) {
        await db.insert(playerRatings).values({ playerId, timeClass, rating });
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
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.username, normalized))
    .limit(1);
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

  const targets = selectArchiveTargets(archives, {
    months: options.months,
    lastSyncedMonth: player.lastSyncedMonth,
  });

  let newestSynced = player.lastSyncedMonth;

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

    /*
     * The month is stored in bulk: one dedupe query and a handful of inserts,
     * rather than two round trips per game. Building the rows is pure CPU, so
     * it all happens before anything is written.
     */
    const built = monthly.games.map((game) => buildGameRow(player.id, normalized, game));
    const candidates = built.filter(
      (b): b is Extract<BuiltGame, { row: unknown }> => b.outcome !== "invalid",
    );

    const alreadyStored = await existingUrls(candidates.map((c) => c.externalUrl));
    const seen = new Set<string>();
    const fresh = candidates.filter((c) => {
      // A response can repeat a game; the unique index would reject the batch.
      if (alreadyStored.has(c.externalUrl) || seen.has(c.externalUrl)) return false;
      seen.add(c.externalUrl);
      return true;
    });
    summary.duplicates += candidates.length - fresh.length;

    const room = options.maxNewGames
      ? Math.max(0, options.maxNewGames - summary.inserted)
      : fresh.length;
    const truncated = fresh.length > room;
    const toStore = truncated ? fresh.slice(0, room) : fresh;

    for (let i = 0; i < toStore.length; i += INSERT_CHUNK) {
      await db.insert(games).values(toStore.slice(i, i + INSERT_CHUNK).map((c) => c.row));
    }

    let insertedThisMonth = 0;
    for (const stored of toStore) {
      if (stored.outcome === "variant") summary.skippedVariants++;
      else if (stored.outcome === "no_moves") summary.abortedGames++;
      else if (stored.outcome === "practice") summary.practiceGames++;
      else {
        summary.inserted++;
        insertedThisMonth++;
        if (stored.outcome === "parse_failed") summary.parseFailures++;
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
      await client.commitCache(monthly.url, monthly.cacheHeaders);
      /*
       * Only ever forward. A backfill walks from the oldest month, and writing
       * its key here would move the marker *backwards* — every routine sync
       * afterwards would re-request every month in between.
       */
      if (!newestSynced || key > newestSynced) {
        newestSynced = key;
        await db
          .update(players)
          .set({ lastSyncedMonth: key, lastSyncedAt: Math.floor(Date.now() / 1000) })
          .where(eq(players.id, player.id));
      }
    }
  }

  await db
    .update(players)
    .set({ lastSyncedAt: Math.floor(Date.now() / 1000) })
    .where(eq(players.id, player.id));

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

/**
 * A game turned into a row, without touching the database.
 *
 * Splitting the build from the write is what lets a month be stored in a
 * couple of round trips instead of two per game. With the database in another
 * region that difference is the whole budget: a backfill of ~600 games was
 * spending minutes on latency alone and being killed by the function timeout.
 */
type BuiltGame =
  | { outcome: "invalid" }
  | {
      outcome: Exclude<StoreOutcome, "invalid" | "duplicate">;
      externalUrl: string;
      row: typeof games.$inferInsert;
    };

function buildGameRow(
  playerId: number,
  username: string,
  game: ChessComGame,
): BuiltGame {
  if (!game.pgn) return { outcome: "invalid" };

  const isWhite = game.white.username.toLowerCase() === username;
  const isBlack = game.black.username.toLowerCase() === username;
  if (!isWhite && !isBlack) return { outcome: "invalid" };

  const playerColor = isWhite ? "white" : "black";
  const side = isWhite ? game.white : game.black;
  const opponent = isWhite ? game.black : game.white;

  // URL is the dedupe key; only hash the PGN when there is no URL at all.
  const externalUrl =
    game.url ?? `pgnhash:${crypto.createHash("sha1").update(game.pgn).digest("hex")}`;

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

  const row = {
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
  } satisfies typeof games.$inferInsert;

  const outcome: StoreOutcome = !isStandard
    ? "variant"
    : !isHuman
      ? "practice"
      : noMoves
        ? "no_moves"
        : parseError
          ? "parse_failed"
          : "inserted";

  return { outcome, externalUrl, row };
}

/** How many url placeholders one dedupe query carries. */
const DEDUPE_CHUNK = 200;

/** How many rows one insert statement carries. */
const INSERT_CHUNK = 100;

/** Which of these games are already stored, asked once instead of once each. */
async function existingUrls(urls: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < urls.length; i += DEDUPE_CHUNK) {
    const rows = await db
      .select({ externalUrl: games.externalUrl })
      .from(games)
      .where(inArray(games.externalUrl, urls.slice(i, i + DEDUPE_CHUNK)));
    for (const row of rows) found.add(row.externalUrl);
  }
  return found;
}


export { openingFamily };
export { resultFor } from "./result";
