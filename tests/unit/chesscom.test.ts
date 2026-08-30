import { describe, expect, it, vi } from "vitest";
import { ChessComClient, ChessComError, parseArchiveUrl } from "@/lib/chesscom/client";
import { resultFor } from "@/lib/chesscom/result";
import {
  ARCHIVES_RESPONSE,
  PROFILE_RESPONSE,
  STATS_RESPONSE,
  monthlyGames,
} from "../fixtures/chesscom";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

/** 304 carries no body, which the Response constructor refuses to build. */
function notModifiedResponse() {
  return {
    status: 304,
    ok: false,
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Response;
}

function headersOfCall(mock: { mock: { calls: unknown[][] } }, index: number) {
  const init = mock.mock.calls[index]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

const noSleep = () => Promise.resolve();

describe("request behaviour", () => {
  it("sends an identifying User-Agent and never a credential header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PROFILE_RESPONSE));
    const client = new ChessComClient({
      contact: "me@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    await client.getProfile("testuser");

    const headers = headersOfCall(fetchImpl, 0);
    expect(headers["User-Agent"]).toContain("ChessCoach/");
    expect(headers["User-Agent"]).toContain("me@example.com");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("cookie");
  });

  it("issues requests one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return jsonResponse(PROFILE_RESPONSE);
    });
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    await Promise.all([
      client.getProfile("a"),
      client.getProfile("b"),
      client.getProfile("c"),
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("retries 429 with backoff and eventually succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls < 3) return new Response("", { status: 429 });
      return jsonResponse(PROFILE_RESPONSE);
    });
    const sleep = vi.fn(noSleep);
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const res = await client.getProfile("testuser");
    expect(res.data?.username).toBe("TestUser");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and reports rate limiting", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      maxRetries: 2,
    });
    await expect(client.getProfile("testuser")).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a 404 profile as an unknown username", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    await expect(client.getProfile("nope")).rejects.toBeInstanceOf(ChessComError);
  });

  it("treats a 404 month as simply having no games", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    await expect(client.getMonthlyGames("testuser", 2026, 1)).resolves.toMatchObject({
      notModified: false,
      games: [],
      rejected: 0,
    });
  });
});

describe("conditional requests", () => {
  function makeCache() {
    const store = new Map<string, { etag?: string | null; lastModified?: string | null }>();
    return {
      store,
      cache: {
        get: (url: string) => store.get(url),
        set: (url: string, v: { etag?: string | null; lastModified?: string | null }) =>
          void store.set(url, v),
      },
    };
  }

  it("sends the stored ETag and honours a 304 once the month is committed", async () => {
    const { cache } = makeCache();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse(monthlyGames(), { headers: { ETag: 'W/"abc"' } });
      return notModifiedResponse();
    });

    const client = new ChessComClient({
      cache,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    const first = await client.getMonthlyGames("testuser", 2026, 8);
    expect(first.notModified).toBe(false);
    // The caller commits only after storing every game from the response.
    client.commitCache(first.url, first.cacheHeaders);

    const second = await client.getMonthlyGames("testuser", 2026, 8);
    expect(second.notModified).toBe(true);
    expect(headersOfCall(fetchImpl, 1)["If-None-Match"]).toBe('W/"abc"');
  });

  it("does not cache a month the caller never committed", async () => {
    /*
     * Regression: the month's ETag used to be stored on fetch. A sync capped by
     * maxNewGames would store it without reading every game, and the next
     * request came back 304 — permanently losing the games it had skipped.
     */
    const { cache, store } = makeCache();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(monthlyGames(), { headers: { ETag: 'W/"abc"' } }),
    );
    const client = new ChessComClient({
      cache,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    await client.getMonthlyGames("testuser", 2026, 8);
    expect(store.size).toBe(0);

    // Re-requesting must not send a validator, so the full month arrives again.
    const second = await client.getMonthlyGames("testuser", 2026, 8);
    expect(second.notModified).toBe(false);
    expect(second.games).toHaveLength(3);
    expect(headersOfCall(fetchImpl, 1)["If-None-Match"]).toBeUndefined();
  });

  it("never makes the archive list conditional", async () => {
    /*
     * Regression: a 304 on /games/archives is indistinguishable from an empty
     * archive list, which silently turned every sync after the first into a
     * no-op. This request must always be unconditional.
     */
    const { cache, store } = makeCache();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(ARCHIVES_RESPONSE, { headers: { ETag: 'W/"arch"' } }),
    );
    const client = new ChessComClient({
      cache,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(await client.getArchives("testuser")).toHaveLength(3);
    expect(store.size).toBe(0);

    // Second call still returns the full list, and sends no validator.
    expect(await client.getArchives("testuser")).toHaveLength(3);
    expect(headersOfCall(fetchImpl, 1)["If-None-Match"]).toBeUndefined();
  });
});

describe("response validation", () => {
  it("keeps valid games and drops only the malformed one", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(monthlyGames()));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    const res = await client.getMonthlyGames("testuser", 2026, 8);
    expect(res.games).toHaveLength(3);
    expect(res.rejected).toBe(1);
  });

  it("does not require the accuracies field", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(monthlyGames()));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    const res = await client.getMonthlyGames("testuser", 2026, 8);
    expect(res.games[1].accuracies).toBeUndefined();
  });

  it("rejects a structurally wrong profile payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    await expect(client.getProfile("testuser")).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("reads ratings out of the stats payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(STATS_RESPONSE));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    const res = await client.getStats("testuser");
    expect(res.data?.chess_rapid?.last?.rating).toBe(1234);
    expect(res.data?.chess_bullet).toBeUndefined();
  });

  it("lists archives in order", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ARCHIVES_RESPONSE));
    const client = new ChessComClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(await client.getArchives("testuser")).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("parses year and month out of an archive url", () => {
    expect(parseArchiveUrl("https://api.chess.com/pub/player/x/games/2026/08")).toEqual({
      year: 2026,
      month: 8,
    });
    expect(parseArchiveUrl("https://api.chess.com/pub/player/x")).toBeNull();
  });

  it("maps Chess.com result codes to win/loss/draw", () => {
    expect(resultFor("win")).toBe("win");
    expect(resultFor("checkmated")).toBe("loss");
    expect(resultFor("timeout")).toBe("loss");
    expect(resultFor("resigned")).toBe("loss");
    expect(resultFor("agreed")).toBe("draw");
    expect(resultFor("stalemate")).toBe("draw");
    expect(resultFor("insufficient")).toBe("draw");
    expect(resultFor(undefined)).toBe("draw");
  });
});
