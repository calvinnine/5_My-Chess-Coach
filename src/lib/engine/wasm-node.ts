import path from "node:path";
import { createRequire } from "node:module";
import type { EngineTransport } from "./base";
import { WasmEngine, type WasmEngineOptions } from "./wasm";

const require_ = createRequire(import.meta.url);

export type WasmVariant = "lite-single" | "lite" | "single" | "full";

const FILENAMES: Record<WasmVariant, string> = {
  "lite-single": "stockfish-18-lite-single.js",
  lite: "stockfish-18-lite.js",
  single: "stockfish-18-single.js",
  full: "stockfish-18.js",
};

/** Directory holding the shipped WASM builds inside the installed package. */
export function wasmBinDir() {
  return path.dirname(require_.resolve("stockfish/package.json")) + "/bin";
}

export function wasmFilesFor(variant: WasmVariant) {
  const dir = wasmBinDir();
  const js = path.join(dir, FILENAMES[variant]);
  return { js, wasm: js.replace(/\.js$/, ".wasm") };
}

/**
 * Runs a Stockfish WASM build in-process under Node.
 *
 * This exists so the same engine that runs in a browser can be exercised by the
 * test suite. The browser uses `createWorkerTransport` instead.
 *
 * Two details of this build matter and are easy to get wrong:
 *
 *  1. Output is delivered through `listener`, not Emscripten's `print`: the
 *     build overrides `print` to delegate to `listener` (which defaults to
 *     `postMessage` in a worker and stdout in Node).
 *  2. `ccall` runs every command except `go` synchronously, so a command sent
 *     without deferring can emit `uciok`/`readyok` before the caller has
 *     registered a listener. Sends are therefore queued onto a microtask.
 */
export function createNodeWasmTransport(
  variant: WasmVariant = "lite-single",
): Promise<EngineTransport> {
  const { js, wasm } = wasmFilesFor(variant);
  const initModule = require_(js) as () => (config: unknown) => Promise<void>;

  let emit: (line: string) => void = () => {};
  const config: Record<string, unknown> = {
    locateFile: (requested: string) => (requested.endsWith(".wasm") ? wasm : js),
    listener: (line: unknown) => emit(String(line)),
  };

  return initModule()(config).then(function whenReady(): EngineTransport {
    const isReady = config._isReady as (() => boolean) | undefined;
    if (isReady && !isReady()) {
      return new Promise<EngineTransport>((resolve) =>
        setTimeout(() => resolve(whenReady()), 10),
      ) as unknown as EngineTransport;
    }
    const ccall = config.ccall as (
      name: string,
      ret: null,
      types: string[],
      args: unknown[],
      opts: { async: boolean },
    ) => void;

    return {
      write: (command) => {
        queueMicrotask(() =>
          ccall("command", null, ["string"], [command], {
            async: /^go\b/.test(command),
          }),
        );
      },
      subscribe: (onLine) => {
        emit = onLine;
      },
      dispose: async () => {
        emit = () => {};
      },
    };
  });
}

/** A WASM engine wired to run under Node, for tests and local comparison. */
export function createNodeWasmEngine(
  variant: WasmVariant = "lite-single",
  options: WasmEngineOptions = {},
) {
  return new WasmEngine(() => createNodeWasmTransport(variant), {
    ...options,
    // Only the multi-threaded builds accept a Threads option.
    supportsThreads: options.supportsThreads ?? (variant === "lite" || variant === "full"),
  });
}
