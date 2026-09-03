import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";

export const SETTING_KEYS = {
  stockfishPath: "stockfish_path",
  analysisPreset: "analysis_preset",
  threads: "engine_threads",
  hashMb: "engine_hash_mb",
  activePlayer: "active_player",
  contact: "contact",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: sql`(unixepoch())` },
    });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
