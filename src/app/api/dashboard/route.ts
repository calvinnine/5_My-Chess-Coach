import { buildDashboard, savePatterns, saveTrainingTasks } from "@/lib/coaching/dashboard";
import { fail, handleError, ok, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const playerId = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    if (playerId === null) return fail("playerId가 필요합니다.");
    const data = buildDashboard(playerId);
    if (!data) return fail("선수를 찾을 수 없습니다.", 404);
    // Keep the stored snapshot in step with what the dashboard just showed.
    savePatterns(playerId, data.allPatterns);
    saveTrainingTasks(playerId, data.trainingTasks);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}
