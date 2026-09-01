"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PatternCard from "@/components/PatternCard";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Spinner,
  Stat,
} from "@/components/ui";
import { apiGet, readActivePlayer } from "@/lib/client-api";
import type { DashboardResponse, PerspectiveReport, PlayerSummary } from "@/types/api";

const PHASE_LABEL: Record<string, string> = {
  opening: "오프닝",
  middlegame: "미들게임",
  endgame: "엔드게임",
};

function PerspectiveSection({
  report,
  isPriority,
}: {
  report: PerspectiveReport;
  isPriority: boolean;
}) {
  return (
    <Card
      title={report.label}
      action={isPriority ? <Badge tone="gold">이번 주 초점</Badge> : undefined}
      className={isPriority ? "border-gold/40" : undefined}
    >
      <p className="text-[15px] leading-relaxed text-ink-soft">
        {report.headline.split("**").map((chunk, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-semibold text-ink">
              {chunk}
            </strong>
          ) : (
            <span key={i}>{chunk}</span>
          ),
        )}
      </p>

      {report.accuracy && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={`${PHASE_LABEL[report.phase ?? ""] ?? "구간"} 평균 손실`}
            value={`${report.accuracy.averageLossCp}cp`}
          />
          <Stat label="형이 둔 수" value={report.accuracy.plies.toLocaleString("ko-KR")} />
          <Stat
            label="중대 실수"
            value={report.accuracy.blunders.toLocaleString("ko-KR")}
            sub={`판당 ${report.accuracy.blundersPerGame}`}
          />
          <Stat
            label="전체 중대 실수 중"
            value={`${(report.accuracy.blunderShare * 100).toFixed(0)}%`}
          />
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-1.5 text-[11px] text-ink-faint">훈련 항목</h3>
        <ol className="space-y-1.5 text-sm leading-relaxed text-ink-soft">
          {report.drills.map((drill) => (
            <li key={drill} className="flex gap-2">
              <span className="text-ink-faint">·</span>
              <span>{drill}</span>
            </li>
          ))}
        </ol>
      </div>

      {report.weaknesses.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[11px] text-ink-faint">
            근거가 되는 약점 {report.weaknesses.length}개
          </h3>
          <div className="space-y-2.5">
            {report.weaknesses.map((p) => (
              <PatternCard key={p.tag} pattern={p} />
            ))}
          </div>
        </div>
      )}

      {report.strengths.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[11px] text-ink-faint">유지할 강점</h3>
          <div className="space-y-2.5">
            {report.strengths.map((p) => (
              <PatternCard key={p.tag} pattern={p} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function TrainingPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const players = await apiGet<{ players: PlayerSummary[] }>("/api/players");
      const stored = readActivePlayer();
      const player = players.players.find((p) => p.id === stored) ?? players.players[0];
      if (!player) {
        setError("등록된 선수가 없습니다. 대시보드에서 먼저 등록해 주세요.");
        return;
      }
      setData(await apiGet<DashboardResponse>(`/api/dashboard?playerId=${player.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "훈련 가이드를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="훈련 가이드를 계산하는 중" />;

  const { curriculum } = data;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">훈련 가이드</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          분석 {curriculum.analyzedGames}판을 오프닝·전술·전략·엔드게임 관점으로 나눠
          보여줍니다. 모든 항목에는 근거 게임이 붙습니다.
        </p>
      </header>

      {curriculum.observing ? (
        <div className="rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-ink-soft">
          <strong className="font-semibold text-gold">관찰 중</strong> · 분석된 게임이{" "}
          {curriculum.analyzedGames}판이라 관점별 진단을 아직 하지 않습니다.{" "}
          {curriculum.minSample}판을 채우면 시작합니다.{" "}
          <Link href="/games" className="text-accent hover:underline">
            게임 분석하러 가기
          </Link>
        </div>
      ) : (
        curriculum.priority && (
          <div className="rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-ink-soft">
            <strong className="font-semibold">
              이번 주는 {curriculum.priority.label}에 시간을 쓰세요.
            </strong>{" "}
            {curriculum.priority.reason}
          </div>
        )
      )}

      {curriculum.reports.length === 0 ? (
        <Empty>표시할 관점이 없습니다.</Empty>
      ) : (
        curriculum.reports.map((report) => (
          <PerspectiveSection
            key={report.perspective}
            report={report}
            isPriority={curriculum.priority?.perspective === report.perspective}
          />
        ))
      )}

      <p className="text-xs text-ink-faint">
        구간별 정확도 요약은{" "}
        <Link href="/dashboard" className="text-accent hover:underline">
          대시보드
        </Link>
        에도 있습니다.
      </p>
    </div>
  );
}
