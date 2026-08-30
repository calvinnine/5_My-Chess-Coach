"use client";

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `요청 실패 (${res.status})`);
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
  if (!res.ok)
    throw new Error((parsed as { error?: string }).error ?? `요청 실패 (${res.status})`);
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
