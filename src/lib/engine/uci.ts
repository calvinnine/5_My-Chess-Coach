import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { LineEngine, type EngineTransport } from "./base";

export interface EngineOptions {
  binaryPath: string;
  threads?: number;
  hashMb?: number;
  multiPv?: number;
}

const EXIT_GRACE_MS = 1500;

/**
 * A local Stockfish binary spoken to over a pipe.
 *
 * Node-only: this module reaches for `node:child_process`. The analysis layer
 * depends on `AnalysisEngine` in `./types`, not on this class, so nothing but
 * the server wiring should import it.
 */
export class UciEngine extends LineEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;

  constructor(private readonly engineOptions: EngineOptions) {
    super({
      threads: engineOptions.threads,
      hashMb: engineOptions.hashMb,
      multiPv: engineOptions.multiPv,
      supportsThreads: true,
    });
  }

  protected createTransport(): EngineTransport {
    const proc = spawn(this.engineOptions.binaryPath, [], { stdio: "pipe" });
    this.proc = proc;
    proc.on("exit", () => {
      this.proc = null;
    });
    proc.on("error", () => {
      this.proc = null;
    });

    return {
      write: (command) => {
        proc.stdin.write(`${command}\n`);
      },
      subscribe: (onLine) => {
        this.rl = readline.createInterface({ input: proc.stdout });
        this.rl.on("line", (line) => onLine(line.trim()));
      },
      dispose: async () => {
        this.rl?.close();
        this.rl = null;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            // Never leave an orphan engine behind.
            try {
              proc.kill("SIGKILL");
            } catch {
              /* already gone */
            }
            resolve();
          }, EXIT_GRACE_MS);
          proc.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        this.proc = null;
      },
    };
  }
}
