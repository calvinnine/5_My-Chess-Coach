import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { games } from "@/db/schema";
import { requireOwnPlayer } from "@/lib/auth/session";
import { handleError, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Always scoped to the caller: an export must never span accounts.
    const playerId = await requireOwnPlayer(
      optionalPositiveInt(new URL(request.url).searchParams, "playerId"),
    );
    const rows = await db
      .select({ pgn: games.pgn })
      .from(games)
      .where(eq(games.playerId, playerId))
      .orderBy(desc(games.playedAt));
    const body = rows.map((r) => r.pgn.trim()).join("\n\n");
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-chess-pgn; charset=utf-8",
        "Content-Disposition": `attachment; filename="chess-coach-games.pgn"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
