import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { games, playerRatings, players } from "@/db/schema";
import { registerPlayer } from "@/lib/chesscom/sync";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ username: z.string().min(1) });

export async function GET() {
  try {
    const rows = db.select().from(players).orderBy(desc(players.createdAt)).all();
    return ok({
      players: rows.map((p) => ({
        ...p,
        gameCount:
          db
            .select({ count: sql<number>`count(*)` })
            .from(games)
            .where(eq(games.playerId, p.id))
            .get()?.count ?? 0,
        ratings: db
          .select()
          .from(playerRatings)
          .where(eq(playerRatings.playerId, p.id))
          .orderBy(desc(playerRatings.recordedAt))
          .all()
          .reduce<Array<{ timeClass: string; rating: number }>>((acc, r) => {
            if (!acc.some((a) => a.timeClass === r.timeClass))
              acc.push({ timeClass: r.timeClass, rating: r.rating });
            return acc;
          }, []),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("사용자명을 입력해 주세요.");
    const result = await registerPlayer(parsed.data.username);
    setSetting(SETTING_KEYS.activePlayer, String(result.playerId));
    return ok(result, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
