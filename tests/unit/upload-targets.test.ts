import { describe, expect, it } from "vitest";
import {
  fetchAllRemoteGames,
  planUpload,
  type RemoteGame,
} from "@/lib/analysis/upload-targets";

function remoteGame(n: number, analysisStatus = "pending"): RemoteGame {
  return {
    id: n,
    externalUrl: `https://www.chess.com/game/live/${n}`,
    // Newest first: game 1 is the most recent.
    playedAt: 1_000_000 - n,
    analysisStatus,
  };
}

/** A stand-in for `/api/games`: newest first, `to` inclusive, capped by limit. */
function fakeApi(all: RemoteGame[]) {
  const sorted = [...all].sort((a, b) => b.playedAt - a.playedAt);
  const calls: Array<{ limit: number; to?: number }> = [];
  const page = async ({ limit, to }: { limit: number; to?: number }) => {
    calls.push({ limit, to });
    return sorted.filter((g) => to === undefined || g.playedAt <= to).slice(0, limit);
  };
  return { page, calls };
}

describe("fetchAllRemoteGames", () => {
  it("reads past the server's page cap instead of stopping at the first page", async () => {
    /*
     * The bug this exists for: one request returns the newest 500 games, and
     * the 900 older ones then look identical to games the deployment does not
     * have — so an upload silently skips them and still reports success.
     */
    const all = Array.from({ length: 1_430 }, (_, i) => remoteGame(i + 1));
    const { page, calls } = fakeApi(all);

    const byUrl = await fetchAllRemoteGames(page, 500);

    expect(byUrl.size).toBe(1_430);
    expect(byUrl.has(all[1_429].externalUrl)).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0].to).toBeUndefined();
  });

  it("stops after a single page when everything fits", async () => {
    const { page, calls } = fakeApi(Array.from({ length: 12 }, (_, i) => remoteGame(i + 1)));
    expect((await fetchAllRemoteGames(page, 500)).size).toBe(12);
    expect(calls).toHaveLength(1);
  });

  it("returns an empty map for an empty deployment", async () => {
    const { page } = fakeApi([]);
    expect((await fetchAllRemoteGames(page, 500)).size).toBe(0);
  });

  it("does not spin when a whole page shares one timestamp", async () => {
    // `to` cannot advance past a tie, so the loop has to end on "nothing new".
    const tied = Array.from({ length: 4 }, (_, i) => ({ ...remoteGame(i + 1), playedAt: 42 }));
    const { page, calls } = fakeApi(tied);

    const byUrl = await fetchAllRemoteGames(page, 2);

    expect(byUrl.size).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(10);
  });
});

describe("planUpload", () => {
  const local = (n: number) => ({
    externalUrl: `https://www.chess.com/game/live/${n}`,
    pgn: `[Event "?"] ${n}`,
    playerColor: "white",
  });

  it("separates missing, done and uploadable games", () => {
    const remote = new Map([
      [remoteGame(1).externalUrl, remoteGame(1, "completed")],
      [remoteGame(2).externalUrl, remoteGame(2, "pending")],
      [remoteGame(3).externalUrl, remoteGame(3, "failed")],
    ]);

    const plan = planUpload([local(1), local(2), local(3), local(4)], remote, 10);

    expect(plan.alreadyDone).toBe(1);
    // Game 4 exists here but not on the deployment: skipped, and counted.
    expect(plan.missing).toBe(1);
    expect(plan.targets.map((t) => t.remote.id)).toEqual([2, 3]);
    expect(plan.remaining).toBe(0);
  });

  it("caps the run at the limit and says how many are left", () => {
    const games = Array.from({ length: 5 }, (_, i) => remoteGame(i + 1));
    const remote = new Map(games.map((g) => [g.externalUrl, g]));

    const plan = planUpload(games.map((_, i) => local(i + 1)), remote, 2);

    expect(plan.targets).toHaveLength(2);
    expect(plan.remaining).toBe(3);
  });
});
