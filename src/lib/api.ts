import { NextResponse } from "next/server";
import { ChessComError } from "@/lib/chesscom/client";
import { EngineMissingError } from "@/lib/analysis/job";
import { AnalysisMismatchError } from "@/lib/analysis/analyzer";
import { NotAuthenticatedError, NotOwnerError } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/auth/ownership";
import { SyncBusyError, SyncCooldownError } from "@/lib/chesscom/limits";
import { TooManyChallengesError } from "@/lib/auth/challenge-limits";

/**
 * Reads an optional positive integer query param.
 *
 * Returns null when absent or unusable. `Number(null)` is 0, which is finite —
 * treating that as a real id silently filters everything out.
 */
export function optionalPositiveInt(
  params: URLSearchParams,
  key: string,
): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Maps thrown domain errors onto sensible HTTP responses. */
export function handleError(err: unknown) {
  if (err instanceof ChessComError) {
    const status =
      err.kind === "not_found" ? 404 : err.kind === "rate_limited" ? 429 : 502;
    return fail(err.message, status, { kind: err.kind });
  }
  if (err instanceof EngineMissingError) {
    return fail(err.message, 503, { kind: "engine_missing" });
  }
  if (err instanceof NotAuthenticatedError) {
    return fail(err.message, 401, { kind: "not_authenticated" });
  }
  if (err instanceof NotOwnerError) {
    // 404 would hide that the row exists, but the caller named the id, so
    // there is nothing to hide — being explicit is more useful here.
    return fail(err.message, 403, { kind: "not_owner" });
  }
  if (err instanceof NotFoundError) {
    return fail(err.message, 404);
  }
  if (err instanceof SyncBusyError || err instanceof SyncCooldownError) {
    // Retry-After tells the client how long to wait instead of hammering.
    return fail(err.message, 429, {
      kind: err instanceof SyncBusyError ? "sync_busy" : "sync_cooldown",
      retryAfterSeconds: err.retryAfterSeconds,
    });
  }
  if (err instanceof TooManyChallengesError) {
    return fail(err.message, 429, { kind: "too_many_challenges" });
  }
  if (err instanceof AnalysisMismatchError) {
    return fail(err.message, 422, { kind: "analysis_mismatch" });
  }
  const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  return fail(message, 500);
}
