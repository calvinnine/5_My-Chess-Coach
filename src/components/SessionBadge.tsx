"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client-api";

interface SessionInfo {
  authRequired: boolean;
  player: { playerId: number; username: string; displayName: string } | null;
}

/**
 * Says who this browser is signed in as.
 *
 * The header used to state "로컬 전용 · 단일 사용자" unconditionally, which stops
 * being true the moment the app is deployed — so what it says now comes from
 * the session rather than from a hard-coded string.
 */
export default function SessionBadge() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    apiGet<SessionInfo>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  if (!session) return null;

  if (!session.authRequired) {
    return <span className="ml-auto text-xs text-ink-faint">로컬 전용 · 단일 사용자</span>;
  }

  if (!session.player) {
    return <span className="ml-auto text-xs text-ink-faint">로그인하지 않음</span>;
  }

  return (
    <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
      <span className="font-medium text-ink-soft">{session.player.displayName}</span>
      <button
        type="button"
        onClick={async () => {
          await apiSend("/api/auth/session", "DELETE");
          /*
           * A full reload, not a router push: signing out has to drop every
           * piece of the previous session still held in memory across the
           * screens, and a client-side navigation would keep it.
           */
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/dashboard";
        }}
        className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        로그아웃
      </button>
    </span>
  );
}
