"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, writeActivePlayer } from "@/lib/client-api";
import type { EngineLocation } from "@/types/api";
import { Button, Card, ErrorNote, Spinner } from "./ui";

/** First-run flow: register a username, pull recent games, check the engine. */
export default function Onboarding({ onDone }: { onDone: (playerId: number) => void }) {
  const [username, setUsername] = useState("");
  const [preset, setPreset] = useState<"fast" | "standard" | "precise">("standard");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineLocation | null>(null);

  useEffect(() => {
    apiGet<{ engine: EngineLocation }>("/api/settings")
      .then((r) => setEngine(r.engine))
      .catch(() => setEngine(null));
  }, []);

  async function run() {
    setError(null);
    try {
      setBusy("Chess.com에서 프로필을 확인하는 중");
      const player = await apiSend<{ playerId: number; displayName: string }>(
        "/api/players",
        "POST",
        { username },
      );
      await apiSend("/api/settings", "PUT", { analysisPreset: preset });

      setBusy(`${player.displayName}의 최근 게임을 가져오는 중`);
      await apiSend("/api/sync", "POST", { username, months: 3, maxNewGames: 10 });

      writeActivePlayer(player.playerId);
      onDone(player.playerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">시작하기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Chess.com 사용자명만 있으면 됩니다. 비밀번호나 API 키는 필요하지 않고, 요청하지도
          않습니다.
        </p>
      </div>

      <Card title="Chess.com 사용자명">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && username.trim() && !busy) void run();
          }}
          placeholder="예: magnuscarlsen"
          autoComplete="off"
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="mt-2 text-xs text-ink-faint">
          공개 API(<code className="font-mono">api.chess.com/pub</code>)만 사용하며 최근 3개월 중
          최대 10판을 먼저 가져옵니다.
        </p>
      </Card>

      <Card title="분석 강도" hint="나중에 설정에서 바꿀 수 있습니다.">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { id: "fast", name: "빠름", detail: "depth 12 · 브라우저 한 판 40초" },
              { id: "standard", name: "표준", detail: "depth 16 · 브라우저 한 판 4~5분" },
              { id: "precise", name: "정밀", detail: "depth 20 · 훨씬 느림" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreset(option.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                preset === option.id
                  ? "border-accent bg-accent-soft"
                  : "border-line hover:bg-surface-sunken"
              }`}
            >
              <div className="text-sm font-medium">{option.name}</div>
              <div className="text-[11px] text-ink-faint">{option.detail}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Stockfish 엔진">
        {engine === null ? (
          <Spinner label="확인 중" />
        ) : engine.found ? (
          <p className="text-sm text-ink-soft">
            <span className="font-medium text-win">확인됨</span> · {engine.version}
            <br />
            <code className="font-mono text-xs text-ink-faint">{engine.path}</code>
          </p>
        ) : (
          <div className="space-y-2 text-sm text-ink-soft">
            <p>
              Stockfish를 찾지 못했습니다. 게임 수집은 지금 진행할 수 있고, 분석은 설치 후에 가능합니다.
            </p>
            <pre className="rounded-lg bg-surface-sunken px-3 py-2 font-mono text-xs">
              brew install stockfish
            </pre>
          </div>
        )}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-3">
        <Button onClick={() => void run()} disabled={!username.trim() || busy !== null}>
          등록하고 최근 10판 가져오기
        </Button>
        {busy && <Spinner label={busy} />}
      </div>
    </div>
  );
}
