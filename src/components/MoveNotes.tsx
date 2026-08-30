"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client-api";
import { Button, Card, ErrorNote } from "./ui";

/**
 * The user's own account of the game. This is the one input the engine cannot
 * produce, and the coaching layer treats it as evidence about intent.
 */
export default function MoveNotes({
  gameId,
  reflectionQuestion,
  initialThoughts,
  initialPostmortem,
}: {
  gameId: number;
  reflectionQuestion: string | null;
  initialThoughts: string;
  initialPostmortem: string;
}) {
  const [thoughts, setThoughts] = useState(initialThoughts);
  const [postmortem, setPostmortem] = useState(initialPostmortem);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await apiSend(`/api/games/${gameId}/notes`, "PUT", {
        userThoughts: thoughts,
        userPostmortem: postmortem,
      });
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "메모를 저장하지 못했습니다.");
    }
  }

  return (
    <Card title="복기 메모" hint="여기 적은 내용은 이 Mac에만 저장됩니다.">
      {reflectionQuestion && (
        <p className="mb-3 rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm text-ink-soft">
          {reflectionQuestion}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-faint">당시 생각</span>
          <textarea
            value={thoughts}
            onChange={(e) => setThoughts(e.target.value)}
            rows={5}
            placeholder="이 게임을 두면서 어떤 계획이었고 무엇이 헷갈렸는지"
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-faint">복기 메모</span>
          <textarea
            value={postmortem}
            onChange={(e) => setPostmortem(e.target.value)}
            rows={5}
            placeholder="분석을 보고 나서 새로 알게 된 것"
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {state === "saving" ? "저장 중…" : "메모 저장"}
        </Button>
        {state === "saved" && <span className="text-xs text-win">저장했습니다.</span>}
      </div>
    </Card>
  );
}
