import { getJobState, requestCancel } from "@/lib/analysis/job";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cancelled = requestCancel();
    return ok({ cancelled, job: getJobState() });
  } catch (err) {
    return handleError(err);
  }
}
