import { getJobState, requestCancel } from "@/lib/analysis/job";
import { requirePlayer } from "@/lib/auth/session";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requirePlayer();
    const cancelled = requestCancel();
    return ok({ cancelled, job: getJobState() });
  } catch (err) {
    return handleError(err);
  }
}
