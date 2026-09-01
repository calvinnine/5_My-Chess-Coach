import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "개인 체스 코치",
  description: "Chess.com 게임을 수집하고 Stockfish로 분석해 한국어로 코칭하는 로컬 앱",
};

const NAV = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/games", label: "게임" },
  { href: "/training", label: "훈련" },
  { href: "/settings", label: "설정" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-paper text-ink">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
            <Link href="/dashboard" className="text-[15px] font-semibold tracking-tight">
              개인 체스 코치
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2.5 py-1.5 text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-xs text-ink-faint">로컬 전용 · 단일 사용자</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 text-xs text-ink-faint">
          게임 기록과 분석 결과는 이 Mac의 SQLite 파일에만 저장됩니다.
        </footer>
      </body>
    </html>
  );
}
