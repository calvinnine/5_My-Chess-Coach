"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TIME_CLASS_LABEL } from "./ui";

const COLORS: Record<string, string> = {
  rapid: "var(--color-ink-soft)",
  blitz: "var(--color-accent)",
  bullet: "var(--color-gold)",
  daily: "var(--color-ink-faint)",
};

export default function RatingTrend({
  history,
}: {
  history: Array<{ timeClass: string; points: Array<{ at: number; rating: number }> }>;
}) {
  const usable = history.filter((h) => h.points.length >= 2);
  if (usable.length === 0) {
    return (
      <p className="rounded-lg bg-surface-sunken px-3 py-4 text-center text-xs text-ink-faint">
        추세를 그리려면 서로 다른 시점의 레이팅이 최소 2회 기록되어야 합니다. 동기화를 반복하면
        쌓입니다.
      </p>
    );
  }

  const merged = new Map<number, Record<string, number>>();
  for (const series of usable) {
    for (const point of series.points) {
      const row = merged.get(point.at) ?? { at: point.at };
      row[series.timeClass] = point.rating;
      merged.set(point.at, row);
    }
  }
  const data = [...merged.values()].sort((a, b) => a.at - b.at);

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="at"
            tick={{ fontSize: 10 }}
            stroke="var(--color-line-strong)"
            tickFormatter={(v: number) =>
              new Date(v * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })
            }
          />
          <YAxis
            domain={["dataMin - 30", "dataMax + 30"]}
            tick={{ fontSize: 10 }}
            width={34}
            stroke="var(--color-line-strong)"
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--color-line)", fontSize: 12 }}
            labelFormatter={((v: number) =>
              new Date(v * 1000).toLocaleDateString("ko-KR")) as never}
            formatter={((value: number, name: string) => [
              value,
              TIME_CLASS_LABEL[name] ?? name,
            ]) as never}
          />
          {usable.map((series) => (
            <Line
              key={series.timeClass}
              type="monotone"
              dataKey={series.timeClass}
              stroke={COLORS[series.timeClass] ?? "var(--color-ink-soft)"}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
