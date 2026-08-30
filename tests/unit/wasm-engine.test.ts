import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeGame, PRESETS } from "@/lib/analysis/analyzer";
import { createNodeWasmEngine } from "@/lib/engine/wasm-node";
import type { AnalysisEngine } from "@/lib/engine/types";
import { HUNG_QUEEN } from "../fixtures/pgn";

// Shallow on purpose: these tests check that the pipeline is engine-agnostic,
// not that a particular depth is reached.
const FAST = { ...PRESETS.fast, depth: 10, keyMomentDepth: 12 };

describe("WASM engine", () => {
  let engine: AnalysisEngine & { start(): Promise<void>; stop(): Promise<void> };

  beforeAll(async () => {
    engine = createNodeWasmEngine("lite-single", { multiPv: 2, hashMb: 64 });
    await engine.start();
  }, 60_000);

  afterAll(async () => {
    await engine?.stop();
  });

  it("satisfies the AnalysisEngine contract", () => {
    // Typed as the interface above; this asserts the shape at runtime too.
    expect(typeof engine.evaluate).toBe("function");
    expect(engine.versionName.toLowerCase()).toContain("stockfish");
  });

  it("returns MultiPV lines with a principal variation", async () => {
    const result = await engine.evaluate(
      "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      { depth: 10 },
    );
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines[0].moves.length).toBeGreaterThan(0);
    expect(result.depth).toBeGreaterThanOrEqual(10);
  }, 60_000);

  it("finds mate in one", async () => {
    const result = await engine.evaluate("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", {
      depth: 12,
    });
    expect(result.lines[0].mate).toBe(1);
    expect(result.lines[0].moves[0]).toBe("a1a8");
  }, 60_000);

  it("stops cleanly when aborted", async () => {
    const controller = new AbortController();
    const promise = engine.evaluate(
      "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9",
      { depth: 30, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 200);
    await expect(promise).rejects.toThrow();

    // Still usable afterwards.
    const after = await engine.evaluate("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", { depth: 8 });
    expect(after.lines.length).toBeGreaterThan(0);
  }, 60_000);

  it("drives analyzeGame unchanged", async () => {
    const result = await analyzeGame(HUNG_QUEEN, "white", engine, FAST);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.engineVersion.toLowerCase()).toContain("wasm");
    for (const move of result.moves) {
      if (move.centipawnLoss !== null) expect(move.centipawnLoss).toBeGreaterThanOrEqual(0);
      if (!move.isPlayerMove) expect(move.classification).toBeNull();
    }
  }, 180_000);
});
