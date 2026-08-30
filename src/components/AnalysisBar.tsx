"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client-api";
import type { AnalysisStatusResponse } from "@/types/api";
import { Button, ErrorNote } from "./ui";

/**
 * Live progress for the batch analyser. Polls only while a job is running so an
 * idle app makes no requests.
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
  const wasRunning = useRef(false);

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

  const job = status?.job;
  const pending = status?.queue?.pending ?? 0;

  async function start() {
    setError(null);
    try {
      await apiSend("/api/analyze-batch", "POST", { playerId: playerId ?? undefined, limit: 10 });
      wasRunning.current = true;
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석을 시작하지 못했습니다.");
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
          <Button size="sm" onClick={() => void start()} disabled={pending === 0}>
            미분석 10판 분석
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
