import { z } from "zod";
import { syncPlayerGames } from "@/lib/chesscom/sync";
import { NotOwnerError, requirePlayer } from "@/lib/auth/session";
import { assertSyncCooldown, withSyncLease } from "@/lib/chesscom/limits";
import { normalizeUsername } from "@/lib/auth/verification";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  username: z.string().min(1),
  months: z.number().int().min(1).max(24).optional(),
  maxNewGames: z.number().int().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  try {
    /*
     * Identity first, before the body is even parsed: an anonymous caller has
     * no business reaching our validation logic, let alone Chess.com.
     */
    const player = await requirePlayer();

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("동기화 요청 형식이 올바르지 않습니다.");

    /*
     * Syncing someone else's handle is the thing this service must not do: it
     * would pull a stranger's games into an account that never proved it owns
     * them.
     */
    if (normalizeUsername(parsed.data.username) !== player.username) {
      throw new NotOwnerError("본인 계정만 동기화할 수 있습니다.");
    }

    await assertSyncCooldown(player.playerId);

    const summary = await withSyncLease(player.playerId, () =>
      syncPlayerGames(parsed.data.username, {
        months: parsed.data.months,
        maxNewGames: parsed.data.maxNewGames,
      }),
    );
    return ok(summary);
  } catch (err) {
    return handleError(err);
  }
}
