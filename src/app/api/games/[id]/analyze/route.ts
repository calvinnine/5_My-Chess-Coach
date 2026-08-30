import { startAnalysis } from "@/lib/analysis/job";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const state = startAnalysis({ gameIds: [Number(id)] });
    return ok(state, { status: 202 });
  } catch (err) {
    return handleError(err);
  }
}
