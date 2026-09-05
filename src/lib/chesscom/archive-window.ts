import { parseArchiveUrl } from "./client";

/** How far back a first sync reaches when the caller does not say. */
export const DEFAULT_FIRST_RUN_MONTHS = 3;

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Chooses which monthly archives to request.
 *
 * Two things have to be true at once, and the old inline version only managed
 * one of them:
 *
 *  - a routine sync should be cheap, asking only for the month it stopped on
 *    and anything after it;
 *  - a caller asking for a longer window should actually get it.
 *
 * Overwriting the requested window with the incremental one made `months` a
 * parameter that was accepted and silently ignored, so older games could never
 * be fetched at all once a first sync had run. Now an explicit request widens
 * the window rather than being replaced by it.
 */
export function selectArchiveTargets(
  archives: string[],
  options: { months?: number; lastSyncedMonth?: string | null } = {},
): string[] {
  const explicit = options.months !== undefined;
  const monthsBack = options.months ?? DEFAULT_FIRST_RUN_MONTHS;
  const requestedStart = Math.max(0, archives.length - monthsBack);

  const incrementalStart = options.lastSyncedMonth
    ? archives.findIndex((url) => {
        const parsed = parseArchiveUrl(url);
        return parsed !== null && monthKey(parsed.year, parsed.month) >= options.lastSyncedMonth!;
      })
    : -1;

  if (incrementalStart < 0) return archives.slice(requestedStart);
  // An explicit window may reach further back than where the last sync stopped.
  return archives.slice(explicit ? Math.min(requestedStart, incrementalStart) : incrementalStart);
}
