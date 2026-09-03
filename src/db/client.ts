import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { resolveLocation } from "./location";
import * as schema from "./schema";

export { resolveLocation, type DbLocation } from "./location";

export const dbLocation = resolveLocation();

function open(): Client {
  if (dbLocation.remote) {
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!authToken) {
      throw new Error(
        "TURSO_DATABASE_URL은 설정됐지만 TURSO_AUTH_TOKEN이 없습니다. 둘 다 필요합니다.",
      );
    }
    return createClient({ url: dbLocation.label, authToken });
  }

  const filePath = dbLocation.filePath!;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  /*
   * WAL is not set here: journal mode is stored in the file itself, so the
   * migrator sets it once and every later connection inherits it. Setting it
   * from here would mean firing an unawaited statement before the first query.
   *
   * Foreign keys are enforced by default, unlike better-sqlite3.
   */
  return createClient({ url: `file:${filePath}` });
}

// Next.js dev server re-evaluates modules on every hot reload; keep one handle.
const globalForDb = globalThis as unknown as { __chessCoachClient?: Client };

export const client = globalForDb.__chessCoachClient ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__chessCoachClient = client;

export const db = drizzle(client, { schema });
export { schema };
