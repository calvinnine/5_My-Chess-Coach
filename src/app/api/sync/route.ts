import { z } from "zod";
import { syncPlayerGames } from "@/lib/chesscom/sync";
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
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("동기화 요청 형식이 올바르지 않습니다.");
    const summary = await syncPlayerGames(parsed.data.username, {
      months: parsed.data.months,
      maxNewGames: parsed.data.maxNewGames,
    });
    return ok(summary);
  } catch (err) {
    return handleError(err);
  }
}
