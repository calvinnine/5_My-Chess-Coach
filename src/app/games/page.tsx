"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AnalysisBar from "@/components/AnalysisBar";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  RESULT_LABEL,
  RESULT_TONE,
  Spinner,
  TIME_CLASS_LABEL,
  formatDateTime,
} from "@/components/ui";
import { apiGet, apiSend, readActivePlayer } from "@/lib/client-api";
import type { GameListItem, PlayerSummary } from "@/types/api";

const FILTERS = {
  result: [
    { value: "all", label: "전체" },
    { value: "win", label: "승" },
    { value: "loss", label: "패" },
    { value: "draw", label: "무" },
  ],
  color: [
    { value: "all", label: "전체" },
    { value: "white", label: "백" },
    { value: "black", label: "흑" },
  ],
  timeClass: [
    { value: "all", label: "전체" },
    { value: "rapid", label: "래피드" },
    { value: "blitz", label: "블리츠" },
    { value: "bullet", label: "불릿" },
    { value: "daily", label: "데일리" },
  ],
  analysis: [
    { value: "all", label: "전체" },
    { value: "analyzed", label: "분석 완료" },
    { value: "unanalyzed", label: "미분석" },
  ],
  opponent: [
    { value: "all", label: "전체" },
    { value: "human", label: "실전만" },
    { value: "practice", label: "코치·봇" },
  ],
} as const;

const PERIODS = [
  { value: "all", label: "전체 기간" },
  { value: "7", label: "최근 7일" },
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
] as const;

