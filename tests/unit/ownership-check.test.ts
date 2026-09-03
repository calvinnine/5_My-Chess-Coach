import { describe, expect, it } from "vitest";
import { ChessComClient } from "@/lib/chesscom/client";
import { checkProfileForCode } from "@/lib/auth/ownership-check";

const CODE = "mychess-0123456789";

/** Records every request so the cache behaviour can be asserted, not assumed. */
function fakeChessCom(profile: Record<string, unknown> | null) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (!profile) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { "Content-Type": "application/json", etag: '"v1"' },
    });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe("reading the profile back", () => {
  it("passes when the code is in the profile", async () => {
    const { fetchImpl } = fakeChessCom({ username: "calvinnine", location: CODE });
    const client = new ChessComClient({ fetchImpl });
    expect(await checkProfileForCode(client, "calvinnine", CODE)).toEqual({ proven: true });
  });

  it("fails when the profile does not carry the code", async () => {
    const { fetchImpl } = fakeChessCom({ username: "calvinnine", location: "Seoul" });
    const client = new ChessComClient({ fetchImpl });
    expect(await checkProfileForCode(client, "calvinnine", CODE)).toEqual({
      proven: false,
      reason: "code_absent",
    });
  });

  it("reports a profile it could not read rather than treating it as a refusal", async () => {
    const { fetchImpl } = fakeChessCom(null);
    const client = new ChessComClient({ fetchImpl });
    await expect(checkProfileForCode(client, "nobody", CODE)).rejects.toThrow();
  });

  it("passes on a repeat check, not only the first", async () => {
    /*
     * Regression: the profile used to be fetched through the conditional
     * cache. The first sign-in stored an ETag, so every later one got a 304
     * with no body — verification failed for everyone coming back.
     */
    const store = new Map<string, { etag?: string | null; lastModified?: string | null }>();
    const { fetchImpl } = fakeChessCom({ username: "calvinnine", location: CODE });
    const client = new ChessComClient({
      fetchImpl,
      cache: {
        get: (url) => store.get(url),
        set: (url, value) => void store.set(url, value),
      },
    });

    expect(await checkProfileForCode(client, "calvinnine", CODE)).toEqual({ proven: true });
    expect(await checkProfileForCode(client, "calvinnine", CODE)).toEqual({ proven: true });
  });

  it("never sends a conditional request", async () => {
    /*
     * The bug this guards against: with the ETag cache on, the second check
     * would get a 304 carrying the profile as it was BEFORE the code was
     * added, and verification could never succeed. Same shape as the archive
     * 304 that once silently stopped syncing.
     */
    const store = new Map<string, { etag?: string | null; lastModified?: string | null }>();
    const { requests, fetchImpl } = fakeChessCom({ username: "calvinnine", location: CODE });
    const client = new ChessComClient({
      fetchImpl,
      cache: {
        get: (url) => store.get(url),
        set: (url, value) => void store.set(url, value),
      },
    });

    await checkProfileForCode(client, "calvinnine", CODE);
    await checkProfileForCode(client, "calvinnine", CODE);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers["If-None-Match"]).toBeUndefined();
      expect(request.headers["If-Modified-Since"]).toBeUndefined();
    }
    // And nothing was written to the cache either, so other callers stay clean.
    expect(store.size).toBe(0);
  });
});
