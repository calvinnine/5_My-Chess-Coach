"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Spinner,
  formatDateTime,
} from "@/components/ui";
import { apiGet, apiSend, readActivePlayer } from "@/lib/client-api";
import type { EngineLocation, PlayerSummary } from "@/types/api";

interface SettingsResponse {
  settings: Record<string, string>;
  engine: EngineLocation;
  presets: Record<string, { depth: number; keyMomentDepth: number; multiPv: number }>;
}

/** `location` and `tables` are withheld on a deployment; only `remote` is always there. */
interface HealthResponse {
  database: { remote: boolean; location?: string; tables?: string[] };
}

interface BackupsResponse {
  directory: string;
  backups: Array<{ file: string; sizeBytes: number; createdAt: number }>;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [backups, setBackups] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stockfishPath, setStockfishPath] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, playerList, healthRes] = await Promise.all([
        apiGet<SettingsResponse>("/api/settings"),
        apiGet<{ players: PlayerSummary[] }>("/api/players"),
        apiGet<HealthResponse>("/api/health"),
      ]);
      /*
       * Backups are a local-only feature — a hosted deployment answers 409,
       * since a file written there disappears with the instance. Fetching it
       * alongside the rest would fail the whole screen for a section that is
       * simply not available.
       */
      const backupList = await apiGet<BackupsResponse>("/api/backup").catch(() => null);
      setData(settings);
      setPlayers(playerList.players);
      setBackups(backupList);
      setHealth(healthRes);
      setStockfishPath(settings.settings.stockfish_path ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(patch: Record<string, unknown>, successNote: string) {
    setError(null);
    try {
      const res = await apiSend<SettingsResponse>("/api/settings", "PUT", patch);
      setData((prev) => (prev ? { ...prev, ...res } : prev));
      setNote(successNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정을 저장하지 못했습니다.");
    }
  }

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Spinner label="불러오는 중" />;

  const preset = data.settings.analysis_preset ?? "standard";
  const activePlayerId = readActivePlayer();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">설정</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          모든 설정과 데이터는 이 Mac에만 저장됩니다. Chess.com 비밀번호나 API 키는 사용하지
          않습니다.
        </p>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {note && (
        <p className="rounded-lg bg-win-soft px-3.5 py-2.5 text-sm text-win">{note}</p>
      )}

      <Card title="Stockfish 엔진">
        <p className="text-sm text-ink-soft">
          {data.engine.found ? (
            <>
              <Badge tone="accent">확인됨</Badge> {data.engine.version}
              <br />
              <code className="font-mono text-xs text-ink-faint">{data.engine.path}</code>
            </>
          ) : (
            <>
              엔진을 찾지 못했습니다. Homebrew로 설치하거나 실행 파일 경로를 직접 지정하세요.
              <pre className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 font-mono text-xs">
                brew install stockfish
              </pre>
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={stockfishPath}
            onChange={(e) => setStockfishPath(e.target.value)}
            placeholder="/opt/homebrew/bin/stockfish"
            className="min-w-[280px] flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <Button
            variant="secondary"
            onClick={() => void update({ stockfishPath }, "엔진 경로를 저장했습니다.")}
          >
            경로 저장
          </Button>
        </div>
      </Card>

      <Card
        title="분석 강도"
        hint="서버에 엔진이 없으면 분석이 이 브라우저에서 돌아갑니다. 아래 시간은 40수 안팎의 한 판을 기준으로 실제로 측정한 값입니다."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(data.presets).map(([id, cfg]) => (
            <button
              key={id}
              type="button"
              onClick={() => void update({ analysisPreset: id }, `분석 강도를 ${id}로 바꿨습니다.`)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                preset === id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-sunken"
              }`}
            >
              <div className="text-sm font-medium">
                {id === "fast" ? "빠름" : id === "standard" ? "표준" : "정밀"}
              </div>
              <div className="text-[11px] text-ink-faint">
                depth {cfg.depth} · 핵심 장면 {cfg.keyMomentDepth} · MultiPV {cfg.multiPv}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-faint">
                {id === "fast"
                  ? "브라우저에서 한 판 약 40초"
                  : id === "standard"
                    ? "브라우저에서 한 판 4~5분"
                    : "브라우저에서 한 판 15분 이상"}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-faint">엔진 스레드</span>
            <input
              type="number"
              min={1}
              max={16}
              defaultValue={data.settings.engine_threads ?? "2"}
              onBlur={(e) =>
                void update({ threads: Number(e.target.value) }, "스레드 수를 저장했습니다.")
              }
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-faint">해시 (MB)</span>
            <input
              type="number"
              min={16}
              max={4096}
              step={16}
              defaultValue={data.settings.engine_hash_mb ?? "128"}
              onBlur={(e) =>
                void update({ hashMb: Number(e.target.value) }, "해시 크기를 저장했습니다.")
              }
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>
      </Card>

      <Card
        title="Chess.com 요청 연락처"
        hint="공개 API 사용 예의를 위해 User-Agent에 포함됩니다. 비워 두면 기본값이 쓰입니다."
      >
        <div className="flex flex-wrap gap-2">
          <input
            defaultValue={data.settings.contact ?? ""}
            placeholder="your-email@example.com"
            onBlur={(e) => void update({ contact: e.target.value }, "연락처를 저장했습니다.")}
            className="min-w-[280px] flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </Card>

      <Card title="등록된 선수">
        {players.length === 0 ? (
          <p className="text-sm text-ink-faint">등록된 선수가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {players.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{p.displayName}</span>
                {p.id === activePlayerId && <Badge tone="accent">활성</Badge>}
                <span className="text-ink-faint">{p.gameCount}판</span>
                <span className="ml-auto text-xs text-ink-faint">
                  {p.lastSyncedAt ? `마지막 동기화 ${formatDateTime(p.lastSyncedAt)}` : "동기화 기록 없음"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="데이터 관리"
        hint={
          health
            ? health.database.remote
              ? "데이터베이스: 호스팅"
              : `데이터베이스: ${health.database.location ?? "로컬 파일"}`
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          {backups && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const res = await apiSend<{ file: string }>("/api/backup", "POST");
                  setNote(`백업을 만들었습니다: ${res.file}`);
                  setBackups(await apiGet<BackupsResponse>("/api/backup"));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "백업에 실패했습니다.");
                }
              }}
            >
              지금 백업
            </Button>
          )}
          <a
            href={activePlayerId ? `/api/export/pgn?playerId=${activePlayerId}` : "/api/export/pgn"}
            className="rounded-lg border border-line-strong px-3.5 py-2 text-sm hover:bg-surface-sunken"
          >
            PGN 전체 내보내기
          </a>
          <a
            href={
              activePlayerId
                ? `/api/export/analysis?playerId=${activePlayerId}`
                : "/api/export/analysis"
            }
            className="rounded-lg border border-line-strong px-3.5 py-2 text-sm hover:bg-surface-sunken"
          >
            분석 결과 JSON 내보내기
          </a>
        </div>
        {backups && backups.backups.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-ink-faint">
              백업 위치: <code className="font-mono">{backups.directory}</code>
            </p>
            <ul className="mt-1.5 space-y-1 text-xs text-ink-soft">
              {backups.backups.slice(0, 5).map((b) => (
                <li key={b.file} className="flex justify-between gap-3">
                  <code className="truncate font-mono">{b.file}</code>
                  <span className="shrink-0 text-ink-faint">
                    {(b.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-faint">
              복원은 앱을 종료한 뒤 백업 파일을 데이터베이스 경로로 복사하면 됩니다.
            </p>
          </div>
        )}
      </Card>

      <Card title="계정 삭제" hint="되돌릴 수 없습니다.">
        <p className="text-sm leading-relaxed text-ink-soft">
          대국, 분석, <strong className="font-medium text-ink">복기 메모</strong>, 퍼즐 기록,
          로그인 정보가 모두 지워집니다. 복구할 수 없으니 남기고 싶은 것이 있다면 위에서
          먼저 내려받으세요. 원본 대국 기록은 Chess.com에 그대로 남습니다.
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          확인을 위해 Chess.com 사용자명을 입력해 주세요.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="사용자명"
            autoComplete="off"
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-loss"
          />
          <Button
            variant="danger"
            disabled={!deleteConfirm.trim() || deleting}
            onClick={async () => {
              setError(null);
              setDeleting(true);
              try {
                await apiSend("/api/account", "DELETE", {
                  confirmUsername: deleteConfirm.trim(),
                });
                /*
                 * A full reload, not a router push: the account and its session
                 * are gone, and every screen still holds data from it in memory.
                 */
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = "/dashboard";
              } catch (err) {
                setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
                setDeleting(false);
              }
            }}
          >
            {deleting ? "삭제 중…" : "영구 삭제"}
          </Button>
        </div>
      </Card>

      <Card title="AI 설명 계층" hint="선택 기능 · 아직 켜져 있지 않습니다.">
        <p className="text-sm leading-relaxed text-ink-soft">
          이 앱의 모든 코칭 문장은 현재 규칙 기반으로 생성되며 LLM API 키 없이 완전히 동작합니다.
          외부 모델 연동을 켜면 게임 데이터 일부가 외부로 전송되고, Claude Code 구독과는 별개로 모델
          API 비용이 발생합니다. 켜기 전에 전송 범위가 화면에 표시됩니다.
        </p>
      </Card>
    </div>
  );
}
