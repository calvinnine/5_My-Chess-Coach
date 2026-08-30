import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { games } from "@/db/schema";
import { handleError, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const playerId = optionalPositiveInt(new URL(request.url).searchParams, "playerId");
    const rows = db
      .select({ pgn: games.pgn })
      .from(games)
      .where(playerId === null ? undefined : eq(games.playerId, playerId))
      .orderBy(desc(games.playedAt))
      .all();
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
