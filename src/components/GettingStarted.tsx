"use client";

import { useRef, useState } from "react";
import { ApiError, apiGet, apiSend } from "@/lib/client-api";
import { Button, Card, ErrorNote } from "./ui";

/** Enough for the first diagnosis; matches MIN_SAMPLE_GAMES on the server. */
const TARGET_GAMES = 10;

interface Props {
  username: string;
  /** Games already stored, analysed or not. */
  totalGames: number;
  pendingGames: number;
  onDone: () => void;
}

/**
 * What a new visitor sees instead of an empty dashboard.
 *
 * The dashboard is built for someone with hundreds of games; with none it is
 * a dozen sections all saying "아직 없습니다", and the one thing to do next is
 * buried at the bottom. This asks for one action at a time instead.
 */
export default function GettingStarted({ username, totalGames, pendingGames, onDone }: Props) {
  const [busy, setBusy] = useState<"sync" | "analyze" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );
  const abort = useRef<AbortController | null>(null);

  async function syncGames() {
    setError(null);
    setNote(null);
    setBusy("sync");
    try {
      const summary = await apiSend<{ inserted: number; duplicates: number }>(
        "/api/sync",
        "POST",
        { username },
      );
      setNote(
        summary.inserted > 0
          ? `${summary.inserted}판을 가져왔습니다.`
          : "새로 가져올 게임이 없습니다. Chess.com에서 몇 판 두고 오시면 됩니다.",
      );
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setNote(err.message);
      else setError(err instanceof Error ? err.message : "게임을 가져오지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function analyzeGames() {
    setError(null);
    setNote(null);
    setBusy("analyze");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const { analyzeGamesInBrowser } = await import("@/lib/analysis/browser-batch");
      const { browserEngineSupported, loadAnalysisPreset } = await import(
        "@/lib/analysis/browser"
      );
      if (!browserEngineSupported()) {
        throw new Error("이 브라우저에서는 분석 엔진을 실행할 수 없습니다.");
      }

      const list = await apiGet<{ games: Array<{ id: number; analysisStatus: string }> }>(
        `/api/games?analysis=unanalyzed&opponent=human&limit=${TARGET_GAMES}`,
      );
      const ids = list.games.map((g) => g.id);
      if (ids.length === 0) {
        setNote("분석할 게임이 없습니다.");
        return;
      }

      const result = await analyzeGamesInBrowser(ids, {
        preset: await loadAnalysisPreset(),
        signal: controller.signal,
        onProgress: (p) =>
          setProgress({
            done: p.done,
            total: p.total,
            label: p.currentLabel ?? "",
          }),
      });
      setNote(
        result.cancelled
          ? `중단했습니다. ${result.analyzed}판은 분석이 끝나 저장됐습니다.`
          : `${result.analyzed}판을 분석했습니다.` +
              (result.failed > 0 ? ` ${result.failed}판은 실패해 건너뛰었습니다.` : ""),
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setBusy(null);
      setProgress(null);
      abort.current = null;
    }
  }

  const hasGames = totalGames > 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">시작하기</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          {username}님의 대국을 가져와 분석하면 반복되는 약점과 연습 방향을 보여드립니다.
          분석 {TARGET_GAMES}판이 모이면 진단을 시작합니다.
        </p>
      </header>

      <Card
        title="1. 대국 가져오기"
        action={hasGames ? <span className="text-xs text-win">완료</span> : undefined}
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {hasGames
            ? `${totalGames}판을 가지고 있습니다. 더 필요하면 다시 가져올 수 있습니다.`
            : "Chess.com 공개 API로 최근 3개월 대국을 가져옵니다."}
        </p>
        <div className="mt-3">
          <Button
            variant={hasGames ? "secondary" : "primary"}
            onClick={() => void syncGames()}
            disabled={busy !== null}
          >
            {busy === "sync" ? "가져오는 중…" : hasGames ? "다시 가져오기" : "대국 가져오기"}
          </Button>
        </div>
      </Card>

      <Card title="2. 분석하기">
        <p className="text-sm leading-relaxed text-ink-soft">
          체스 엔진이 <strong className="font-medium text-ink">이 브라우저 안에서</strong>{" "}
          돌아갑니다. 대국 기록이 분석을 위해 다른 곳으로 가지 않고, 창을 열어두셔야 진행됩니다.
          기본 설정(표준)에서 <strong className="font-medium text-ink">한 판에 4~5분</strong>{" "}
          걸리니 10판이면 시간이 꽤 듭니다. 설정에서 분석 강도를 &quot;빠름&quot;으로 바꾸면
          한 판 40초 정도로 줄어듭니다.
        </p>

        {progress && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-ink-faint">
              <span>
                {progress.done} / {progress.total}판 {progress.label && `· ${progress.label}`}
              </span>
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="hover:text-ink hover:underline"
              >
                중단
              </button>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button
            onClick={() => void analyzeGames()}
            disabled={busy !== null || pendingGames === 0}
          >
            {busy === "analyze"
              ? "분석 중…"
              : pendingGames === 0
                ? "분석할 게임 없음"
                : `미분석 ${Math.min(pendingGames, TARGET_GAMES)}판 분석`}
          </Button>
          {pendingGames === 0 && hasGames && (
            <p className="mt-2 text-xs text-ink-faint">분석할 게임이 남아 있지 않습니다.</p>
          )}
        </div>
      </Card>

      {note && (
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
          {note}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
