import {
  AbortError,
  SearchCollector,
  type AnalysisEngine,
  type EvaluateOptions,
  type EvaluateResult,
} from "./types";

/**
 * How an engine's UCI text stream is carried: a child process pipe, a Web
 * Worker, or anything else that can take a line and emit lines.
 */
export interface EngineTransport {
  /** Sends one UCI command. Implementations must not block. */
  write(command: string): void;
  /** Called once during startup to receive engine output, line by line. */
  subscribe(onLine: (line: string) => void): void;
  /** Shuts the engine down and releases the underlying resource. */
  dispose(): Promise<void>;
}

export interface LineEngineOptions {
  threads?: number;
  hashMb?: number;
  multiPv?: number;
  /**
   * Engines built without thread support (the single-threaded WASM builds)
   * reject or ignore `setoption name Threads`, so it is not sent for them.
   */
  supportsThreads?: boolean;
  /** How long to wait for `bestmove` before giving up on a search. */
  searchTimeoutMs?: number;
}

const READY_TIMEOUT_MS = 20_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 120_000;
/** Short: this only has to catch up with an engine that is already running. */
const RESYNC_TIMEOUT_MS = 10_000;

/**
 * The UCI conversation, independent of how the engine is hosted.
 *
 * Both the local Stockfish process and the WASM build speak the same protocol;
 * keeping that conversation in one place is what stops the two from drifting
 * apart in how they read a search. Subclasses supply only a transport.
 *
 * Searches are serialised: a caller cannot interleave two `go` commands on one
 * engine, because the second waits for the first to report `bestmove`.
 */
export abstract class LineEngine implements AnalysisEngine {
  private transport: EngineTransport | null = null;
  private readonly listeners = new Set<(line: string) => void>();
  private busy: Promise<unknown> = Promise.resolve();
  private started = false;
  private closed = false;
  versionName = "unknown";

  protected constructor(protected readonly options: LineEngineOptions = {}) {}

  /** Creates the transport. Called once, on first use. */
  protected abstract createTransport(): Promise<EngineTransport> | EngineTransport;

  private dispatch(line: string) {
    for (const listener of [...this.listeners]) listener(line);
  }

  private send(command: string) {
    if (!this.transport) throw new Error("엔진이 실행되고 있지 않습니다.");
    this.transport.write(command);
  }

  /**
   * Resolves on the first line matching `predicate`.
   *
   * The listener is registered before the caller sends its command; some
   * transports deliver output synchronously, and a listener attached afterwards
   * would miss `uciok` or `readyok` and then wait forever.
   */
  private waitFor(predicate: (line: string) => boolean, timeoutMs: number) {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("엔진 응답 시간이 초과되었습니다."));
      }, timeoutMs);
      const listener = (line: string) => {
        if (!predicate(line)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(line);
      };
      this.listeners.add(listener);
    });
  }

  private async isReady() {
    const ready = this.waitFor((l) => l === "readyok", READY_TIMEOUT_MS);
    this.send("isready");
    await ready;
  }

  async start() {
    if (this.started) return;
    if (this.closed) throw new Error("엔진이 종료되었습니다.");

    this.transport = await this.createTransport();
    this.transport.subscribe((line) => this.dispatch(line));

    const idName = this.waitFor((l) => l.startsWith("id name "), HANDSHAKE_TIMEOUT_MS).catch(
      () => "",
    );
    const uciOk = this.waitFor((l) => l === "uciok", HANDSHAKE_TIMEOUT_MS);
    this.send("uci");
    this.versionName = (await idName).replace("id name ", "").trim() || "unknown";
    await uciOk;

    if (this.options.supportsThreads !== false) {
      this.send(`setoption name Threads value ${this.options.threads ?? 2}`);
    }
    this.send(`setoption name Hash value ${this.options.hashMb ?? 128}`);
    this.send(`setoption name MultiPV value ${this.options.multiPv ?? 2}`);
    this.send("setoption name UCI_ShowWDL value true");
    await this.isReady();
    this.send("ucinewgame");
    await this.isReady();
    this.started = true;
  }

  evaluate(fen: string, opts: EvaluateOptions = {}): Promise<EvaluateResult> {
    const run = async (): Promise<EvaluateResult> => {
      if (this.closed) throw new Error("엔진이 종료되었습니다.");
      if (!this.started) await this.start();
      if (opts.signal?.aborted) throw new AbortError();

      const search = new SearchCollector();
      const collector = (line: string) => search.accept(line);
      this.listeners.add(collector);

      const bestMove = this.waitFor(
        (l) => l.startsWith("bestmove"),
        Math.max(
          this.options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
          (opts.movetimeMs ?? 0) * 4,
        ),
      );

      // Aborting asks the engine to stop searching; it still answers bestmove,
      // which lets the transport stay in a clean state for the next call.
      const abortHandler = () => this.send("stop");
      opts.signal?.addEventListener("abort", abortHandler, { once: true });

      try {
        this.send(`position fen ${fen}`);
        this.send(
          opts.movetimeMs
            ? `go movetime ${opts.movetimeMs}`
            : `go depth ${opts.depth ?? 16}`,
        );
        await bestMove;
      } catch (err) {
        await this.resynchronise();
        throw err;
      } finally {
        this.listeners.delete(collector);
        opts.signal?.removeEventListener("abort", abortHandler);
      }

      if (opts.signal?.aborted) throw new AbortError();
      return search.result();
    };

    // Keep the chain alive even when one search rejects.
    const next = this.busy.then(run, run);
    this.busy = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Brings the engine back to a known state after a search failed to report.
   *
   * A timed-out search is still running inside the engine. Left alone, the next
   * `go` collides with it — Stockfish ignores `position` while searching, so the
   * following `bestmove` answers for the *previous* position and gets recorded
   * against the wrong ply. That is worse than the failure that caused it,
   * because nothing looks broken afterwards.
   *
   * If the engine cannot be brought back, its transport is discarded so the
   * next call starts a fresh one.
   */
  private async resynchronise() {
    try {
      const drained = this.waitFor(
        (l) => l.startsWith("bestmove"),
        RESYNC_TIMEOUT_MS,
      ).catch(() => undefined);
      this.send("stop");
      await drained;

      const ready = this.waitFor((l) => l === "readyok", RESYNC_TIMEOUT_MS);
      this.send("isready");
      await ready;
    } catch {
      await this.discardTransport();
    }
  }

  /** Tears the transport down without closing the engine for good. */
  private async discardTransport() {
    const transport = this.transport;
    this.transport = null;
    this.started = false;
    if (!transport) return;
    try {
      transport.write("quit");
    } catch {
      // Already gone.
    }
    try {
      await transport.dispose();
    } catch {
      // Best effort: the next call creates a fresh transport regardless.
    }
  }

  async stop() {
    this.closed = true;
    this.listeners.clear();
    await this.discardTransport();
  }

  get isRunning() {
    return this.transport !== null && this.started;
  }
}
