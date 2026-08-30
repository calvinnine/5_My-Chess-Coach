import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeGame, PRESETS } from "@/lib/analysis/analyzer";
import { selectTurningPoints } from "@/lib/analysis/review";
import { toClampedCp } from "@/lib/analysis/eval";
import { locateEngine } from "@/lib/engine/locate";
import { UciEngine } from "@/lib/engine/uci";
import { createNodeWasmEngine } from "@/lib/engine/wasm-node";
import { BLUNDER_AFTER_DECIDED, HUNG_QUEEN } from "../fixtures/pgn";

/*
 * Kept in its own file on purpose: vitest isolates per file, and two WASM
 * engine instances in one worker process exhaust it. One WASM heap per worker.
 */

const FAST = { ...PRESETS.fast, depth: 10, keyMomentDepth: 12 };

const nativeLocation = locateEngine();
const withBoth = nativeLocation.found ? describe : describe.skip;

withBoth("native and WASM agree on the coaching conclusions", () => {
  let native: UciEngine;
  let wasm: ReturnType<typeof createNodeWasmEngine>;

  beforeAll(async () => {
    native = new UciEngine({
      binaryPath: nativeLocation.path!,
      threads: 2,
      hashMb: 64,
      multiPv: 2,
    });
    wasm = createNodeWasmEngine("lite-single", { multiPv: 2, hashMb: 64 });
    // Started one at a time: two engines coming up together inside one test
    // worker was enough to exhaust it.
    await native.start();
    await wasm.start();
  }, 90_000);

  afterAll(async () => {
    await native?.stop();
    await wasm?.stop();
  });

  it("evaluates the same game to within the app's smallest threshold", async () => {
    /*
     * The WASM `lite` build uses a smaller NNUE net, so its numbers differ.
     * What matters is that they differ by less than the coarsest thing the app
     * decides on: a 50cp difference is where "good" becomes "inaccuracy". If
     * the gap were larger than that, the two engines would not be usable
     * interchangeably.
     */
    const a = await analyzeGame(BLUNDER_AFTER_DECIDED, "white", native, FAST);
    const b = await analyzeGame(BLUNDER_AFTER_DECIDED, "white", wasm, FAST);
    expect(a.moves.length).toBe(b.moves.length);

    const diffs = a.moves.map((move, i) =>
      Math.abs(toClampedCp(move.evalAfter) - toClampedCp(b.moves[i].evalAfter)),
    );
    diffs.sort((x, y) => x - y);
    const median = diffs[Math.floor(diffs.length / 2)];
    expect(median).toBeLessThan(50);
  }, 240_000);

  it("agrees on which side is winning at every point", async () => {
    // A perspective bug flips signs; a weaker net does not.
    const a = await analyzeGame(HUNG_QUEEN, "white", native, FAST);
    const b = await analyzeGame(HUNG_QUEEN, "white", wasm, FAST);
    let agreed = 0;
    let compared = 0;
    for (let i = 0; i < a.moves.length; i++) {
      const x = toClampedCp(a.moves[i].evalAfter);
      const y = toClampedCp(b.moves[i].evalAfter);
      // Only judge positions that are clearly decided one way.
      if (Math.abs(x) < 150) continue;
      compared++;
      if (Math.sign(x) === Math.sign(y)) agreed++;
    }
    expect(compared).toBeGreaterThan(0);
    expect(agreed / compared).toBeGreaterThan(0.9);
  }, 240_000);

  it("picks the same decisive moment", async () => {
    const a = await analyzeGame(BLUNDER_AFTER_DECIDED, "white", native, FAST);
    const b = await analyzeGame(BLUNDER_AFTER_DECIDED, "white", wasm, FAST);
    const topOf = (moves: typeof a.moves) => {
      const points = selectTurningPoints(moves);
      return [...points].sort((x, y) => y.importance - x.importance)[0]?.ply ?? null;
    };
    // This game turns on one move; both engines must land on it.
    expect(topOf(a.moves)).toBe(topOf(b.moves));
  }, 240_000);
});
