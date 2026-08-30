import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export interface RawScore {
  /** Centipawns from the side-to-move's perspective, or null when mate. */
  cp: number | null;
  /** Moves-to-mate from the side-to-move's perspective, or null. */
  mate: number | null;
}

export interface PvLine extends RawScore {
  multipv: number;
  depth: number;
  moves: string[];
}

export interface EvaluateResult {
  lines: PvLine[];
  depth: number;
}

export interface EngineOptions {
  binaryPath: string;
  threads?: number;
  hashMb?: number;
  multiPv?: number;
}

/**
 * One long-lived Stockfish process spoken to over UCI.
 *
 * Positions are evaluated one at a time; `evaluate` serialises internally so a
 * caller cannot interleave two `go` commands on the same process.
 */
export class UciEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private listeners = new Set<(line: string) => void>();
  private ready = false;
  private busy: Promise<unknown> = Promise.resolve();
  private multiPv: number;
  private closed = false;
  versionName = "unknown";

  constructor(private readonly opts: EngineOptions) {
    this.multiPv = opts.multiPv ?? 2;
  }

  private onLine(line: string) {
    for (const listener of [...this.listeners]) listener(line);
  }

  private send(command: string) {
    if (!this.proc) throw new Error("엔진이 실행되고 있지 않습니다.");
    this.proc.stdin.write(`${command}\n`);
  }

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

  async start() {
    if (this.proc) return;
    const proc = spawn(this.opts.binaryPath, [], { stdio: "pipe" });
    this.proc = proc;
    proc.on("exit", () => {
      this.proc = null;
      this.ready = false;
    });
    proc.on("error", () => {
      this.proc = null;
      this.ready = false;
    });
    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.onLine(line.trim()));

    const idName = this.waitFor((l) => l.startsWith("id name "), 10_000).catch(
      () => "",
    );
    const uciOk = this.waitFor((l) => l === "uciok", 10_000);
    this.send("uci");
    this.versionName = (await idName).replace("id name ", "").trim() || "unknown";
    await uciOk;

    this.send(`setoption name Threads value ${this.opts.threads ?? 2}`);
    this.send(`setoption name Hash value ${this.opts.hashMb ?? 128}`);
    this.send(`setoption name MultiPV value ${this.multiPv}`);
    this.send("setoption name UCI_ShowWDL value true");
    await this.isReady();
    this.send("ucinewgame");
    await this.isReady();
    this.ready = true;
  }

  private async isReady() {
    const p = this.waitFor((l) => l === "readyok", 15_000);
    this.send("isready");
    await p;
  }

  /**
   * Evaluates one FEN. Scores come back exactly as Stockfish reports them —
   * relative to the side to move. Normalisation happens in lib/analysis.
   */
  evaluate(
    fen: string,
    opts: { depth?: number; movetimeMs?: number; signal?: AbortSignal } = {},
  ): Promise<EvaluateResult> {
    const run = async (): Promise<EvaluateResult> => {
      if (this.closed) throw new Error("엔진이 종료되었습니다.");
      if (!this.proc) await this.start();
      if (opts.signal?.aborted) throw new AbortError();

      const byMultipv = new Map<number, PvLine>();
      let maxDepth = 0;

      const collector = (line: string) => {
        if (!line.startsWith("info ")) return;
        const parsed = parseInfoLine(line);
        if (!parsed) return;
        maxDepth = Math.max(maxDepth, parsed.depth);
        const existing = byMultipv.get(parsed.multipv);
        // Keep the deepest report for each PV slot.
        if (!existing || parsed.depth >= existing.depth) {
          byMultipv.set(parsed.multipv, parsed);
        }
      };
      this.listeners.add(collector);

      const bestMove = this.waitFor(
        (l) => l.startsWith("bestmove"),
        Math.max(120_000, (opts.movetimeMs ?? 0) * 4),
      );

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
      } finally {
        this.listeners.delete(collector);
        opts.signal?.removeEventListener("abort", abortHandler);
      }

      if (opts.signal?.aborted) throw new AbortError();

      const lines = [...byMultipv.values()].sort((a, b) => a.multipv - b.multipv);
      return { lines, depth: maxDepth };
    };

    const next = this.busy.then(run, run);
    this.busy = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async stop() {
    this.closed = true;
    const proc = this.proc;
    if (!proc) return;
    try {
      proc.stdin.write("quit\n");
    } catch {
      // Already gone.
    }
    this.rl?.close();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Never leave an orphan engine behind.
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 1500);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.proc = null;
    this.ready = false;
  }

  get isRunning() {
    return this.proc !== null && this.ready;
  }
}

export class AbortError extends Error {
  constructor() {
    super("분석이 취소되었습니다.");
    this.name = "AbortError";
  }
}

export function parseInfoLine(line: string): PvLine | null {
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let moves: string[] = [];
  let sawScore = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") depth = Number(tokens[++i]);
    else if (t === "multipv") multipv = Number(tokens[++i]);
    else if (t === "score") {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      sawScore = true;
      if (kind === "cp") cp = value;
      else if (kind === "mate") mate = value;
    } else if (t === "pv") {
      moves = tokens.slice(i + 1);
      break;
    }
  }

  if (!sawScore || moves.length === 0) return null;
  return { depth, multipv, cp, mate, moves };
}
