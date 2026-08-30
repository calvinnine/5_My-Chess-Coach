import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews, games } from "@/db/schema";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userThoughts: z.string().max(8000).nullable().optional(),
  userPostmortem: z.string().max(8000).nullable().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const gameId = Number(id);
    const game = db.select({ id: games.id }).from(games).where(eq(games.id, gameId)).get();
    if (!game) return fail("게임을 찾을 수 없습니다.", 404);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("메모 형식이 올바르지 않습니다.");

    const values = {
      userThoughts: parsed.data.userThoughts ?? null,
      userPostmortem: parsed.data.userPostmortem ?? null,
    };

    db.insert(gameReviews)
      .values({ gameId, ...values, generatedBy: "user" })
      .onConflictDoUpdate({
        target: gameReviews.gameId,
        set: { ...values, createdAt: sql`(unixepoch())` },
      })
      .run();

    return ok({ saved: true, ...values });
  } catch (err) {
    return handleError(err);
  }
}
