"use client";

import { createBrowserEngine } from "@/lib/engine/wasm";
import { apiGet } from "@/lib/client-api";
import {
  analyzeGame,
  PRESETS,
  type AnalyzeProgress,
  type PositionEval,
} from "./analyzer";
import type { Color } from "./eval";

/** Served from `public/engine/`, put there by `npm run engine:copy`. */
const ENGINE_URL = "/engine/stockfish-18-lite-single.js";

export type BrowserPreset = "fast" | "standard" | "precise";

const PRESET_NAMES: BrowserPreset[] = ["fast", "standard", "precise"];

/**
 * The analysis strength the visitor chose in settings.
 *
 * Every browser-side caller used to hard-code "standard", which made the
 * setting decorative — and on a deployment, where the browser is the only
 * engine, it was the only control over how long an analysis takes.
 */
export async function loadAnalysisPreset(): Promise<BrowserPreset> {
  try {
    const res = await apiGet<{ settings: Record<string, string> }>("/api/settings");
    const stored = res.settings.analysis_preset as BrowserPreset | undefined;
    return stored && PRESET_NAMES.includes(stored) ? stored : "standard";
  } catch {
    return "standard";
  }
}

export interface BrowserAnalysisResult {
  engineVersion: string;
  preset: BrowserPreset;
  evaluations: PositionEval[];
}

/**
 * Runs the analysis in this browser, in a worker.
 *
 * Only the raw engine output is returned. Everything the app concludes from it
 * is recomputed on the server from the PGN it already stores, so nothing this
 * function derives locally is what ends up being saved — see
 * `api/games/[id]/analysis`.
 */
export interface BrowserAnalyzer {
  analyze(
    pgn: string,
    playerColor: Color,
    options?: { signal?: AbortSignal; onProgress?: (p: AnalyzeProgress) => void },
  ): Promise<BrowserAnalysisResult>;
  dispose(): Promise<void>;
}

/**
 * Starts the engine once and keeps it for several games.
 *
 * Standing it up costs a 7MB WebAssembly instantiation, so a run over ten
 * games must not pay that ten times.
 */
export async function createBrowserAnalyzer(
  preset: BrowserPreset = "standard",
): Promise<BrowserAnalyzer> {
  /*
   * The shipped build is single-threaded: the multi-threaded ones need
   * cross-origin isolation for SharedArrayBuffer, which would constrain every
   * page on the site. Hash is kept modest because this shares memory with the
   * page it is running in.
   */
  const engine = createBrowserEngine(ENGINE_URL, {
    hashMb: 64,
    multiPv: PRESETS[preset].multiPv,
    supportsThreads: false,
  });
  await engine.start();

  return {
    async analyze(pgn, playerColor, options = {}) {
      const result = await analyzeGame(pgn, playerColor, engine, PRESETS[preset], {
        signal: options.signal,
        onProgress: options.onProgress,
      });
      return {
        engineVersion: result.engineVersion,
        preset,
        evaluations: result.evaluations,
      };
    },
    dispose: () => engine.stop(),
  };
}

/** One game, engine started and stopped around it. */
export async function analyzeInBrowser(
  pgn: string,
  playerColor: Color,
  options: {
    preset?: BrowserPreset;
    signal?: AbortSignal;
    onProgress?: (p: AnalyzeProgress) => void;
  } = {},
): Promise<BrowserAnalysisResult> {
  const analyzer = await createBrowserAnalyzer(options.preset ?? "standard");
  try {
    return await analyzer.analyze(pgn, playerColor, options);
  } finally {
    await analyzer.dispose();
  }
}

/** Whether this browser can run the WASM engine at all. */
export function browserEngineSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiate === "function"
  );
}
