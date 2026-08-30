"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import EvalGraph, { type EvalPoint } from "@/components/EvalGraph";
import MoveNotes from "@/components/MoveNotes";
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
  formatClock,
  formatDateTime,
} from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import type { GameDetailResponse, MoveRow } from "@/types/api";

// The board pulls in DOM-only libraries; keep it out of the server render.
const ReviewBoard = dynamic(() => import("@/components/ReviewBoard"), {
  ssr: false,
  loading: () => <div className="aspect-square w-full rounded-[10px] bg-surface-sunken" />,
});

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const GRADE_LABEL: Record<string, string> = {
  best: "최상",
  good: "양호",
  inaccuracy: "부정확",
  mistake: "실수",
  blunder: "중대 실수",
};

const GRADE_TONE: Record<string, "neutral" | "gold" | "loss" | "accent"> = {
  best: "neutral",
  good: "neutral",
  inaccuracy: "accent",
  mistake: "gold",
  blunder: "loss",
};

export default function GameReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [data, setData] = useState<GameDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const initialPlyApplied = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<GameDetailResponse>(`/api/games/${id}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임을 불러오지 못했습니다.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep links from evidence lists land on the exact ply.
  useEffect(() => {
    if (initialPlyApplied.current || !data) return;
    const requested = Number(searchParams.get("ply"));
    if (Number.isFinite(requested) && requested > 0) setPly(requested);
    initialPlyApplied.current = true;
  }, [data, searchParams]);

  // Memoised so the array identity is stable across renders; `evalPoints`
  // depends on it.
  const moves = useMemo(() => data?.moves ?? [], [data]);
  const playerColor = data?.game.playerColor ?? "white";

  const currentMove: MoveRow | null = ply > 0 ? moves[ply - 1] ?? null : null;
  // An unanalysed game has no stored plies, so fall back to the initial
  // position. The board needs a real FEN here, not the word "start".
  const fen = currentMove?.fenAfter ?? moves[0]?.fenBefore ?? START_FEN;

  const evalPoints = useMemo<EvalPoint[]>(
    () =>
      moves
        .filter((m) => m.evalAfterWhiteCp !== null || m.evalAfterWhiteMate !== null)
        .map((m) => ({
          ply: m.ply,
          moveNumber: m.moveNumber,
          san: m.san,
          cp:
            m.evalAfterWhiteMate !== null
              ? m.evalAfterWhiteMate > 0
                ? 800
                : -800
              : Math.max(-800, Math.min(800, m.evalAfterWhiteCp ?? 0)),
          isPlayerMove: m.isPlayerMove,
          classification: m.classification,
        })),
    [moves],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(moves.length, p + 1));
      if (e.key === "Home") setPly(0);
      if (e.key === "End") setPly(moves.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves.length]);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      await apiSend(`/api/games/${id}/analyze`, "POST");
      // Poll until the single-game job finishes.
      const timer = setInterval(async () => {
        const status = await apiGet<{ job: { running: boolean } }>("/api/analysis/status");
        if (!status.job.running) {
          clearInterval(timer);
          setAnalyzing(false);
          void load();
        }
      }, 1500);
    } catch (err) {
      setAnalyzing(false);
      setError(err instanceof Error ? err.message : "분석을 시작하지 못했습니다.");
    }
  }

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="게임을 불러오는 중" />;

  const { game, review } = data;
  const arrows =
    currentMove && currentMove.bestMoveUci && currentMove.isPlayerMove
      ? [
          {
            from: currentMove.uci.slice(0, 2),
            to: currentMove.uci.slice(2, 4),
            tone: "actual" as const,
          },
          ...(currentMove.bestMoveUci !== currentMove.uci
            ? [
                {
                  from: currentMove.bestMoveUci.slice(0, 2),
                  to: currentMove.bestMoveUci.slice(2, 4),
                  tone: "best" as const,
                },
              ]
            : []),
        ]
      : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RESULT_TONE[game.result]}>{RESULT_LABEL[game.result]}</Badge>
            <h1 className="text-xl font-semibold tracking-tight">vs {game.opponentUsername}</h1>
            <span className="text-sm text-ink-faint">
              {game.playerColor === "white" ? "백" : "흑"} ·{" "}
              {TIME_CLASS_LABEL[game.timeClass] ?? game.timeClass} · {formatDateTime(game.playedAt)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {game.openingName ?? "오프닝 미상"}
            {game.ecoCode ? ` (${game.ecoCode})` : ""} · {game.termination ?? "종료 사유 미상"}
            {game.playerRating && game.opponentRating
              ? ` · ${game.playerRating} vs ${game.opponentRating}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={game.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ink-faint hover:underline"
          >
            Chess.com에서 보기
          </a>
          {game.analysisStatus !== "completed" && game.opponentKind === "human" && (
            <Button onClick={() => void analyze()} disabled={analyzing || game.rules !== "chess"}>
              {analyzing ? "분석 중…" : "이 게임 분석"}
            </Button>
          )}
        </div>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {game.opponentKind !== "human" && (
        <p className="rounded-lg bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-soft">
          {game.opponentKind === "coach" ? "코치" : "봇"}와 둔 연습 게임입니다. 기록은 보관하지만
          분석과 누적 통계에서는 제외합니다.
        </p>
      )}
      {game.parseError &&
        (game.analysisStatus === "skipped" ? (
          <p className="rounded-lg bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-soft">
            {game.parseError} 분석할 수가 없어 건너뛰었고, 원본 PGN은 그대로 보관되어 있습니다.
          </p>
        ) : (
          <ErrorNote>
            이 게임의 PGN을 해석하지 못했습니다({game.parseError}). 원본 PGN은 그대로 보관되어
            있습니다.
          </ErrorNote>
        ))}

      {review?.overallSummary && (
        <Card className="prose-coach border-gold/25 bg-gold-soft/40">
          <p className="text-[15px] font-medium leading-relaxed">{review.overallSummary}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-3">
          <ReviewBoard
            fen={fen}
            orientation={playerColor}
            arrows={arrows}
            highlight={
              currentMove ? [currentMove.uci.slice(0, 2), currentMove.uci.slice(2, 4)] : []
            }
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setPly(0)} disabled={ply === 0}>
                처음
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPly((p) => Math.max(0, p - 1))}
                disabled={ply === 0}
              >
                ←
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPly((p) => Math.min(moves.length, p + 1))}
                disabled={ply >= moves.length}
              >
                →
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPly(moves.length)}
                disabled={ply >= moves.length}
              >
                끝
              </Button>
            </div>
            <span className="text-xs text-ink-faint">
              {ply === 0 ? "시작 위치" : `${ply}번째 수 / 전체 ${moves.length}수`}
            </span>
          </div>

          <Card title="현재 장면">
            {currentMove ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base">
                    {currentMove.moveNumber}
                    {currentMove.color === "white" ? "." : "..."} {currentMove.san}
                  </span>
                  {currentMove.isPlayerMove && currentMove.classification && (
                    <Badge tone={GRADE_TONE[currentMove.classification] ?? "neutral"}>
                      {GRADE_LABEL[currentMove.classification] ?? currentMove.classification}
                    </Badge>
                  )}
                  {!currentMove.isPlayerMove && <Badge tone="neutral">상대 수</Badge>}
                  {currentMove.clockMs !== null && (
                    <span className="text-xs text-ink-faint">
                      남은 시간 {formatClock(currentMove.clockMs)}
                    </span>
                  )}
                </div>
                <p className="text-ink-soft">
                  평가 {currentMove.evalBeforeText} → {currentMove.evalAfterText}
                  {currentMove.isPlayerMove && currentMove.centipawnLoss !== null
                    ? ` · 평가 손실 ${currentMove.centipawnLoss}cp`
                    : ""}
                </p>
                {currentMove.isPlayerMove && currentMove.bestMoveSan && (
                  <p className="text-ink-soft">
                    엔진 추천: <span className="font-mono">{currentMove.bestMoveSan}</span>
                    {currentMove.bestLine ? (
                      <span className="text-ink-faint"> ({currentMove.bestLine})</span>
                    ) : null}
                  </p>
                )}
                {(currentMove.themes.themes?.length ?? 0) > 0 && (
                  <ul className="space-y-1 border-t border-line pt-2 text-ink-soft">
                    {currentMove.themes.themes!.map((t) => (
                      <li key={t.tag}>· {t.detail}</li>
                    ))}
                  </ul>
                )}
                {(currentMove.themes.strengths?.length ?? 0) > 0 && (
                  <ul className="space-y-1 border-t border-line pt-2 text-win">
                    {currentMove.themes.strengths!.map((t) => (
                      <li key={t.tag}>· {t.detail}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">
                시작 위치입니다. → 키나 수순을 눌러 이동하세요.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="평가 그래프" hint="점을 클릭하면 해당 수로 이동합니다.">
            <EvalGraph
              points={evalPoints}
              activePly={ply}
              playerColor={playerColor}
              onSelect={setPly}
            />
          </Card>

          <Card title="수순" className="max-h-[320px] overflow-y-auto">
            {moves.length === 0 ? (
              <Empty>아직 분석하지 않은 게임입니다.</Empty>
            ) : (
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-0.5 text-sm">
                {Array.from({ length: Math.ceil(moves.length / 2) }, (_, row) => {
                  const white = moves[row * 2];
                  const black = moves[row * 2 + 1];
                  return (
                    <div key={row} className="contents">
                      <span className="py-0.5 text-right font-mono text-xs text-ink-faint">
                        {row + 1}.
                      </span>
                      {[white, black].map((m, i) =>
                        m ? (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPly(m.ply)}
                            className={`rounded px-1.5 py-0.5 text-left font-mono transition-colors ${
                              ply === m.ply
                                ? "bg-ink text-paper"
                                : m.isPlayerMove && m.classification === "blunder"
                                  ? "text-loss hover:bg-surface-sunken"
                                  : m.isPlayerMove && m.classification === "mistake"
                                    ? "text-gold hover:bg-surface-sunken"
                                    : "hover:bg-surface-sunken"
                            }`}
                          >
                            {m.san}
                          </button>
                        ) : (
                          <span key={i} />
                        ),
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {review && (
            <Card title="구간별 요약">
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ["오프닝", review.openingSummary],
                    ["미들게임", review.middlegameSummary],
                    ["엔드게임", review.endgameSummary],
                    ["시간 사용", review.timeSummary],
                  ] as const
                ).map(([label, text]) =>
                  text ? (
                    <div key={label}>
                      <dt className="text-[11px] text-ink-faint">{label}</dt>
                      <dd className="leading-relaxed text-ink-soft">{text}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </Card>
          )}
        </div>
      </div>

      {review && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="승패를 가른 장면" hint="최대 3개 · 이미 결과가 정해진 뒤의 실수는 제외합니다.">
            {review.turningPoints.length === 0 ? (
              <Empty>결정적 전환점이라 부를 만한 장면이 없습니다.</Empty>
            ) : (
              <ol className="space-y-2.5">
                {review.turningPoints.map((tp, i) => (
                  <li key={tp.ply}>
                    <button
                      type="button"
                      onClick={() => setPly(tp.ply)}
                      className="w-full rounded-lg border border-gold/30 bg-gold-soft/50 px-3.5 py-3 text-left transition-colors hover:bg-gold-soft"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {i + 1}. {tp.moveNumber}
                          {tp.color === "white" ? "." : "..."} {tp.san}
                        </span>
                        {tp.bestMoveSan && (
                          <span className="font-mono text-xs text-ink-faint">
                            추천 {tp.bestMoveSan}
                          </span>
                        )}
                        <Badge tone={GRADE_TONE[tp.classification] ?? "gold"}>
                          {GRADE_LABEL[tp.classification] ?? tp.classification}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{tp.explanation}</p>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="잘한 점">
            {review.strengths.length === 0 ? (
              <Empty>이번 게임에서 강조할 만한 장면이 집계되지 않았습니다.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {review.strengths.map((s) => (
                  <li key={s.ply}>
                    <button
                      type="button"
                      onClick={() => setPly(s.ply)}
                      className="w-full rounded-lg border border-win/25 bg-win-soft/60 px-3.5 py-3 text-left transition-colors hover:bg-win-soft"
                    >
                      <p className="text-sm leading-relaxed text-ink-soft">{s.explanation}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {review && review.checklist.length > 0 && (
        <Card title="다음 게임 체크포인트">
          <ul className="space-y-1.5 text-sm text-ink-soft">
            {review.checklist.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </Card>
      )}

      <MoveNotes
        gameId={game.id}
        reflectionQuestion={review?.reflectionQuestion ?? null}
        initialThoughts={review?.userThoughts ?? ""}
        initialPostmortem={review?.userPostmortem ?? ""}
      />

      <div className="text-xs text-ink-faint">
        {game.analysisVersion ? `분석 설정: ${game.analysisVersion}` : "아직 분석되지 않았습니다."}
        {" · "}
        <Link href="/games" className="text-accent hover:underline">
          게임 목록으로
        </Link>
      </div>
    </div>
  );
}
