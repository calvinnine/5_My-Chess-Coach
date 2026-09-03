import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { games, trainingTasks } from "@/db/schema";
import { NotOwnerError, requirePlayer } from "./session";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Loads a game only if it belongs to whoever is asking.
 *
 * Returned rather than merely checked so callers do not fetch it twice and,
 * more importantly, cannot forget to use the checked row.
 */
export async function requireOwnedGame(gameId: number) {
  const player = await requirePlayer();
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) throw new NotFoundError("게임을 찾을 수 없습니다.");
  if (game.playerId !== player.playerId) throw new NotOwnerError();
  return { game, player };
}

export async function requireOwnedTrainingTask(taskId: number) {
  const player = await requirePlayer();
  const [task] = await db
    .select({ id: trainingTasks.id, playerId: trainingTasks.playerId })
    .from(trainingTasks)
    .where(eq(trainingTasks.id, taskId))
    .limit(1);
  if (!task) throw new NotFoundError("훈련 과제를 찾을 수 없습니다.");
  if (task.playerId !== player.playerId) throw new NotOwnerError();
  return task;
}
