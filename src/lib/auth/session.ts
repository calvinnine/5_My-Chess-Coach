import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, dbLocation } from "@/db/client";
import { players, sessions } from "@/db/schema";

const COOKIE_NAME = "chess_coach_session";
const SESSION_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Whether visitors have to prove who they are.
 *
 * Tied to where the database lives rather than to a flag of its own. A hosted
 * deployment necessarily sets `TURSO_DATABASE_URL`, so forgetting to configure
 * anything leaves the deployment locked rather than open — the failure has to
 * fall on the safe side. A local file-backed database is the single-user app
 * this started as, and stays open.
 */
export function authRequired(): boolean {
  if (process.env.CHESS_COACH_REQUIRE_AUTH === "1") return true;
  if (process.env.CHESS_COACH_REQUIRE_AUTH === "0") return false;
  return dbLocation.remote;
}

/**
 * Whether this request arrived over HTTPS.
 *
 * The session cookie is marked `Secure` from this, not from `NODE_ENV`: a
 * production build served over plain http — `next start` on localhost, or any
 * self-hosted setup without TLS — would otherwise set a `Secure` cookie that
 * Safari silently discards, and signing in would appear to do nothing.
 */
async function requestIsHttps(): Promise<boolean> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  // No proxy in front: only a local host is plausibly being served over http.
  const host = h.get("host") ?? "";
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class NotAuthenticatedError extends Error {
  constructor(message = "로그인이 필요합니다.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotOwnerError extends Error {
  constructor(message = "다른 사용자의 데이터에는 접근할 수 없습니다.") {
    super(message);
    this.name = "NotOwnerError";
  }
}

/** Issues a session for a player whose ownership has just been proven. */
export async function startSession(playerId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  await db.insert(sessions).values({ tokenHash: hashToken(token), playerId, expiresAt });
  // Expired rows are dead weight and a stale record of who used the service.
  await db.delete(sessions).where(lt(sessions.expiresAt, Math.floor(Date.now() / 1000)));

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await requestIsHttps(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(COOKIE_NAME);
}

export interface SignedInPlayer {
  playerId: number;
  username: string;
  displayName: string;
}

/**
 * Who is making this request, or null.
 *
 * With authentication off (the local single-user app) this resolves to the one
 * registered player, so every route can be written the same way whether or not
 * anyone had to sign in.
 */
export async function currentPlayer(): Promise<SignedInPlayer | null> {
  if (!authRequired()) {
    const [only] = await db
      .select({
        playerId: players.id,
        username: players.username,
        displayName: players.displayName,
      })
      .from(players)
      .limit(1);
    return only ?? null;
  }

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      playerId: players.id,
      username: players.username,
      displayName: players.displayName,
    })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, Math.floor(Date.now() / 1000)),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The signed-in player, or a thrown error the API layer turns into a 401. */
export async function requirePlayer(): Promise<SignedInPlayer> {
  const player = await currentPlayer();
  if (!player) throw new NotAuthenticatedError();
  return player;
}

/**
 * Resolves the player a request is allowed to act on.
 *
 * Callers pass whatever player id the request named; asking for someone else's
 * is refused rather than quietly answered for the caller's own data, so a
 * mistake surfaces instead of returning the wrong person's games.
 */
export async function requireOwnPlayer(requested: number | null): Promise<number> {
  const player = await requirePlayer();
  if (requested !== null && requested !== player.playerId) throw new NotOwnerError();
  return player.playerId;
}
