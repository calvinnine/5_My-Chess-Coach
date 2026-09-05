"use client";

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface EvalPoint {
  ply: number;
  moveNumber: number;
  san: string;
  /** White-positive centipawns, clamped for display. */
  cp: number;
  isPlayerMove: boolean;
  classification: string | null;
}

/**
 * Evaluation over the game, on the conventional white-positive axis, so the
 * direction reads the same whether the user played white or black. The
 * orientation note under the chart tells the user which half is theirs.
 */
export default function EvalGraph({
  points,
  activePly,
  playerColor,
  onSelect,
}: {
  points: EvalPoint[];
  activePly: number;
  playerColor: "white" | "black";
  onSelect: (ply: number) => void;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-ink-faint">
        분석 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
            onClick={(state: unknown) => {
              const payload = (state as { activePayload?: Array<{ payload?: EvalPoint }> })
                ?.activePayload?.[0]?.payload;
              if (payload) onSelect(payload.ply);
            }}
          >
            <defs>
              <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-ink-soft)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-ink-soft)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="moveNumber" tick={{ fontSize: 10 }} stroke="var(--color-line-strong)" />
            <YAxis
              domain={[-800, 800]}
              ticks={[-800, -400, 0, 400, 800]}
              tickFormatter={(v: number) => (v / 100).toFixed(0)}
              tick={{ fontSize: 10 }}
              width={28}
              stroke="var(--color-line-strong)"
            />
            <ReferenceLine y={0} stroke="var(--color-line-strong)" />
            <ReferenceLine x={points.find((p) => p.ply === activePly)?.moveNumber} stroke="var(--color-gold)" />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--color-line)",
                fontSize: 12,
              }}
              labelFormatter={(label: unknown) => `${label}수`}
              formatter={((value: number, _name: unknown, item: { payload?: EvalPoint }) => [
                `${(value / 100).toFixed(2)} (백 기준)`,
                item?.payload?.san ?? "",
              ]) as never}
            />
            <Area
              type="monotone"
              dataKey="cp"
              stroke="var(--color-ink-soft)"
              strokeWidth={1.5}
              fill="url(#evalFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        위쪽이 백에게 유리한 방향입니다. 나는 이 게임에서{" "}
        {playerColor === "white" ? "백" : "흑"}이므로{" "}
        {playerColor === "white" ? "위로" : "아래로"} 갈수록 나에게 좋습니다.
      </p>
    </div>
  );
}
