import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { gameReviews } from "@/db/schema";
import { requireOwnedGame } from "@/lib/auth/ownership";
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
    // These notes are the most private thing the app stores.
    await requireOwnedGame(gameId);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("메모 형식이 올바르지 않습니다.");

    const values = {
      userThoughts: parsed.data.userThoughts ?? null,
      userPostmortem: parsed.data.userPostmortem ?? null,
    };

    await db
      .insert(gameReviews)
      .values({ gameId, ...values, generatedBy: "user" })
      .onConflictDoUpdate({
        target: gameReviews.gameId,
        set: { ...values, createdAt: sql`(unixepoch())` },
      });

    return ok({ saved: true, ...values });
  } catch (err) {
    return handleError(err);
  }
}
