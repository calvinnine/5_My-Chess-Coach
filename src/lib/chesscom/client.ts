import { z } from "zod";
import {
  archivesSchema,
  monthlyGameSchema,
  monthlyGamesSchema,
  profileSchema,
  statsSchema,
  type ChessComGame,
} from "./schemas";

export const CHESSCOM_BASE = "https://api.chess.com/pub";
const APP_VERSION = "0.1.0";

export class ChessComError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "not_found"
      | "rate_limited"
      | "network"
      | "invalid_response"
      | "server",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChessComError";
  }
}

/** The store may be in memory or in the database, so either shape is accepted. */
type Awaitable<T> = T | Promise<T>;

export interface ConditionalCache {
  get(url: string): Awaitable<{ etag?: string | null; lastModified?: string | null } | undefined>;
  set(url: string, value: { etag?: string | null; lastModified?: string | null }): Awaitable<void>;
}

export interface ChessComClientOptions {
  contact?: string;
  cache?: ConditionalCache;
  fetchImpl?: typeof fetch;
  /** Overridable so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CacheHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchResult<T> {
  status: number;
  /** true when the server answered 304 and the caller should keep local data. */
  notModified: boolean;
  data: T | null;
  /** The URL that was requested, so callers can commit its cache entry later. */
  url: string;
  /** Validators from the response; null on 304 or when the server sent none. */
  cacheHeaders: CacheHeaders | null;
}

interface RequestOptions {
  /** Send If-None-Match / If-Modified-Since from the stored entry. */
  useCache?: boolean;
  /**
   * Write the response's validators straight into the cache. Off for responses
   * the caller might not fully consume — storing an ETag for data we did not
   * persist would make the next request a 304 and lose those records forever.
   */
  storeCache?: boolean;
}

/**
 * Thin wrapper over the Chess.com Published-Data API.
 *
 * Requests are issued strictly one at a time (see `syncPlayer`), carry an
 * identifying User-Agent, honour ETag/Last-Modified, and back off on 429.
 * No credentials are involved: every endpoint here is public.
 */
export class ChessComClient {
  private readonly userAgent: string;
  private readonly cache?: ConditionalCache;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  /** Serialises every request made through this client. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: ChessComClientOptions = {}) {
    const contact = opts.contact ?? process.env.CHESS_COACH_CONTACT ?? "local-user";
    this.userAgent = `ChessCoach/${APP_VERSION} (local single-user app; contact: ${contact})`;
    this.cache = opts.cache;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    // Keep the chain alive even when a request rejects.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async request(
    url: string,
    options: RequestOptions = {},
  ): Promise<FetchResult<unknown>> {
    const { useCache = true, storeCache = true } = options;
    const cached = useCache ? await this.cache?.get(url) : undefined;
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    let lastError: ChessComError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers, cache: "no-store" });
      } catch (err) {
        lastError = new ChessComError(
          `네트워크 오류: ${(err as Error).message}`,
          "network",
        );
        if (attempt === this.maxRetries) break;
        await this.sleep(backoffMs(attempt));
        continue;
      }

      if (res.status === 304)
        return { status: 304, notModified: true, data: null, url, cacheHeaders: null };

      if (res.status === 429) {
        lastError = new ChessComError(
          "Chess.com API 요청이 제한되었습니다 (429).",
          "rate_limited",
          429,
        );
        if (attempt === this.maxRetries) break;
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt),
        );
        continue;
      }

      if (res.status === 404) {
        throw new ChessComError("요청한 리소스를 찾을 수 없습니다.", "not_found", 404);
      }

      if (res.status >= 500) {
        lastError = new ChessComError(
          `Chess.com 서버 오류 (${res.status}).`,
          "server",
          res.status,
        );
        if (attempt === this.maxRetries) break;
        await this.sleep(backoffMs(attempt));
        continue;
      }

      if (!res.ok) {
        throw new ChessComError(
          `예상하지 못한 응답 (${res.status}).`,
          "server",
          res.status,
        );
      }

      const cacheHeaders: CacheHeaders = {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
      if (storeCache) await this.cache?.set(url, cacheHeaders);

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ChessComError("JSON 응답을 해석하지 못했습니다.", "invalid_response");
      }
      return { status: res.status, notModified: false, data: json, url, cacheHeaders };
    }

    throw lastError ?? new ChessComError("요청에 실패했습니다.", "network");
  }

  private async fetchParsed<T>(
    url: string,
    schema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<FetchResult<T>> {
    const result = await this.enqueue(() => this.request(url, options));
    if (result.notModified) return { ...result, data: null };
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) {
      throw new ChessComError(
        `응답 형식이 예상과 다릅니다: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        "invalid_response",
        result.status,
      );
    }
    return { ...result, data: parsed.data };
  }

  /*
   * Neither of these uses the conditional cache, for the same reason
   * `getArchives` does not: every caller needs the body, and a 304 carries
   * none. Both responses are small, so caching them saves nothing worth the
   * failure it causes.
   *
   * Concretely, with caching on: ownership verification would read the profile
   * as it stood before the visitor added their code and could never pass, and
   * re-registering a known player would throw on an empty profile or silently
   * record no ratings.
   */
  getProfile(username: string) {
    return this.fetchParsed(
      `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}`,
      profileSchema,
      { useCache: false, storeCache: false },
    );
  }

