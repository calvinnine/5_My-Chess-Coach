"use client";

import { apiGet, apiSend } from "@/lib/client-api";
import { createBrowserAnalyzer, type BrowserPreset } from "./browser";
import type { Color } from "./eval";

export interface BatchProgress {
  /** Games finished so far, successful or not. */
  done: number;
  total: number;
  /** Positions searched within the game currently running. */
  position: number;
  positionTotal: number;
  currentLabel: string | null;
}

export interface BatchResult {
  analyzed: number;
  failed: number;
  /** Set when the run stopped early because it was cancelled. */
  cancelled: boolean;
}

/**
 * Analyses several games in this browser and uploads each result.
 *
 * One engine for the whole run — starting it costs a 7MB instantiation. Games
 * are done one at a time and uploaded as they finish, so a run interrupted
 * halfway leaves the completed games analysed rather than losing everything.
 *
 * A game that fails does not stop the run: one unparseable PGN should not cost
 * the visitor the other nine.
 */
export async function analyzeGamesInBrowser(
  gameIds: number[],
  options: {
    preset?: BrowserPreset;
    signal?: AbortSignal;
    onProgress?: (p: BatchProgress) => void;
  } = {},
): Promise<BatchResult> {
  const analyzer = await createBrowserAnalyzer(options.preset ?? "standard");
  let analyzed = 0;
  let failed = 0;

  try {
    for (const [index, gameId] of gameIds.entries()) {
      if (options.signal?.aborted) {
        return { analyzed, failed, cancelled: true };
      }

      try {
        const detail = await apiGet<{
          game: { pgn: string; playerColor: string; opponentUsername: string };
        }>(`/api/games/${gameId}`);

        const result = await analyzer.analyze(
          detail.game.pgn,
          detail.game.playerColor as Color,
          {
            signal: options.signal,
            onProgress: (p) =>
              options.onProgress?.({
                done: index,
                total: gameIds.length,
                position: p.done,
                positionTotal: p.total,
                currentLabel: `vs ${detail.game.opponentUsername}`,
              }),
          },
        );

        await apiSend(`/api/games/${gameId}/analysis`, "POST", {
          engineVersion: result.engineVersion,
          preset: result.preset,
          evaluations: result.evaluations,
        });
        analyzed++;
      } catch {
        // Recorded and skipped: the rest of the run is still worth doing.
        failed++;
      }

      options.onProgress?.({
        done: index + 1,
        total: gameIds.length,
        position: 0,
        positionTotal: 0,
        currentLabel: null,
      });
    }
  } finally {
    await analyzer.dispose();
  }

  return { analyzed, failed, cancelled: false };
}
