import { authRequired, currentPlayer, endSession } from "@/lib/auth/session";
import { handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who this browser is signed in as, and whether signing in is required here. */
export async function GET() {
  try {
    const player = await currentPlayer();
    return ok({ authRequired: authRequired(), player });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  try {
    await endSession();
    return ok({ signedOut: true });
  } catch (err) {
    return handleError(err);
  }
}
