import readline from "node:readline/promises";
import { createClient } from "@libsql/client";
import { resolveLocation } from "../src/db/location";
import { analyzeGame, PRESETS, type AnalysisSettings } from "../src/lib/analysis/analyzer";
import { UciEngine } from "../src/lib/engine/uci";
import { locateEngine } from "../src/lib/engine/locate";
import type { Color } from "../src/lib/analysis/eval";
import {
  fetchAllRemoteGames,
  planUpload,
  PAGE_SIZE,
  type RemoteGame,
} from "../src/lib/analysis/upload-targets";

/**
 * Analyses games with the local Stockfish binary and uploads the results to a
 * deployment.
 *
 * Why this exists: on a deployment the engine runs in the visitor's browser,
 * which is fine for the recent games a newcomer cares about but impractical for
 * a large backlog — a few hundred games is hours of holding a tab open. A
 * machine with a native binary does the same work far faster.
 *
 * Why it re-analyses instead of copying what is already stored: the upload API
 * takes the engine's raw output, not our derived numbers, so that the server
 * re-derives every judgement itself (see docs/decisions.md D28). `move_analyses`
 * keeps the derived side — losses, grades, the best move — but not the second
 * principal variation's moves, so a stored analysis cannot be turned back into
 * something the server would accept.
 *
 * Usage:
 *   npm run upload-analysis -- --base https://analyzemychess.vercel.app --limit 50
 */

interface Args {
  base: string;
  limit: number;
  preset: keyof typeof PRESETS;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const preset = (get("preset") ?? "standard") as keyof typeof PRESETS;
  if (!PRESETS[preset]) throw new Error(`알 수 없는 프리셋: ${preset}`);
  return {
    base: (get("base") ?? "https://analyzemychess.vercel.app").replace(/\/$/, ""),
    limit: Number(get("limit") ?? 25),
    preset,
    dryRun: argv.includes("--dry-run"),
  };
}

/** Keeps the session cookie the verification flow hands back. */
class Session {
  private cookie = "";

  constructor(private readonly base: string) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(path, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${path} 실패 (${res.status})`);
    return body;
  }
}

/**
 * Signs in the same way the website does: a one-time code goes in the account's
 * public Chess.com profile and the server reads it back. No password is
 * involved, and nothing is stored on this machine.
 */
async function signIn(session: Session, username: string): Promise<string> {
  const challenge = await session.json<{ code: string; instructions: string[] }>(
    "/api/auth/challenge",
    { method: "POST", body: JSON.stringify({ username }) },
  );

  console.log("\n  Chess.com 프로필에 아래 코드를 넣고 저장하세요:\n");
  console.log(`      ${challenge.code}\n`);
  challenge.instructions.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\n  저장했으면 Enter를 누르세요… ");
  rl.close();

  const verified = await session.json<{ displayName: string }>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  console.log(`  확인됨: ${verified.displayName}\n`);
  return verified.displayName;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const location = resolveLocation();
  if (location.remote) {
    throw new Error(
      "이 스크립트는 로컬 데이터베이스에서 읽습니다. CHESS_COACH_DB를 로컬 파일로 두고 실행하세요.",
    );
  }

  const engine = locateEngine();
  if (!engine.found || !engine.path) {
    throw new Error(
      "로컬 Stockfish를 찾지 못했습니다. `brew install stockfish` 후 다시 실행하세요.",
    );
  }
  console.log(`  엔진: ${engine.version} (${engine.path})`);
  console.log(`  대상: ${args.base}`);

  const local = createClient({ url: `file:${location.filePath}` });
  const session = new Session(args.base);

  const [{ username }] = (
    await local.execute("SELECT username FROM players ORDER BY created_at LIMIT 1")
  ).rows as unknown as Array<{ username: string }>;
  if (!username) throw new Error("로컬에 등록된 선수가 없습니다.");
  console.log(`  계정: ${username}`);

  /*
   * A local instance answers for its single player without a session, so the
   * verification round trip is skipped there — which also makes this script
   * exercisable against a throwaway server.
   */
  const state = await session.json<{ authRequired: boolean }>("/api/auth/session");
  if (state.authRequired) await signIn(session, username);
  else console.log("  인증이 필요 없는 대상입니다. 본인 확인을 건너뜁니다.\n");

  /*
   * Ids differ between the two databases, so games are matched on the Chess.com
   * URL — the same key the sync uses to avoid duplicates. The list is read page
   * by page: one request tops out at 500 games, and an account past that would
   * otherwise have its older games quietly treated as absent.
   */
  const remoteByUrl = await fetchAllRemoteGames(async ({ limit, to }) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (to !== undefined) query.set("to", String(to));
    const body = await session.json<{ games: RemoteGame[] }>(`/api/games?${query}`);
    return body.games;
  }, PAGE_SIZE);
  console.log(`  배포본에 ${remoteByUrl.size}판이 있습니다.`);

  const localGames = (
    await local.execute(`
      SELECT external_url AS externalUrl, pgn, player_color AS playerColor
      FROM games WHERE rules = 'chess' AND opponent_kind = 'human' AND parse_error IS NULL
      ORDER BY played_at DESC`)
  ).rows as unknown as Array<{ externalUrl: string; pgn: string; playerColor: string }>;

  const plan = planUpload(localGames, remoteByUrl, args.limit);
  const targets = plan.targets;

  console.log(`  로컬에 ${localGames.length}판, 그중 배포본에 이미 분석된 것 ${plan.alreadyDone}판.`);
  if (plan.missing > 0) {
    console.log(
      `  배포본에 없는 대국 ${plan.missing}판은 건너뜁니다. ` +
        `대시보드에서 "지난 대국 더 가져오기"로 먼저 동기화하세요.`,
    );
  }
  console.log(`  올릴 대상: ${targets.length}판` + (plan.remaining > 0 ? ` (남는 ${plan.remaining}판은 다음 실행에서)` : ""));
  console.log("");
  if (targets.length === 0 || args.dryRun) {
    local.close();
    return;
  }

  const settings: AnalysisSettings = PRESETS[args.preset];
  const uci = new UciEngine({ binaryPath: engine.path, multiPv: settings.multiPv });
  await uci.start();

  let done = 0;
  let failed = 0;
  try {
    for (const game of targets) {
      const label = `[${done + failed + 1}/${targets.length}]`;
      try {
        const started = Date.now();
        const result = await analyzeGame(
          game.pgn,
          game.playerColor as Color,
          uci,
          settings,
        );
        await session.json(`/api/games/${game.remote.id}/analysis`, {
          method: "POST",
          body: JSON.stringify({
            engineVersion: result.engineVersion,
            preset: args.preset,
            evaluations: result.evaluations,
          }),
        });
        done++;
        console.log(`  ${label} 완료 · ${((Date.now() - started) / 1000).toFixed(0)}초`);
      } catch (err) {
        failed++;
        // One bad game should not end the run.
        console.error(`  ${label} 실패: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await uci.stop();
    local.close();
  }

  console.log(`\n  올림 ${done}판, 실패 ${failed}판.`);
}

main().catch((err) => {
  console.error(`\n오류: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
