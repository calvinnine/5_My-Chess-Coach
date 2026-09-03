"use client";

import { useState } from "react";
import { apiGet, apiSend } from "@/lib/client-api";
import { Button, Card, ErrorNote, Spinner } from "./ui";

interface SessionInfo {
  player: { playerId: number } | null;
}

interface Challenge {
  username: string;
  code: string;
  expiresAt: number;
  instructions: string[];
}

/**
 * Proving a Chess.com account is yours, without a password.
 *
 * The app hands out a code, you put it in a profile field only you can edit,
 * and the server reads it back through the public API. This app never asks for
 * a Chess.com password and has no way to use one.
 */
export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function requestCode() {
    setError(null);
    setBusy("확인 코드를 만드는 중");
    try {
      setChallenge(await apiSend<Challenge>("/api/auth/challenge", "POST", { username }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "코드를 발급하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!challenge) return;
    setError(null);
    setBusy("Chess.com 프로필을 확인하는 중");
    try {
      await apiSend("/api/auth/verify", "POST", { username: challenge.username });
      /*
       * Verifying and being signed in are not the same thing: the server can
       * accept the proof and the browser still refuse the cookie. Without this
       * check that lands as a click that does nothing, with no way to tell it
       * apart from a failure.
       */
      const session = await apiGet<SessionInfo>("/api/auth/session");
      if (!session.player) {
        setError(
          "확인은 되었지만 로그인 상태가 유지되지 않았습니다. 브라우저가 쿠키를 거부했을 수 있습니다 (사파리 사생활 보호 모드 등).",
        );
        return;
      }
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "확인에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">본인 확인</h1>
        <p className="mt-1 text-sm text-ink-soft">
          자기 Chess.com 계정만 분석할 수 있습니다.{" "}
          <strong className="font-medium text-ink">비밀번호는 묻지 않습니다</strong> — 프로필에
          잠깐 코드를 넣어 계정이 형 것임을 보이면 됩니다.
        </p>
      </div>

      <Card title="Chess.com 사용자명">
        <div className="flex gap-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && username.trim() && !busy) void requestCode();
            }}
            placeholder="예: calvinnine"
            autoComplete="username"
            disabled={busy !== null}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <Button onClick={() => void requestCode()} disabled={!username.trim() || busy !== null}>
            {challenge ? "코드 다시 받기" : "코드 받기"}
          </Button>
        </div>
      </Card>

      {challenge && (
        <Card title="프로필에 이 코드를 넣어 주세요">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-surface-sunken px-3 py-2.5 font-mono text-sm">
              {challenge.code}
            </code>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(challenge.code);
                setCopied(true);
              }}
            >
              {copied ? "복사됨" : "복사"}
            </Button>
          </div>

          <ol className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink-soft">
            {challenge.instructions.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="text-ink-faint">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <p className="mt-2 text-xs text-ink-faint">
            30분 안에 확인하면 됩니다. 저장이 반영되기까지 잠시 걸릴 수 있습니다.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void verify()} disabled={busy !== null}>
              확인
            </Button>
            {busy && <Spinner label={busy} />}
          </div>
        </Card>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <p className="text-xs text-ink-faint">
        공개 API(<code className="font-mono">api.chess.com/pub</code>)만 사용합니다. 비밀번호나
        API 키는 저장하지도, 요청하지도 않습니다.
      </p>
    </div>
  );
}
