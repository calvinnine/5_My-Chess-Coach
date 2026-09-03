import type { Metadata } from "next";
import Link from "next/link";
import SessionBadge from "@/components/SessionBadge";
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
            <SessionBadge />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 text-xs text-ink-faint">
          Chess.com 공개 API만 사용하며 비밀번호는 요청하지도, 저장하지도 않습니다.
        </footer>
      </body>
    </html>
  );
}
