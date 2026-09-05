"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AnalysisBar from "@/components/AnalysisBar";
import GettingStarted from "@/components/GettingStarted";
import Onboarding from "@/components/Onboarding";
import SignIn from "@/components/SignIn";
import PatternCard from "@/components/PatternCard";
import RatingTrend from "@/components/RatingTrend";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  RESULT_LABEL,
  RESULT_TONE,
  Spinner,
  Stat,
  TIME_CLASS_LABEL,
  formatDate,
} from "@/components/ui";
import { ApiError, apiGet, apiSend, readActivePlayer, writeActivePlayer } from "@/lib/client-api";
import type { DashboardResponse, PlayerSummary, RecordSummary } from "@/types/api";

const PHASES = [
  { key: "opening", label: "오프닝" },
  { key: "middlegame", label: "미들게임" },
  { key: "endgame", label: "엔드게임" },
] as const;

function recordText(record: RecordSummary) {
  if (record.games === 0) return "기록 없음";
  return `${record.wins}승 ${record.losses}패 ${record.draws}무 · ${(record.score * 100).toFixed(0)}%`;
}

interface SessionInfo {
  authRequired: boolean;
  player: { playerId: number; username: string; displayName: string } | null;
}

export default function DashboardPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[] | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  /*
   * Nothing is fetched before the session is known: on a deployment every data
   * request would 401, and the screen would show errors instead of a sign-in.
   */
  useEffect(() => {
    apiGet<SessionInfo>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession({ authRequired: true, player: null }));
  }, []);

  useEffect(() => {
    if (!session || (session.authRequired && !session.player)) return;
    apiGet<{ players: PlayerSummary[] }>("/api/players")
      .then((r) => {
        setPlayers(r.players);
        const stored = readActivePlayer();
        const chosen = r.players.find((p) => p.id === stored) ?? r.players[0];
        if (chosen) {
          // Remember the resolved player so other screens agree on who is active.
          writeActivePlayer(chosen.id);
          setPlayerId(chosen.id);
        }
      })
      .catch((err) => setError(err.message));
  }, [session]);

  const load = useCallback(async (id: number) => {
    try {
      setData(await apiGet<DashboardResponse>(`/api/dashboard?playerId=${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "대시보드를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    if (playerId) void load(playerId);
  }, [playerId, load]);

  async function sync() {
    if (!data) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const summary = await apiSend<{
        inserted: number;
        duplicates: number;
        monthsChecked: string[];
        monthsSkipped: string[];
        errors: string[];
      }>("/api/sync", "POST", { username: data.username });
      setSyncNote(
        `새 게임 ${summary.inserted}판 추가, 중복 ${summary.duplicates}판 건너뜀. ` +
          (summary.errors.length ? `오류: ${summary.errors.join("; ")}` : ""),
      );
      await load(data.playerId);
    } catch (err) {
      /*
       * Being told to wait is not a failure. Sending it to the error banner
       * would read as "something broke" for what is a normal, expected answer
       * when someone else is syncing or the cooldown has not elapsed.
       */
      if (err instanceof ApiError && err.status === 429) setSyncNote(err.message);
      else setError(err instanceof Error ? err.message : "동기화에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  }

  if (session === null) return <Spinner label="불러오는 중" />;

  /*
   * Where identities matter, proving the account comes before anything else:
   * an unproven visitor has no games and no notes to show.
   */
  if (session.authRequired && !session.player) {
    return (
      <SignIn
        onSignedIn={() =>
          apiGet<SessionInfo>("/api/auth/session").then(setSession).catch(() => {})
        }
      />
    );
  }

  if (players === null) return <Spinner label="불러오는 중" />;

  if (players.length === 0) {
    return (
      <Onboarding
        onDone={(id) => {
          writeActivePlayer(id);
          setPlayerId(id);
          apiGet<{ players: PlayerSummary[] }>("/api/players").then((r) => setPlayers(r.players));
        }}
      />
    );
  }

  if (!data) return <Spinner label="대시보드를 계산하는 중" />;

  /*
   * The dashboard is built for someone with a few hundred games. With nothing
   * analysed it is a dozen sections reading "아직 없습니다", and the one useful
   * instruction is buried at the bottom — so until there is something to show,
   * show what to do instead.
   */
  if (data.analyzedGames === 0) {
    return (
      <GettingStarted
        username={data.username}
        totalGames={data.totalGames}
        pendingGames={data.pendingGames}
        onDone={() => void load(data.playerId)}
      />
    );
  }

  const rapid = data.ratings.find((r) => r.timeClass === "rapid") ?? data.ratings[0];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{data.displayName}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            실전 {data.totalGames}판 · 분석 완료 {data.analyzedGames}판 · 미분석{" "}
            {data.pendingGames}판
            {data.practiceGames > 0 && (
              <span className="text-ink-faint">
                {" "}
                · 코치·봇 연습 {data.practiceGames}판은 통계에서 제외
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {players.length > 1 && (
            <select
              value={playerId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                writeActivePlayer(id);
                setPlayerId(id);
              }}
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "동기화 중…" : "새 게임 동기화"}
          </Button>
        </div>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {syncNote && (
        <p className="rounded-lg bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-soft">{syncNote}</p>
      )}

      <AnalysisBar playerId={data.playerId} onFinished={() => void load(data.playerId)} />

      {!data.hasEnoughSample && (
        <div className="rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-ink-soft">
          <strong className="font-semibold text-gold">관찰 중</strong> · 분석된 게임이{" "}
          {data.analyzedGames}판이라 개인 성향을 확정하지 않습니다. {data.minSample}판을 채우면
          반복 약점 진단을 시작합니다.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card
          title="현재 레이팅과 추세"
          hint={rapid ? `${TIME_CLASS_LABEL[rapid.timeClass] ?? rapid.timeClass} 기준` : undefined}
        >
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.ratings.length === 0 ? (
              <p className="col-span-full text-sm text-ink-faint">레이팅 정보가 없습니다.</p>
            ) : (
              data.ratings.map((r) => (
                <Stat
                  key={r.timeClass}
                  label={TIME_CLASS_LABEL[r.timeClass] ?? r.timeClass}
                  value={r.rating}
                />
              ))
            )}
          </div>
          <RatingTrend history={data.ratingHistory} />
        </Card>

        <Card title="최근 성적">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="최근 10판" value={`${(data.records.last10.score * 100).toFixed(0)}%`} sub={recordText(data.records.last10)} />
            <Stat label="최근 30판" value={`${(data.records.last30.score * 100).toFixed(0)}%`} sub={recordText(data.records.last30)} />
            <Stat label="최근 90판" value={`${(data.records.last90.score * 100).toFixed(0)}%`} sub={recordText(data.records.last90)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="백" value={recordText(data.byColor.white)} />
            <Stat label="흑" value={recordText(data.byColor.black)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="평균 평가 손실"
              value={data.accuracy.averageLossCp === null ? "–" : `${data.accuracy.averageLossCp}cp`}
            />
            <Stat label="중대 실수/판" value={data.accuracy.blundersPerGame ?? "–"} />
            <Stat label="실수/판" value={data.accuracy.mistakesPerGame ?? "–"} />
            <Stat label="부정확/판" value={data.accuracy.inaccuraciesPerGame ?? "–"} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="반복 약점"
          hint={`분석 ${data.analyzedGames}판 중 최근 30판 기준 · 근거 게임이 있는 항목만 표시합니다.`}
        >
          {data.weaknesses.length === 0 ? (
            <Empty>아직 반복이라 부를 만한 약점이 없습니다.</Empty>
          ) : (
            <div className="space-y-2.5">
              {data.weaknesses.map((p) => (
                <PatternCard key={p.tag} pattern={p} />
              ))}
            </div>
          )}
        </Card>

        <Card title="강점">
          {data.strengths.length === 0 ? (
            <Empty>강점으로 집계된 장면이 아직 없습니다.</Empty>
          ) : (
            <div className="space-y-2.5">
              {data.strengths.map((p) => (
                <PatternCard key={p.tag} pattern={p} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="구간별 성적"
        hint="형이 둔 수만 집계합니다. 상대 수는 평가 흐름에만 쓰고 통계에는 넣지 않습니다."
        action={
          <Link href="/training" className="text-xs text-accent hover:underline">
            훈련 가이드
          </Link>
        }
      >
        {PHASES.every((p) => !data.phaseAccuracy[p.key]) ? (
          <Empty>분석된 게임이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint">
                  <th className="pb-1.5 font-medium">구간</th>
                  <th className="pb-1.5 text-right font-medium">형이 둔 수</th>
                  <th className="pb-1.5 text-right font-medium">평균 손실</th>
                  <th className="pb-1.5 text-right font-medium">중대 실수</th>
                  <th className="pb-1.5 text-right font-medium">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {PHASES.map((phase) => {
                  const row = data.phaseAccuracy[phase.key];
                  if (!row) return null;
                  // The phase carrying most of the damage is worth spotting at a glance.
                  const worst =
                    row.blunderShare ===
                    Math.max(
                      ...PHASES.map((p) => data.phaseAccuracy[p.key]?.blunderShare ?? 0),
                    );
                  return (
                    <tr key={phase.key} className={worst ? "font-semibold" : undefined}>
                      <td className="py-1.5 pr-2">{phase.label}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.plies.toLocaleString("ko-KR")}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{row.averageLossCp}cp</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.blunders.toLocaleString("ko-KR")}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-ink-faint">
                        {(row.blunderShare * 100).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data.curriculum.priority && (
          <p className="mt-3 rounded-lg bg-gold-soft/50 px-3.5 py-2.5 text-sm text-ink-soft">
            <strong className="font-semibold">이번 주 초점: {data.curriculum.priority.label}</strong>{" "}
            — {data.curriculum.priority.reason}
          </p>
        )}
      </Card>

      <Card
        title="오프닝 준비 범위"
        hint="자주 두는 오프닝에서 자동으로 추정합니다. 직접 입력하지 않습니다."
      >
        {data.repertoire.white.undetermined && data.repertoire.black.undetermined ? (
          <Empty>준비 범위를 추정하려면 한 색으로 30판 이상이 필요합니다.</Empty>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["white", "black"] as const).map((color) => {
                const side = data.repertoire[color];
                return (
                  <div key={color} className="rounded-lg bg-surface-sunken px-3.5 py-3">
                    <div className="text-[11px] text-ink-faint">
                      {color === "white" ? "백" : "흑"} · {side.sampleSize}판
                    </div>
                    {side.undetermined || side.prepared.length === 0 ? (
                      <p className="mt-1 text-sm text-ink-faint">추정할 표본이 부족합니다.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {side.prepared.map((f) => (
                          <li key={f.family} className="flex justify-between gap-2">
                            <span className="truncate">{f.family}</span>
                            <span className="shrink-0 tabular-nums text-ink-faint">
                              {f.games}판 · {(f.share * 100).toFixed(0)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            {data.repertoireSplit.inside.games > 0 &&
              data.repertoireSplit.outside.games > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Stat
                    label="주력 오프닝 안"
                    value={`${(data.repertoireSplit.inside.score * 100).toFixed(0)}%`}
                    sub={`${data.repertoireSplit.inside.games}판 · 평균 손실 ${data.repertoireSplit.inside.averageLossCp}cp`}
                  />
                  <Stat
                    label="그 밖"
                    value={`${(data.repertoireSplit.outside.score * 100).toFixed(0)}%`}
                    sub={`${data.repertoireSplit.outside.games}판 · 평균 손실 ${data.repertoireSplit.outside.averageLossCp}cp`}
                  />
                </div>
              )}
          </>
        )}
      </Card>

      <Card title="이번 주 훈련 과제" hint="가장 심각하면서 고치기 쉬운 습관부터 최대 3개.">
        <ol className="space-y-2.5">
          {data.trainingTasks.map((task, index) => (
            <li key={`${task.title}-${index}`} className="rounded-lg bg-surface-sunken px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {index + 1}. {task.title}
                </span>
                {task.targetMinutes && <Badge tone="accent">하루 {task.targetMinutes}분</Badge>}
                {task.targetCount && <Badge tone="neutral">{task.targetCount}회</Badge>}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{task.instruction}</p>
              <p className="mt-1 text-xs text-ink-faint">완료 기준: {task.completionCriteria}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="최근 게임"
          action={
            <Link href="/games" className="text-xs text-accent hover:underline">
              전체 보기
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {data.recentGames.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/games/${g.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-sunken"
                >
                  <Badge tone={RESULT_TONE[g.result]}>{RESULT_LABEL[g.result]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    vs {g.opponentUsername}
                    <span className="text-ink-faint">
                      {" "}
                      · {g.playerColor === "white" ? "백" : "흑"} ·{" "}
                      {g.openingName ?? "오프닝 미상"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDate(g.playedAt)}</span>
                  {g.analysisStatus !== "completed" && <Badge tone="neutral">미분석</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="자주 둔 오프닝" hint="2판 이상 둔 계열만 표시합니다.">
          {data.byOpening.length === 0 ? (
            <Empty>아직 반복해서 둔 오프닝이 없습니다.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint">
                  <th className="pb-1.5 font-medium">오프닝</th>
                  <th className="pb-1.5 font-medium">색</th>
                  <th className="pb-1.5 text-right font-medium">판</th>
                  <th className="pb-1.5 text-right font-medium">성적</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.byOpening.map((o) => (
                  <tr key={`${o.opening}-${o.asColor}`}>
                    <td className="py-1.5 pr-2">{o.opening}</td>
                    <td className="py-1.5 text-ink-faint">{o.asColor === "white" ? "백" : "흑"}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.games}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {(o.score * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
