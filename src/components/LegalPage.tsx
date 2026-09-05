import type { ReactNode } from "react";

/** Shared shell for the policy pages, so both read as one document. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-xs text-ink-faint">최종 수정 {updated}</p>
      </header>
      {children}
    </article>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-semibold">{heading}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-ink-faint">·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
