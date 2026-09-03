import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { trainingTasks } from "@/db/schema";
import { buildDashboard, saveTrainingTasks } from "@/lib/coaching/dashboard";
import { fail, handleError, ok, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const playerId = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    if (playerId === null) return fail("playerId가 필요합니다.");
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
    const data = await buildDashboard(parsed.data.playerId);
    if (!data) return fail("선수를 찾을 수 없습니다.", 404);
    return ok({ tasks: await saveTrainingTasks(parsed.data.playerId, data.trainingTasks) });
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
    await db
      .update(trainingTasks)
      .set({ status: parsed.data.status })
      .where(and(eq(trainingTasks.id, parsed.data.id)));
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}
