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

export function getSetting(key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: sql`(unixepoch())` },
    })
    .run();
}

export function getAllSettings(): Record<string, string> {
  return Object.fromEntries(db.select().from(settings).all().map((r) => [r.key, r.value]));
}
