import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { verificationChallenges } from "@/db/schema";
import {
  CHALLENGE_TTL_SECONDS,
  makeChallengeCode,
  normalizeUsername,
} from "@/lib/auth/verification";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ username: z.string().min(1).max(40) });

/**
 * Hands out a code to put in the claimed account's Chess.com profile.
 *
 * Issuing one proves nothing and reveals nothing: the code is only useful to
 * someone who can edit that profile.
 */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("사용자명을 입력해 주세요.");

    const username = normalizeUsername(parsed.data.username);
    if (!username) return fail("Chess.com 사용자명 형식이 아닙니다.");

    const code = makeChallengeCode();
    const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;

    // Asking again replaces the outstanding code and resets the attempt count.
    await db
      .insert(verificationChallenges)
      .values({ username, code, expiresAt, attempts: 0 })
      .onConflictDoUpdate({
        target: verificationChallenges.username,
        set: { code, expiresAt, attempts: 0, createdAt: sql`(unixepoch())` },
      });

    const [row] = await db
      .select()
      .from(verificationChallenges)
      .where(eq(verificationChallenges.username, username))
      .limit(1);

    return ok({
      username,
      code: row?.code ?? code,
      expiresAt: row?.expiresAt ?? expiresAt,
      instructions: [
        "Chess.com 프로필 설정을 엽니다.",
        "하단 세부설정 내 이름(Name) 또는 위치(Location) 칸에 아래 코드를 붙여넣고 저장합니다.",
        "여기로 돌아와 확인을 누릅니다. 확인된 뒤에는 코드를 지워도 됩니다.",
      ],
    });
  } catch (err) {
    return handleError(err);
  }
}
