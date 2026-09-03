import path from "node:path";

export interface DbLocation {
  /** Where the data lives, for display: a file path locally, a URL when hosted. */
  label: string;
  /** Absolute path on disk, or null when the database is hosted. */
  filePath: string | null;
  remote: boolean;
}

/**
 * One driver everywhere: libSQL talks to a local file in development and to a
 * hosted Turso database in production. Keeping a second, local-only driver
 * around would mean every query runs through untested code once deployed.
 *
 * This lives apart from `client.ts` so migration scripts can resolve the
 * location without importing a `server-only` module.
 */
export function resolveLocation(): DbLocation {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (url) return { label: url, filePath: null, remote: true };
  /*
   * The path comes from configuration, so the bundler cannot tell where it
   * points and would otherwise trace the entire project into the deployment.
   * Opting out is deliberate: this file is only ever read at runtime.
   */
  const configured = process.env.CHESS_COACH_DB ?? "./data/chess-coach.db";
  const filePath = path.resolve(/*turbopackIgnore: true*/ configured);
  return { label: filePath, filePath, remote: false };
}
