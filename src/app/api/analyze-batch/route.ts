import { z } from "zod";
import { startAnalysis } from "@/lib/analysis/job";
import { requireOwnPlayer } from "@/lib/auth/session";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  playerId: z.number().int().optional(),
  gameIds: z.array(z.number().int()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    const options = parsed.success ? parsed.data : {};
    /*
     * Pinned to the caller. Without this, an empty body would queue every
     * pending game in the database, across accounts.
     */
    const playerId = await requireOwnPlayer(options.playerId ?? null);
    const state = await startAnalysis({ ...options, playerId });
    return ok(state, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}
