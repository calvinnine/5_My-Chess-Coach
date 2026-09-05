/**
 * Picking which locally analysed games to upload to a deployment.
 *
 * Kept out of the script so the paging rule can be tested: the failure it
 * guards against is silent. `/api/games` caps `limit` at 500 and takes no
 * offset, so on an account with more games than that a single request sees only
 * the newest 500 — and every older game looks exactly like a game the
 * deployment does not have. The upload would then skip them and report success.
 */

export interface RemoteGame {
  id: number;
  externalUrl: string;
  playedAt: number;
  analysisStatus: string;
}

export interface LocalGame {
  externalUrl: string;
  pgn: string;
  playerColor: string;
}

/** The page limit `/api/games` enforces server-side. */
export const PAGE_SIZE = 500;

/**
 * Reads the whole list by walking backwards through time.
 *
 * `to` is inclusive, so the boundary game comes back again on the next page;
 * keying by URL absorbs that. The loop ends when a page adds nothing new, which
 * also covers the pathological case of more than a page of games sharing one
 * timestamp — better to stop early than to spin.
 */
export async function fetchAllRemoteGames(
  page: (params: { limit: number; to?: number }) => Promise<RemoteGame[]>,
  pageSize = PAGE_SIZE,
): Promise<Map<string, RemoteGame>> {
  const byUrl = new Map<string, RemoteGame>();
  let to: number | undefined;

  for (;;) {
    const rows = await page({ limit: pageSize, ...(to === undefined ? {} : { to }) });
    if (rows.length === 0) break;

    const before = byUrl.size;
    let oldest = Infinity;
    for (const row of rows) {
      byUrl.set(row.externalUrl, row);
      if (row.playedAt < oldest) oldest = row.playedAt;
    }

    if (rows.length < pageSize) break;
    if (byUrl.size === before) break;
    to = oldest;
  }

  return byUrl;
}

export interface UploadPlan<T extends LocalGame> {
  /** Games to analyse and upload, newest first, capped by `limit`. */
  targets: Array<T & { remote: RemoteGame }>;
  /** Present locally but not on the deployment — sync those first. */
  missing: number;
  /** Already analysed on the deployment; nothing to do. */
  alreadyDone: number;
  /** Matched and unanalysed, beyond what `limit` allows this run. */
  remaining: number;
}

export function planUpload<T extends LocalGame>(
  localGames: T[],
  remoteByUrl: Map<string, RemoteGame>,
  limit: number,
): UploadPlan<T> {
  const matched: Array<T & { remote: RemoteGame }> = [];
  let missing = 0;
  let alreadyDone = 0;

  for (const game of localGames) {
    const remote = remoteByUrl.get(game.externalUrl);
    if (!remote) {
      missing++;
    } else if (remote.analysisStatus === "completed") {
      alreadyDone++;
    } else {
      matched.push({ ...game, remote });
    }
  }

  return {
    targets: matched.slice(0, limit),
    missing,
    alreadyDone,
    remaining: Math.max(0, matched.length - limit),
  };
}