  getStats(username: string) {
    return this.fetchParsed(
      `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}/stats`,
      statsSchema,
      { useCache: false, storeCache: false },
    );
  }

  /**
   * The month list is small and must always be current: a 304 here is
   * indistinguishable from "no archives", which would silently stop every
   * subsequent sync. So this one request skips the conditional cache entirely.
   */
  async getArchives(username: string): Promise<string[]> {
    const res = await this.fetchParsed(
      `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}/games/archives`,
      archivesSchema,
      { useCache: false, storeCache: false },
    );
    return res.data?.archives ?? [];
  }

  /**
   * Returns the games of one month. `notModified` means the caller already has
   * everything for that month and should not touch the database.
   * Individual games that fail validation are dropped, not fatal.
   */
  async getMonthlyGames(
    username: string,
    year: number,
    month: number,
  ): Promise<{
    notModified: boolean;
    games: ChessComGame[];
    rejected: number;
    url: string;
    cacheHeaders: CacheHeaders | null;
  }> {
    const mm = String(month).padStart(2, "0");
    const url = `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}/games/${year}/${mm}`;
    let res: FetchResult<{ games: unknown[] }>;
    try {
      // Committed by the caller only once every game in the month is stored.
      res = await this.fetchParsed(url, monthlyGamesSchema, { storeCache: false });
    } catch (err) {
      // A month with no games can answer 404; that is not a bad username.
      if (err instanceof ChessComError && err.kind === "not_found") {
        return { notModified: false, games: [], rejected: 0, url, cacheHeaders: null };
      }
      throw err;
    }
    if (res.notModified)
      return { notModified: true, games: [], rejected: 0, url, cacheHeaders: null };

    const games: ChessComGame[] = [];
    let rejected = 0;
    for (const raw of res.data?.games ?? []) {
      const parsed = monthlyGameSchema.safeParse(raw);
      if (parsed.success) games.push(parsed.data);
      else rejected++;
    }
    return { notModified: false, games, rejected, url, cacheHeaders: res.cacheHeaders };
  }

  /**
   * Records a month's validators once the caller has durably stored every game
   * from that response. Skipping this simply means the month is re-fetched.
   */
  async commitCache(url: string, headers: CacheHeaders | null) {
    if (!headers) return;
    await this.cache?.set(url, headers);
  }
}

export function backoffMs(attempt: number) {
  // 1s, 2s, 4s with a little jitter so retries do not line up.
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 250);
}

/** "https://api.chess.com/pub/player/x/games/2026/08" -> { year, month } */
export function parseArchiveUrl(url: string): { year: number; month: number } | null {
  const m = /\/games\/(\d{4})\/(\d{2})$/.exec(url);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}
