import { z } from "zod";
import { startAnalysis } from "@/lib/analysis/job";
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
    const state = startAnalysis(parsed.success ? parsed.data : {});
    return ok(state, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}
