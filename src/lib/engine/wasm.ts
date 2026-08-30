import { LineEngine, type EngineTransport } from "./base";

export interface WasmEngineOptions {
  hashMb?: number;
  multiPv?: number;
  /**
   * The `lite-single` build caps Threads at 1 and the multi-threaded builds
   * need cross-origin isolation, so this defaults to off. See
   * `docs/public-app-plan.md` for why lite-single is the shipped build.
   */
  threads?: number;
  supportsThreads?: boolean;
}

/**
 * Stockfish compiled to WebAssembly.
 *
 * Speaks exactly the same UCI conversation as the local binary — everything
 * except the transport lives in `LineEngine`, so the analysis layer cannot tell
 * the two apart.
 */
export class WasmEngine extends LineEngine {
  constructor(
    private readonly makeTransport: () => Promise<EngineTransport> | EngineTransport,
    options: WasmEngineOptions = {},
  ) {
    super({
      threads: options.threads,
      hashMb: options.hashMb ?? 128,
      multiPv: options.multiPv ?? 2,
      supportsThreads: options.supportsThreads ?? false,
    });
  }

  protected createTransport() {
    return this.makeTransport();
  }
}

/**
 * Transport backed by a Web Worker running a Stockfish WASM build.
 *
 * The build detects the worker context and wires its output straight to
 * `postMessage`, so the worker script needs no wrapper of our own.
 *
 * Browser-only: keep this out of any server code path.
 */
export function createWorkerTransport(scriptUrl: string | URL): EngineTransport {
  const worker = new Worker(scriptUrl, { type: "classic" });
  return {
    write: (command) => worker.postMessage(command),
    subscribe: (onLine) => {
      worker.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (typeof data !== "string") return;
        // A build may emit several lines in one message.
        for (const line of data.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) onLine(trimmed);
        }
      };
    },
    dispose: async () => {
      worker.terminate();
    },
  };
}

/** Convenience wiring for the browser: worker transport + engine. */
export function createBrowserEngine(
  scriptUrl: string | URL,
  options: WasmEngineOptions = {},
) {
  return new WasmEngine(() => createWorkerTransport(scriptUrl), options);
}
