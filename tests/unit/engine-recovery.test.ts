import { describe, expect, it } from "vitest";
import { LineEngine, type EngineTransport } from "@/lib/engine/base";

/**
 * A scriptable stand-in for a real engine, so recovery behaviour can be tested
 * without waiting on Stockfish.
 */
class FakeTransport implements EngineTransport {
  readonly commands: string[] = [];
  private emit: (line: string) => void = () => {};
  /** Set to make the next `go` never answer, as a stalled search would. */
  swallowNextSearch = false;
  /** Set to make the engine stop answering anything at all. */
  deaf = false;
  /** What the next completed search reports as its best move. */
  nextBestMove = "e2e4";
  disposed = false;

  subscribe(onLine: (line: string) => void) {
    this.emit = onLine;
  }

  write(command: string) {
    this.commands.push(command);
    // Replies are asynchronous, like a real engine's.
    queueMicrotask(() => this.handle(command));
  }

  private handle(command: string) {
    if (this.deaf) return;
    if (command === "uci") {
      this.emit("id name Fake Engine 1.0");
      this.emit("uciok");
      return;
    }
    if (command === "isready") {
      this.emit("readyok");
      return;
    }
    if (command.startsWith("go")) {
      if (this.swallowNextSearch) {
        // A stalled search: no info, no bestmove, until someone says `stop`.
        this.swallowNextSearch = false;
        this.stalled = true;
        return;
      }
      if (this.stalled) {
        /*
         * A real engine ignores `position` and `go` while it is still
         * searching, and eventually reports the *old* search. Modelling that is
         * the whole point: it is how a stale result ends up attributed to the
         * next position.
         */
        this.stalled = false;
        this.emit("info depth 3 multipv 1 score cp 900 pv stalled-search-result");
        this.emit("bestmove stalled-search-result");
        return;
      }
      this.emit(`info depth 12 multipv 1 score cp 25 pv ${this.nextBestMove} e7e5`);
      this.emit(`bestmove ${this.nextBestMove}`);
      return;
    }
    if (command === "stop" && this.stalled) {
      this.stalled = false;
      this.emit("bestmove stalled-search-result");
      return;
    }
  }

  private stalled = false;

  async dispose() {
    this.disposed = true;
  }
}

class FakeEngine extends LineEngine {
  constructor(
    private readonly fake: FakeTransport,
    searchTimeoutMs: number,
  ) {
    super({ searchTimeoutMs, supportsThreads: false, multiPv: 1 });
  }
  protected createTransport() {
    return this.fake;
  }
}

describe("recovery after a search never reports", () => {
  it("rejects the stalled search rather than hanging forever", async () => {
    const transport = new FakeTransport();
    const engine = new FakeEngine(transport, 150);
    await engine.start();

    transport.swallowNextSearch = true;
    await expect(engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1", { depth: 12 })).rejects.toThrow();
    await engine.stop();
  });

  it("tells the engine to stop searching before moving on", async () => {
    /*
     * Regression: a timed-out search kept running inside the engine. Nothing
     * cancelled it, so the next `go` collided with a search already in flight.
     */
    const transport = new FakeTransport();
    const engine = new FakeEngine(transport, 150);
    await engine.start();

    transport.swallowNextSearch = true;
    await expect(engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1")).rejects.toThrow();

    expect(transport.commands).toContain("stop");
    // And it re-synchronises before handing the engine back to the caller.
    const afterStop = transport.commands.slice(transport.commands.indexOf("stop"));
    expect(afterStop).toContain("isready");
    await engine.stop();
  });

  it("does not attribute the stalled search's result to the next position", async () => {
    /*
     * The heart of the bug: without recovery, the abandoned search's `bestmove`
     * was still in flight and became the answer to the *following* position.
     * That is silent corruption — the analysis looks fine but records the wrong
     * move against the wrong ply.
     */
    const transport = new FakeTransport();
    const engine = new FakeEngine(transport, 150);
    await engine.start();

    transport.swallowNextSearch = true;
    await expect(engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1")).rejects.toThrow();

    transport.nextBestMove = "d2d4";
    const result = await engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1", { depth: 12 });
    expect(result.lines[0].moves[0]).toBe("d2d4");
    expect(result.lines[0].moves[0]).not.toBe("stalled-search-result");
    await engine.stop();
  });

  it("keeps working for the rest of the batch", async () => {
    const transport = new FakeTransport();
    const engine = new FakeEngine(transport, 150);
    await engine.start();

    transport.swallowNextSearch = true;
    await expect(engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1")).rejects.toThrow();

    for (const move of ["a2a4", "b2b4", "c2c4"]) {
      transport.nextBestMove = move;
      const result = await engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1", { depth: 8 });
      expect(result.lines[0].moves[0]).toBe(move);
    }
    await engine.stop();
  });

  it("discards an engine that cannot be resynchronised", async () => {
    // The engine goes silent entirely, so `stop` and `isready` get no answer.
    // A wedged engine must be thrown away, not handed back to the caller.
    const transport = new FakeTransport();
    const engine = new FakeEngine(transport, 100);
    await engine.start();

    transport.swallowNextSearch = true;
    transport.deaf = true;

    await expect(engine.evaluate("8/8/8/8/8/8/8/K6k w - - 0 1")).rejects.toThrow();
    expect(engine.isRunning).toBe(false);
    expect(transport.disposed).toBe(true);
  }, 60_000);
});
