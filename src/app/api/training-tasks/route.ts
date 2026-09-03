import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { trainingTasks } from "@/db/schema";
import { buildDashboard, saveTrainingTasks } from "@/lib/coaching/dashboard";
import { requireOwnPlayer } from "@/lib/auth/session";
import { requireOwnedTrainingTask } from "@/lib/auth/ownership";
import { fail, handleError, ok, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requested = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    const playerId = await requireOwnPlayer(requested);
    return ok({
      tasks: await db
        .select()
        .from(trainingTasks)
        .where(eq(trainingTasks.playerId, playerId))
        .orderBy(desc(trainingTasks.createdAt)),
    });
  } catch (err) {
    return handleError(err);
  }
}

const postSchema = z.object({ playerId: z.number().int() });

export async function POST(request: Request) {
  try {
    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) return fail("playerId가 필요합니다.");
    const playerId = await requireOwnPlayer(parsed.data.playerId);
    const data = await buildDashboard(playerId);
    if (!data) return fail("선수를 찾을 수 없습니다.", 404);
    return ok({ tasks: await saveTrainingTasks(playerId, data.trainingTasks) });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  id: z.number().int(),
  status: z.enum(["open", "done", "dropped"]),
});

export async function PATCH(request: Request) {
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("요청 형식이 올바르지 않습니다.");
    // The id names a row directly, so it has to be checked against its owner.
    await requireOwnedTrainingTask(parsed.data.id);
    await db
      .update(trainingTasks)
      .set({ status: parsed.data.status })
      .where(and(eq(trainingTasks.id, parsed.data.id)));
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}
