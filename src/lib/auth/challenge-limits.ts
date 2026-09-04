import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { verificationChallenges } from "@/db/schema";

/**
 * Bounds on handing out verification codes.
 *
 * Issuing a code needs no session — it cannot, since it is how a session is
 * obtained — so it is the one route where an anonymous caller writes to the
 * database. Without a bound, a script could fill the table with codes for
 * usernames it does not own. None of them would ever verify, but the writes
 * still count against the database quota and crowd out real sign-ins.
 */

/** One caller's outstanding codes. A person needs one, maybe two on a retry. */
const MAX_PER_REQUESTER = 5;

/** Total outstanding across everyone, so no single burst exhausts the table. */
const MAX_OUTSTANDING = 500;

export class TooManyChallengesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooManyChallengesError";
  }
}

/** Drops codes that have expired. They can no longer be used for anything. */
export async function purgeExpiredChallenges(): Promise<void> {
  await db
    .delete(verificationChallenges)
    .where(lt(verificationChallenges.expiresAt, Math.floor(Date.now() / 1000)));
}

export async function assertChallengeAllowed(requesterHash: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const [mine] = await db
    .select({ count: sql<number>`count(*)` })
    .from(verificationChallenges)
    .where(
      and(
        eq(verificationChallenges.requesterHash, requesterHash),
        gt(verificationChallenges.expiresAt, now),
      ),
    );
  if ((mine?.count ?? 0) >= MAX_PER_REQUESTER) {
    throw new TooManyChallengesError(
      "확인 코드를 너무 많이 요청했습니다. 기존 코드를 사용하거나 잠시 후 다시 시도해 주세요.",
    );
  }

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(verificationChallenges)
    .where(gt(verificationChallenges.expiresAt, now));
  if ((total?.count ?? 0) >= MAX_OUTSTANDING) {
    throw new TooManyChallengesError(
      "지금은 확인 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}
