"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/client-api";
import type { Puzzle, PuzzleAttemptResult, PuzzleProgress } from "@/types/api";
import { Badge, Button, Empty, ErrorNote, Spinner, formatDate } from "./ui";

const PuzzleBoard = dynamic(() => import("./PuzzleBoard"), {
  ssr: false,
  loading: () => <div className="aspect-square w-full rounded-[10px] bg-surface-sunken" />,
});

/**
 * Practice on positions the player got wrong in their own games.
 *
 * The answer is never sent to the browser before an attempt: the solution comes
 * back from the server as part of grading, so the page cannot be read for it.
 */
export default function PuzzleTrainer({
  playerId,
  tag,
  label,
  onClose,
}: {
  playerId: number;
  tag: string;
  label: string;
  onClose: () => void;
}) {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [progress, setProgress] = useState<PuzzleProgress | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<PuzzleAttemptResult | null>(null);
  const [attemptSan, setAttemptSan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ puzzles: Puzzle[]; progress: PuzzleProgress }>(
        `/api/puzzles?playerId=${playerId}&tag=${encodeURIComponent(tag)}&limit=10`,
      );
      setPuzzles(res.puzzles);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제를 불러오지 못했습니다.");
    }
  }, [playerId, tag]);

  useEffect(() => {
    void load();
  }, [load]);

  const puzzle = puzzles?.[index] ?? null;

  async function submit(uci: string, san: string) {
    if (!puzzle || result || busy) return;
    setBusy(true);
    setAttemptSan(san);
    try {
      const res = await apiSend<PuzzleAttemptResult>("/api/puzzles", "POST", {
        playerId,
        puzzleId: puzzle.id,
        tag,
        attemptUci: uci,
      });
      setResult(res);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "채점에 실패했습니다.");
      setAttemptSan(null);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setResult(null);
    setAttemptSan(null);
    setIndex((i) => i + 1);
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!puzzles) return <Spinner label="문제를 준비하는 중" />;

  if (puzzles.length === 0) {
    return (
      <Empty>
        {label} 주제로 만들 수 있는 문제가 없습니다. 답이 하나로 분명한 장면만 문제로
        씁니다.
      </Empty>
    );
  }

  if (!puzzle) {
    return (
      <div className="rounded-lg border border-win/25 bg-win-soft/60 px-4 py-5 text-center">
        <p className="text-sm font-medium">이번 세트 {puzzles.length}문제를 모두 풀었습니다.</p>
        {progress && (
          <p className="mt-1 text-sm text-ink-soft">
            누적 {progress.attempts}회 시도 · {progress.solved}회 정답
          </p>
        )}
        <div className="mt-3 flex justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setIndex(0);
              setResult(null);
              void load();
            }}
          >
            새 세트 받기
          </Button>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    );
  }

  const solutionArrow =
    result && result.solutionUci
      ? [
          {
            from: result.solutionUci.slice(0, 2),
            to: result.solutionUci.slice(2, 4),
            tone: "solution" as const,
          },
        ]
      : [];

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{label}</Badge>
          <span className="text-xs text-ink-faint">
            {index + 1} / {puzzles.length}
          </span>
          {progress && progress.attempts > 0 && (
            <span className="text-xs text-ink-faint">
              누적 {progress.solved}/{progress.attempts}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <PuzzleBoard
          fen={puzzle.fen}
          orientation={puzzle.orientation}
          disabled={result !== null || busy}
          arrows={solutionArrow}
          onMove={(uci, san) => void submit(uci, san)}
        />

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {puzzle.orientation === "white" ? "백" : "흑"} 차례 · {puzzle.moveNumber}수
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{puzzle.prompt}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {formatDate(puzzle.playedAt)} · vs {puzzle.opponentUsername}
            </p>
          </div>

          {!result && (
            <p className="rounded-lg bg-surface px-3.5 py-2.5 text-xs text-ink-faint">
              기물을 끌거나 두 번 눌러서 수를 두세요. 한 수만 받습니다.
            </p>
          )}

          {result && (
            <div
              className={`rounded-lg px-3.5 py-3 text-sm ${
                result.correct
                  ? "border border-win/25 bg-win-soft/70 text-ink"
                  : "border border-gold/30 bg-gold-soft/60 text-ink"
              }`}
            >
              <p className="font-medium">
                {result.correct ? "정답입니다." : `아쉽습니다 — ${attemptSan}`}
              </p>
              <p className="mt-1 leading-relaxed text-ink-soft">
                엔진 추천은 <span className="font-mono">{result.solutionSan}</span>입니다.
                {result.bestLine && (
                  <span className="text-ink-faint"> ({result.bestLine})</span>
                )}
              </p>
              <p className="mt-1 leading-relaxed text-ink-soft">
                실전에서는 <span className="font-mono">{result.playedSan}</span>을 두어
                {" "}
                {result.centipawnLoss}cp를 잃었습니다.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={next}>
                  다음 문제
                </Button>
                <Link
                  href={`/games/${result.gameId}?ply=${result.ply}`}
                  className="text-xs text-accent hover:underline"
                >
                  이 게임에서 보기
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
