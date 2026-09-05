import { z } from "zod";
import { deleteAccount } from "@/lib/auth/account";
import { endSession, requirePlayer } from "@/lib/auth/session";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Deleting is irreversible and there is no undo, so the caller has to name the
 * account being deleted. A stray request cannot erase someone's games.
 */
const bodySchema = z.object({ confirmUsername: z.string().min(1).max(40) });

export async function DELETE(request: Request) {
  try {
    const player = await requirePlayer();

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("삭제하려면 사용자명을 입력해 주세요.");
    if (parsed.data.confirmUsername.trim().toLowerCase() !== player.username) {
      return fail("입력한 사용자명이 로그인한 계정과 다릅니다.");
    }

    const summary = await deleteAccount(player.playerId, player.username);
    // The account is gone; the cookie pointing at it must go too.
    await endSession();

    return ok({ deleted: true, ...summary });
  } catch (err) {
    return handleError(err);
  }
}
