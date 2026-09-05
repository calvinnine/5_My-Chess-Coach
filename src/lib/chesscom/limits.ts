import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { players, syncLeases } from "@/db/schema";

/**
 * How many Chess.com syncs may be in flight across the whole service: one.
 *
 * Chess.com asks that requests be serial. A queue held in process memory cannot
 * promise that here — serverless instances scale out and each gets its own
 * module state — so the permit lives in the database, where every instance can
 * see it.
 */
const LEASE_ID = 1;

/**
 * Must outlast the longest a sync can run, which is the function's own limit
 * (`maxDuration` on the sync route). A shorter lease expires while its holder
 * is still working, and a second sync can then start alongside it — the one
 * thing the lease exists to prevent.
 */
const LEASE_TTL_SECONDS = 330;

/** How long a player must wait before syncing again. */
export const SYNC_COOLDOWN_SECONDS = 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

export class SyncBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("다른 동기화가 진행 중입니다. 잠시 후 다시 시도해 주세요.");
    this.name = "SyncBusyError";
  }
}

export class SyncCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `너무 자주 동기화하고 있습니다. ${retryAfterSeconds}초 후에 다시 시도해 주세요.`,
    );
    this.name = "SyncCooldownError";
  }
}

/**
 * Refuses a sync that comes too soon after the last one.
 *
 * A first sync is always allowed: `lastSyncedAt` is null until one completes.
 */
export async function assertSyncCooldown(playerId: number): Promise<void> {
  const [player] = await db
    .select({ lastSyncedAt: players.lastSyncedAt })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);
  if (!player?.lastSyncedAt) return;

  const elapsed = nowSeconds() - player.lastSyncedAt;
  if (elapsed < SYNC_COOLDOWN_SECONDS) {
    throw new SyncCooldownError(SYNC_COOLDOWN_SECONDS - elapsed);
  }
}

/**
 * Runs `fn` holding the one sync permit, or refuses immediately.
 *
 * Callers are turned away rather than queued. Waiting would hold a function
 * open for the length of someone else's sync, and the wait would grow with the
 * number of users — a caller told to retry is not blocked by anyone.
 */
export async function withSyncLease<T>(
  playerId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = nowSeconds();
  /*
   * Conditional update, so two instances racing here cannot both win: SQLite
   * applies the rows one at a time and only the first sees a free lease.
   * A lease past its expiry is free — an instance killed mid-sync releases
   * nothing, and must not block the service forever.
   */
  const claimed = await db
    .update(syncLeases)
    .set({ holderPlayerId: playerId, acquiredAt: now, expiresAt: now + LEASE_TTL_SECONDS })
    .where(and(eq(syncLeases.id, LEASE_ID), lte(syncLeases.expiresAt, now)));

  if (claimed.rowsAffected !== 1) {
    const [lease] = await db
      .select({ expiresAt: syncLeases.expiresAt })
      .from(syncLeases)
      .where(eq(syncLeases.id, LEASE_ID))
      .limit(1);
    const remaining = Math.max(1, (lease?.expiresAt ?? now) - now);
    throw new SyncBusyError(Math.min(remaining, LEASE_TTL_SECONDS));
  }

  try {
    return await fn();
  } finally {
    // Only release our own claim: a lease that expired and was taken over by
    // someone else must not be cleared by the process that lost it.
    await db
      .update(syncLeases)
      .set({ holderPlayerId: null, acquiredAt: null, expiresAt: 0 })
      .where(and(eq(syncLeases.id, LEASE_ID), eq(syncLeases.holderPlayerId, playerId)));
  }
}