export default function GamesPage() {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [games, setGames] = useState<GameListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState({
    result: "all",
    color: "all",
    timeClass: "all",
    analysis: "all",
    opponent: "all",
    period: "all",
  });

  useEffect(() => {
    apiGet<{ players: PlayerSummary[] }>("/api/players")
      .then((r) => {
        const stored = readActivePlayer();
        setPlayerId((r.players.find((p) => p.id === stored) ?? r.players[0])?.id ?? null);
      })
      .catch((err) => setError(err.message));
  }, []);

  const load = useCallback(async () => {
    if (!playerId) return;
    const params = new URLSearchParams();
    params.set("playerId", String(playerId));
    if (filters.result !== "all") params.set("result", filters.result);
    if (filters.color !== "all") params.set("color", filters.color);
    if (filters.timeClass !== "all") params.set("timeClass", filters.timeClass);
    if (filters.analysis !== "all") params.set("analysis", filters.analysis);
    if (filters.opponent !== "all") params.set("opponent", filters.opponent);
    if (filters.period !== "all") {
      // Read the clock here, not during render: the cutoff must be computed
      // once per fetch, not recalculated on every re-render.
      const days = Number(filters.period);
      params.set("from", String(Math.floor(Date.now() / 1000) - days * 86400));
    }
    params.set("limit", "200");

    try {
      const res = await apiGet<{ games: GameListItem[] }>(`/api/games?${params}`);
      setGames(res.games);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 목록을 불러오지 못했습니다.");
    }
  }, [playerId, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const unanalyzed = useMemo(
    () =>
      (games ?? []).filter(
        (g) =>
          g.analysisStatus !== "completed" &&
          g.rules === "chess" &&
          g.opponentKind === "human",
      ),
    [games],
  );

  async function analyzeSelected() {
    const ids = selected.size > 0 ? [...selected] : unanalyzed.slice(0, 10).map((g) => g.id);
    if (ids.length === 0) return;
    try {
      await apiSend("/api/analyze-batch", "POST", { gameIds: ids });
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석을 시작하지 못했습니다.");
    }
  }

  if (!playerId && games === null && !error) return <Spinner label="불러오는 중" />;
  if (!playerId)
    return (
      <Empty>
        등록된 선수가 없습니다.{" "}
        <Link href="/dashboard" className="text-accent hover:underline">
          대시보드에서 먼저 등록
        </Link>
        해 주세요.
      </Empty>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">게임</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {games ? `${games.length}판 표시 중` : "불러오는 중"}
            {unanalyzed.length > 0 ? ` · 미분석 ${unanalyzed.length}판` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void analyzeSelected()} disabled={unanalyzed.length === 0 && selected.size === 0}>
            {selected.size > 0 ? `선택 ${selected.size}판 분석` : "미분석 10판 분석"}
          </Button>
          <a
            href={`/api/export/pgn?playerId=${playerId}`}
            className="rounded-lg border border-line-strong px-3.5 py-2 text-sm text-ink hover:bg-surface-sunken"
          >
            PGN 내보내기
          </a>
        </div>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}

      <AnalysisBar playerId={playerId} onFinished={() => void load()} />

      <Card>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {(
            [
              ["기간", "period", PERIODS],
              ["결과", "result", FILTERS.result],
              ["색", "color", FILTERS.color],
              ["시간 형식", "timeClass", FILTERS.timeClass],
              ["분석", "analysis", FILTERS.analysis],
              ["상대", "opponent", FILTERS.opponent],
            ] as const
          ).map(([label, key, options]) => (
            <div key={key} role="group" aria-label={label}>
              <div className="mb-1 text-[11px] text-ink-faint">{label}</div>
              <div className="flex gap-1">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, [key]: option.value }))}
                    className={`rounded-md px-2 py-1 text-xs transition-colors ${
                      filters[key] === option.value
                        ? "bg-ink text-paper"
                        : "bg-surface-sunken text-ink-soft hover:bg-line"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {games === null ? (
        <Spinner label="게임을 불러오는 중" />
      ) : games.length === 0 ? (
        <Empty>조건에 맞는 게임이 없습니다.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line text-left text-[11px] text-ink-faint">
              <tr>
                <th className="px-3 py-2.5 font-medium"> </th>
                <th className="px-3 py-2.5 font-medium">일시</th>
                <th className="px-3 py-2.5 font-medium">결과</th>
                <th className="px-3 py-2.5 font-medium">상대</th>
                <th className="px-3 py-2.5 text-right font-medium">레이팅 차</th>
                <th className="px-3 py-2.5 font-medium">오프닝</th>
                <th className="px-3 py-2.5 font-medium">형식</th>
                <th className="px-3 py-2.5 text-right font-medium">정확도</th>
                <th className="px-3 py-2.5 font-medium">분석</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {games.map((g) => (
                <tr key={g.id} className="hover:bg-surface-sunken">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(g.id)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(g.id);
                          else next.delete(g.id);
                          return next;
                        });
                      }}
                      aria-label={`${g.opponentUsername} 게임 선택`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-faint">
                    {formatDateTime(g.playedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={RESULT_TONE[g.result]}>{RESULT_LABEL[g.result]}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/games/${g.id}`} className="hover:underline">
                      {g.opponentUsername}
                    </Link>
                    <span className="ml-1.5 text-xs text-ink-faint">
                      {g.playerColor === "white" ? "백" : "흑"}
                    </span>
                    {g.opponentKind !== "human" && (
                      <span className="ml-1.5">
                        <Badge tone="neutral">
                          {g.opponentKind === "coach" ? "코치" : "봇"}
                        </Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                    {g.ratingDiff === null ? "–" : g.ratingDiff > 0 ? `+${g.ratingDiff}` : g.ratingDiff}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-ink-soft">
                    {g.openingName ?? "–"}
                  </td>
                  <td className="px-3 py-2 text-ink-faint">
                    {TIME_CLASS_LABEL[g.timeClass] ?? g.timeClass}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                    {g.chesscomAccuracy === null ? "–" : g.chesscomAccuracy.toFixed(1)}
                  </td>
                  <td className="px-3 py-2">
                    {g.analysisStatus === "completed" ? (
                      <Link href={`/games/${g.id}`} className="text-accent hover:underline">
                        리뷰 보기
                      </Link>
                    ) : g.analysisStatus === "skipped" ? (
                      <span title={g.analysisError ?? undefined}>
                        <Badge tone="neutral">
                          {g.rules !== "chess"
                            ? "변형 체스"
                            : g.opponentKind !== "human"
                              ? "연습 게임"
                              : "중단된 대국"}
                        </Badge>
                      </span>
                    ) : g.analysisStatus === "failed" ? (
                      <span title={g.analysisError ?? undefined}>
                        <Badge tone="loss">실패</Badge>
                      </span>
                    ) : (
                      <Badge tone="neutral">
                        {g.analysisStatus === "running" ? "진행 중" : "대기"}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
