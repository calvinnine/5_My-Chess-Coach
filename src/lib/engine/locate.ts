import fs from "node:fs";
import { execFileSync } from "node:child_process";

const COMMON_PATHS = [
  "/opt/homebrew/bin/stockfish",
  "/usr/local/bin/stockfish",
  "/usr/bin/stockfish",
  "/opt/local/bin/stockfish",
];

export interface EngineLocation {
  found: boolean;
  path: string | null;
  version: string | null;
  source: "env" | "setting" | "path" | "common" | "none";
}

function probeVersion(binary: string): string | null {
  try {
    const out = execFileSync(binary, [], {
      input: "uci\nquit\n",
      timeout: 5000,
      encoding: "utf8",
    });
    const m = /^id name (.+)$/m.exec(out);
    return m ? m[1].trim() : "Stockfish (버전 미확인)";
  } catch {
    return null;
  }
}

/**
 * Resolves the Stockfish binary. Order: explicit setting, env var, $PATH,
 * then the usual Homebrew/MacPorts locations. Never throws — a missing engine
 * is a supported state that the UI explains.
 */
export function locateEngine(configuredPath?: string | null): EngineLocation {
  const candidates: Array<{ path: string; source: EngineLocation["source"] }> = [];
  if (configuredPath) candidates.push({ path: configuredPath, source: "setting" });
  if (process.env.STOCKFISH_PATH)
    candidates.push({ path: process.env.STOCKFISH_PATH, source: "env" });

  try {
    const which = execFileSync("/usr/bin/which", ["stockfish"], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (which) candidates.push({ path: which, source: "path" });
  } catch {
    // `which` failing just means it is not on PATH.
  }

  for (const p of COMMON_PATHS) candidates.push({ path: p, source: "common" });

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.path)) continue;
    const version = probeVersion(candidate.path);
    if (version) {
      return { found: true, path: candidate.path, version, source: candidate.source };
    }
  }
  return { found: false, path: null, version: null, source: "none" };
}
