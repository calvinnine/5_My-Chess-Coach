"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client-api";
import type { AnalysisStatusResponse } from "@/types/api";
import { Button, ErrorNote } from "./ui";

interface LocalRun {
  done: number;
  total: number;
  label: string;
}

/**
 * Live progress for the batch analyser.
 *
 * Two ways to run: a server-side job when a Stockfish binary exists, and this
 * browser otherwise. A deployment has no binary, so without the second the
 * button here would answer "Stockfish 실행 파일을 찾지 못했습니다" — true of the
 * server, and useless to someone using the website.
 */
export default function AnalysisBar({
  playerId,
  onFinished,
}: {
  playerId: number | null;
  onFinished?: () => void;
}) {
  const [status, setStatus] = useState<AnalysisStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** null until known; false means the analysis has to run in this browser. */
  const [serverEngine, setServerEngine] = useState<boolean | null>(null);
  const [localRun, setLocalRun] = useState<LocalRun | null>(null);
  const wasRunning = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiGet<AnalysisStatusResponse>("/api/analysis/status");
      setStatus(next);
      if (wasRunning.current && !next.job.running) onFinished?.();
      wasRunning.current = next.job.running;
    } catch {
      /* transient; keep the last known state */
    }
  }, [onFinished]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (wasRunning.current) void refresh();
    }, 1200);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    apiGet<{ engine: { found: boolean } }>("/api/health")
      .then((res) => setServerEngine(res.engine.found))
      .catch(() => setServerEngine(false));
  }, []);

  const job = status?.job;
  const pending = status?.queue?.pending ?? 0;

  async function start() {
    setError(null);
    if (serverEngine) {
      try {
        await apiSend("/api/analyze-batch", "POST", {
          playerId: playerId ?? undefined,
          limit: 10,
        });
        wasRunning.current = true;
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "분석을 시작하지 못했습니다.");
      }
      return;
    }
    await startHere();
  }

  /** Runs the engine in this browser and uploads each result as it finishes. */
  async function startHere() {
    const controller = new AbortController();
    abort.current = controller;
    setLocalRun({ done: 0, total: 0, label: "" });
    try {
      const { analyzeGamesInBrowser } = await import("@/lib/analysis/browser-batch");
      const { browserEngineSupported } = await import("@/lib/analysis/browser");
      if (!browserEngineSupported()) {
        throw new Error("이 브라우저에서는 분석 엔진을 실행할 수 없습니다.");
      }

      const list = await apiGet<{ games: Array<{ id: number }> }>(
        "/api/games?analysis=unanalyzed&opponent=human&limit=10",
      );
      const ids = list.games.map((g) => g.id);
      if (ids.length === 0) return;

      const result = await analyzeGamesInBrowser(ids, {
        signal: controller.signal,
        onProgress: (p) =>
          setLocalRun({ done: p.done, total: p.total, label: p.currentLabel ?? "" }),
      });
      if (result.failed > 0) {
        setError(`${result.failed}판은 분석에 실패해 건너뛰었습니다.`);
      }
      onFinished?.();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setLocalRun(null);
      abort.current = null;
    }
  }

  async function cancel() {
    try {
      await apiSend("/api/analysis/cancel", "POST");
      void refresh();
    } catch {
      /* ignore */
    }
  }

  if (!job) return null;

  if (localRun) {
    const localPercent = Math.round((localRun.done / Math.max(1, localRun.total)) * 100);
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            이 브라우저에서 분석 중 · {localRun.done}/{localRun.total}판
            {localRun.label && ` (${localRun.label})`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>
            중지
          </Button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-gold transition-[width]"
            style={{ width: `${localPercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          창을 닫으면 중단됩니다. 끝난 판은 저장되어 있습니다.
        </p>
      </div>
    );
  }

  const percent =
    job.positionsTotal > 0 ? Math.round((job.positionsDone / job.positionsTotal) * 100) : 0;

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      {job.running ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              분석 중 · {job.completed + 1}/{job.total}판
              {job.currentGameLabel ? ` (${job.currentGameLabel})` : ""}
              {job.stage === "key-moments" ? " · 핵심 장면 재분석" : ""}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void cancel()}>
              {job.cancelRequested ? "중지 중…" : "중지"}
            </Button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-gold transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-[11px] text-ink-faint">
            {job.positionsDone}/{job.positionsTotal} 포지션 · {job.engineVersion ?? "엔진 확인 중"}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-soft">
            {pending > 0
              ? `미분석 게임 ${pending}판이 대기 중입니다.`
              : "대기 중인 미분석 게임이 없습니다."}
            {job.failed > 0 ? ` 직전 작업에서 ${job.failed}판이 실패했습니다.` : ""}
          </p>
          <Button
            size="sm"
            onClick={() => void start()}
            disabled={pending === 0 || serverEngine === null}
          >
            {serverEngine === false ? "이 브라우저에서 10판 분석" : "미분석 10판 분석"}
          </Button>
        </div>
      )}
      {job.lastError && !job.running && (
        <p className="mt-2 text-xs text-loss">마지막 오류: {job.lastError}</p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}
