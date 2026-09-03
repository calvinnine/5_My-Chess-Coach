import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { players, verificationChallenges } from "@/db/schema";
import { ChessComClient } from "@/lib/chesscom/client";
import { registerPlayer } from "@/lib/chesscom/sync";
import { MAX_VERIFY_ATTEMPTS, normalizeUsername } from "@/lib/auth/verification";
import { checkProfileForCode } from "@/lib/auth/ownership-check";
import { startSession } from "@/lib/auth/session";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ username: z.string().min(1).max(40) });

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("사용자명을 입력해 주세요.");

    const username = normalizeUsername(parsed.data.username);
    if (!username) return fail("Chess.com 사용자명 형식이 아닙니다.");

    const [challenge] = await db
      .select()
      .from(verificationChallenges)
      .where(
        and(
          eq(verificationChallenges.username, username),
          gt(verificationChallenges.expiresAt, Math.floor(Date.now() / 1000)),
        ),
      )
      .limit(1);

    if (!challenge) {
      return fail("확인 코드가 없거나 만료되었습니다. 코드를 다시 발급해 주세요.", 410);
    }
    if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
      return fail("확인 시도가 너무 많습니다. 코드를 다시 발급해 주세요.", 429);
    }

    await db
      .update(verificationChallenges)
      .set({ attempts: sql`${verificationChallenges.attempts} + 1` })
      .where(eq(verificationChallenges.id, challenge.id));

    const outcome = await checkProfileForCode(
      new ChessComClient(),
      username,
      challenge.code,
    );
    if (!outcome.proven) {
      return outcome.reason === "no_profile"
        ? fail("Chess.com 프로필을 읽지 못했습니다.", 502)
        : fail(
            "프로필에서 코드를 찾지 못했습니다. 저장이 끝났는지 확인하고 다시 시도해 주세요.",
            403,
          );
    }

    // Only now does a player row get created, so unproven claims leave nothing.
    const registered = await registerPlayer(username);
    await db
      .update(players)
      .set({ verifiedAt: Math.floor(Date.now() / 1000) })
      .where(eq(players.id, registered.playerId));

    // The code has done its job; leaving it around would let it be replayed.
    await db.delete(verificationChallenges).where(eq(verificationChallenges.id, challenge.id));

    await startSession(registered.playerId);

    return ok({
      verified: true,
      playerId: registered.playerId,
      username: registered.username,
      displayName: registered.displayName,
    });
  } catch (err) {
    return handleError(err);
  }
}
