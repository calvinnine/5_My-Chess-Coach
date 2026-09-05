import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIRST_RUN_MONTHS,
  monthKey,
  selectArchiveTargets,
} from "@/lib/chesscom/archive-window";

/** 2025-06 through 2026-09, the shape Chess.com returns. */
const ARCHIVES = [
  ...Array.from({ length: 7 }, (_, i) => `https://api.chess.com/pub/player/x/games/2025/${String(i + 6).padStart(2, "0")}`),
  ...Array.from({ length: 9 }, (_, i) => `https://api.chess.com/pub/player/x/games/2026/${String(i + 1).padStart(2, "0")}`),
];

const monthsOf = (urls: string[]) => urls.map((u) => u.split("/games/")[1].replace("/", "-"));

describe("choosing which monthly archives to request", () => {
  it("takes the recent months on a first sync", () => {
    const picked = selectArchiveTargets(ARCHIVES);
    expect(picked).toHaveLength(DEFAULT_FIRST_RUN_MONTHS);
    expect(monthsOf(picked)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("asks only from where it stopped on a routine sync", () => {
    // The point of the incremental path: not re-downloading a year every time.
    const picked = selectArchiveTargets(ARCHIVES, { lastSyncedMonth: "2026-08" });
    expect(monthsOf(picked)).toEqual(["2026-08", "2026-09"]);
  });

  it("reaches further back when a longer window is asked for", () => {
    /*
     * Regression: the incremental branch used to overwrite the requested
     * window outright, so `months` was accepted and silently ignored and older
     * games could never be fetched once a first sync had run.
     */
    const picked = selectArchiveTargets(ARCHIVES, {
      months: 12,
      lastSyncedMonth: "2026-08",
    });
    expect(picked).toHaveLength(12);
    expect(monthsOf(picked)[0]).toBe("2025-10");
    // Still includes everything up to the present.
    expect(monthsOf(picked).at(-1)).toBe("2026-09");
  });

  it("never narrows below what the last sync already covers", () => {
    // A short explicit window must not skip months that arrived since.
    const picked = selectArchiveTargets(ARCHIVES, {
      months: 1,
      lastSyncedMonth: "2026-06",
    });
    expect(monthsOf(picked)[0]).toBe("2026-06");
    expect(monthsOf(picked).at(-1)).toBe("2026-09");
  });

  it("covers everything when the window exceeds the history", () => {
    expect(selectArchiveTargets(ARCHIVES, { months: 240 })).toHaveLength(ARCHIVES.length);
  });

  it("falls back to the recent window when the recorded month is not in the list", () => {
    // An archive can disappear; that must not produce an empty sync.
    const picked = selectArchiveTargets(ARCHIVES, { lastSyncedMonth: "2099-01" });
    expect(picked).toHaveLength(DEFAULT_FIRST_RUN_MONTHS);
  });

  it("handles an account with no archives at all", () => {
    expect(selectArchiveTargets([], { months: 12 })).toEqual([]);
  });

  it("formats month keys so they sort as text", () => {
    expect(monthKey(2026, 9)).toBe("2026-09");
    expect(monthKey(2026, 12) > monthKey(2026, 9)).toBe(true);
  });
});
