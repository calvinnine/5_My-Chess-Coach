"use client";

import Link from "next/link";
import { useState } from "react";
import type { Pattern } from "@/types/api";
import { Badge } from "./ui";

const STATUS_LABEL: Record<Pattern["status"], string> = {
  confirmed: "확정",
  candidate: "후보",
  observing: "관찰 중",
};

const STATUS_TONE: Record<Pattern["status"], "gold" | "accent" | "neutral"> = {
  confirmed: "gold",
  candidate: "accent",
  observing: "neutral",
};

/** A pattern is never shown without the games that produced it. */
export default function PatternCard({ pattern }: { pattern: Pattern }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{pattern.label}</span>
        <Badge tone={STATUS_TONE[pattern.status]}>{STATUS_LABEL[pattern.status]}</Badge>
        {pattern.openingSpecific && (
          <Badge tone="neutral">{pattern.openingSpecific} 계열에서 반복</Badge>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        {pattern.description} 최근 {pattern.windowSize}판 중 {pattern.gameCount}판에서{" "}
        {pattern.occurrenceCount}회 나타났습니다.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
        <span>
          {pattern.patternType === "strength" ? "빈도" : "심각도"}{" "}
          {pattern.severityScore.toFixed(0)}
        </span>
        <span>신뢰도 {pattern.confidenceScore.toFixed(0)}%</span>
        <span>서로 다른 오프닝 {pattern.distinctOpenings}개</span>
        <span>분석 표본 {pattern.sampleSize}판</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-accent hover:underline"
        >
          {open ? "근거 접기" : `근거 ${pattern.evidence.length}장면 보기`}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {pattern.evidence.map((e, i) => (
            <li key={`${e.gameId}-${e.ply}-${i}`} className="text-xs text-ink-soft">
              <Link
                href={`/games/${e.gameId}?ply=${e.ply}`}
                className="font-mono text-accent hover:underline"
              >
                게임 #{e.gameId} · {e.moveNumber}수 {e.san}
              </Link>{" "}
              — {e.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
