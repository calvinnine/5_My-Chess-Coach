"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client-api";

/**
 * What someone sees before they have any reason to trust this.
 *
 * `/` used to redirect straight to the dashboard, which for a signed-out
 * visitor is the verification form — a stranger being asked for their
 * Chess.com handle with no explanation of what the site does, where the
 * analysis runs, or how long it takes. Everything stated here is checked
 * against what the app actually does.
 */
export default function LandingPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<{ player: unknown | null }>("/api/auth/session")
      .then((s) => setSignedIn(s.player !== null))
      .catch(() => setSignedIn(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-10 pb-10">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          내 체스가 어디서 무너지는지
          <br />
          내 대국으로 알아봅니다.
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Chess.com 대국을 가져와 엔진으로 분석하고, 승패를 가른 장면과{" "}
          <strong className="font-medium text-ink">여러 판에 걸쳐 반복되는 약점</strong>을
          한국어로 짚어 줍니다. 모든 지적에는 근거가 된 대국과 수가 함께 붙습니다.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            {signedIn ? "대시보드로" : "시작하기"}
          </Link>
          <span className="text-xs text-ink-faint">무료 · 비밀번호를 묻지 않습니다</span>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">어떻게 되나요</h2>
        <ol className="space-y-3 text-sm leading-relaxed text-ink-soft">
          {[
            {
              title: "본인 계정임을 확인합니다",
              body: "앱이 준 코드를 Chess.com 프로필에 잠깐 넣으면 됩니다. 확인 뒤에는 지워도 됩니다. 비밀번호는 묻지 않고, 받을 방법도 없습니다.",
            },
            {
              title: "대국을 가져옵니다",
              body: "Chess.com 공개 API로 최근 3개월치를 먼저 가져옵니다. 더 오래된 대국은 대시보드에서 기간을 골라 추가로 가져올 수 있습니다.",
            },
            {
              title: "분석하고 코칭을 봅니다",
              body: "10판이 모이면 반복 약점 진단을 시작합니다. 그전까지는 “관찰 중”이라고만 말합니다 — 표본이 적을 때 성향을 단정하지 않기 위해서입니다.",
            },
          ].map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink-soft">
                {i + 1}
              </span>
              <span>
                <strong className="font-medium text-ink">{step.title}</strong>
                <br />
                {step.body}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface px-5 py-4">
        <h2 className="text-[15px] font-semibold">분석은 이 브라우저 안에서 돌아갑니다</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          체스 엔진(Stockfish)이 <strong className="font-medium text-ink">서버가 아니라
          방문자의 브라우저에서</strong> 실행됩니다. 대국이 분석을 위해 다른 곳으로 가지
          않는다는 뜻이지만, 그만큼 시간이 걸립니다.
        </p>
        <p className="text-sm leading-relaxed text-ink-soft">
          얼마나 걸릴지는 <strong className="font-medium text-ink">직접 고르실 수
          있습니다</strong>. 아래 셋 중 하나를{" "}
          {signedIn ? (
            <Link href="/settings" className="text-accent hover:underline">
              설정 → 분석 강도
            </Link>
          ) : (
            <strong className="font-medium text-ink">설정 → 분석 강도</strong>
          )}
          에서 선택합니다. 처음에는 &quot;표준&quot;으로 시작합니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="py-1.5 pr-4 font-medium">분석 강도 (설정에서 선택)</th>
                <th className="py-1.5 pr-4 font-medium">한 판</th>
                <th className="py-1.5 font-medium">쓰임</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-4">빠름</td>
                <td className="py-1.5 pr-4">약 40초</td>
                <td className="py-1.5">표본을 빨리 채워 감을 볼 때</td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-4">표준 (기본)</td>
                <td className="py-1.5 pr-4">4~5분</td>
                <td className="py-1.5">진단을 신뢰하고 싶을 때</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-4">정밀</td>
                <td className="py-1.5 pr-4">15분 이상</td>
                <td className="py-1.5">한 판을 깊게 파고들 때</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-ink-faint">
          40수 안팎의 한 판을 실제로 측정한 값입니다. 언제든 바꿀 수 있고, 바꾼 뒤
          분석하는 판부터 적용됩니다. 분석하는 동안 창을 열어 두어야 하지만, 끝난 판은
          저장되므로 중간에 멈춰도 다시 하지 않아도 됩니다. 수백 판을 한 번에 분석하는
          용도로는 맞지 않습니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">알아 두실 것</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          {[
            <>
              <strong className="font-medium text-ink">자기 계정만 분석할 수 있습니다.</strong>{" "}
              남의 아이디를 넣어 대신 분석해 주지 않습니다.
            </>,
            <>
              <strong className="font-medium text-ink">비밀번호는 요청하지 않습니다.</strong>{" "}
              공개 API(<code className="font-mono text-xs">api.chess.com/pub</code>)만 씁니다.
            </>,
            <>
              <strong className="font-medium text-ink">언제든 전부 지울 수 있습니다.</strong>{" "}
              설정에서 계정을 삭제하면 대국·분석·메모가 함께 사라집니다. 지우기 전에 PGN과
              분석 결과를 내려받을 수 있습니다.
            </>,
            <>
              <strong className="font-medium text-ink">표본이 적으면 단정하지 않습니다.</strong>{" "}
              분석 10판 미만에서는 약점을 확정하지 않고 “관찰 중”으로만 표시합니다.
            </>,
          ].map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-faint">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 text-xs leading-relaxed text-ink-faint">
        <p>
          개인이 만들어 무료로 운영하는 서비스이고, Chess.com이 만들거나 보증한 것이
          아닙니다. 분석은 엔진 판단과 규칙 기반 해석이라 정답을 보장하지 않습니다 —
          그래서 모든 코칭 문장에 근거가 된 장면을 함께 보여 줍니다.
        </p>
        <p>
          <Link href="/privacy" className="hover:text-ink-soft hover:underline">
            개인정보 처리방침
          </Link>
          {" · "}
          <Link href="/terms" className="hover:text-ink-soft hover:underline">
            이용약관
          </Link>
        </p>
      </section>
    </div>
  );
}
