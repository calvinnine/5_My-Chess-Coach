"use client";

import type { ReactNode } from "react";

export function Card({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(35,34,31,0.04)] ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants = {
    primary: "bg-ink text-paper hover:bg-ink-soft",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-sunken",
    ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
    danger: "border border-loss/30 bg-loss-soft text-loss hover:bg-loss/15",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "win" | "loss" | "draw" | "gold" | "accent";
}) {
  const tones = {
    neutral: "bg-surface-sunken text-ink-soft",
    win: "bg-win-soft text-win",
    loss: "bg-loss-soft text-loss",
    draw: "bg-draw-soft text-draw",
    gold: "bg-gold-soft text-gold",
    accent: "bg-accent-soft text-accent",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2.5">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-faint">
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-loss/25 bg-loss-soft px-3.5 py-2.5 text-sm text-loss">
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-faint">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-ink-soft" />
      {label}
    </span>
  );
}

export const RESULT_TONE: Record<string, "win" | "loss" | "draw"> = {
  win: "win",
  loss: "loss",
  draw: "draw",
};

export const RESULT_LABEL: Record<string, string> = {
  win: "승",
  loss: "패",
  draw: "무",
};

export const TIME_CLASS_LABEL: Record<string, string> = {
  rapid: "래피드",
  blitz: "블리츠",
  bullet: "불릿",
  daily: "데일리",
};

export function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(ms: number | null) {
  if (ms === null) return "–";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
