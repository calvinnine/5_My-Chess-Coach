import { buildDashboard, savePatterns, saveTrainingTasks } from "@/lib/coaching/dashboard";
import { requireOwnPlayer } from "@/lib/auth/session";
import { fail, handleError, ok, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requested = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    const playerId = await requireOwnPlayer(requested);
    const data = await buildDashboard(playerId);
    if (!data) return fail("선수를 찾을 수 없습니다.", 404);
    // Keep the stored snapshot in step with what the dashboard just showed.
    await savePatterns(playerId, data.allPatterns);
    await saveTrainingTasks(playerId, data.trainingTasks);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}
