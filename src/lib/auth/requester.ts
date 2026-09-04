import crypto from "node:crypto";

/**
 * Identifies a caller for rate-limiting only.
 *
 * Hashed, never stored raw: an address is personal data and equality is all
 * a cap needs. Callers with no address share one bucket, which is the safe
 * direction — limited together rather than not at all.
 *
 * Kept apart from the database side of rate limiting so the rule itself stays
 * testable, the same split as `puzzles.ts` and `puzzle-repo.ts`.
 */
export function requesterHashOf(request: Request): string {
  // x-forwarded-for accumulates proxies left to right; the client is first.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0].trim() || "unknown";
  return crypto.createHash("sha256").update(address).digest("hex").slice(0, 32);
}
