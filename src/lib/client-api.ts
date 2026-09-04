"use client";

/**
 * A failed API call, carrying what the server said about it.
 *
 * The status and `kind` used to be thrown away, which left the screens unable
 * to tell "this broke" from "wait a moment and try again" — both surfaced as
 * the same red error.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorBody {
  error?: string;
  kind?: string;
  retryAfterSeconds?: number;
}

function toApiError(body: unknown, status: number): ApiError {
  const parsed = (body ?? {}) as ErrorBody;
  return new ApiError(
    parsed.error ?? `요청 실패 (${status})`,
    status,
    parsed.kind,
    parsed.retryAfterSeconds,
  );
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw toApiError(body, res.status);
  return body as T;
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw toApiError(parsed, res.status);
  return parsed as T;
}

const ACTIVE_PLAYER_KEY = "chess-coach.active-player";

export function readActivePlayer(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ACTIVE_PLAYER_KEY);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function writeActivePlayer(id: number) {
  window.localStorage.setItem(ACTIVE_PLAYER_KEY, String(id));
}
