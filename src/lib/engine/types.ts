/**
 * Engine-facing types and UCI protocol parsing.
 *
 * Deliberately free of any runtime-specific import: this module is shared by
 * the Node child-process engine and the browser WASM engine, and it is what the
 * analysis layer depends on. Nothing here may reach for `node:*` or the DOM.
 */

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

export interface EvaluateOptions {
  depth?: number;
  movetimeMs?: number;
  signal?: AbortSignal;
}

/**
 * What the analyzer needs from an engine, and nothing more.
 *
 * Implemented by `UciEngine` (local Stockfish over a pipe) and `WasmEngine`
 * (Stockfish compiled to WebAssembly, in a worker). Scores come back exactly as
 * the engine reports them — relative to the side to move; normalisation to the
 * player's perspective happens in `lib/analysis`.
 */
export interface AnalysisEngine {
  /** Engine identity, recorded alongside every analysis. */
  readonly versionName: string;
  evaluate(fen: string, opts?: EvaluateOptions): Promise<EvaluateResult>;
}

export class AbortError extends Error {
  constructor() {
    super("분석이 취소되었습니다.");
    this.name = "AbortError";
  }
}

/**
 * Parses one UCI `info` line. Returns null for lines that carry no score or no
 * principal variation (`currmove` progress reports, `info string` chatter).
 */
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

/**
 * Collects `info` lines for one search, keeping the deepest report per MultiPV
 * slot. Shared by both engines so they cannot drift apart in how they read a
 * search.
 */
export class SearchCollector {
  private readonly byMultipv = new Map<number, PvLine>();
  private maxDepth = 0;

  accept(line: string) {
    if (!line.startsWith("info ")) return;
    const parsed = parseInfoLine(line);
    if (!parsed) return;
    this.maxDepth = Math.max(this.maxDepth, parsed.depth);
    const existing = this.byMultipv.get(parsed.multipv);
    if (!existing || parsed.depth >= existing.depth) {
      this.byMultipv.set(parsed.multipv, parsed);
    }
  }

  result(): EvaluateResult {
    return {
      lines: [...this.byMultipv.values()].sort((a, b) => a.multipv - b.multipv),
      depth: this.maxDepth,
    };
  }
}
