"use client";

import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/error-boundary";

export function Panel({ title, children, className = "", right }: { title: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`panel corner ${className}`}>
      <div className="panel-title mb-3 justify-between">
        <span>{title}</span>
        {right}
      </div>
      <ErrorBoundary label={title}>{children}</ErrorBoundary>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "ink" }: { label: string; value: string; sub?: string; tone?: "ink" | "good" | "bad" | "accent" | "gold" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "accent" ? "text-cyan-300" : tone === "gold" ? "text-amber-300" : "text-slate-100";
  return (
    <div className="panel corner">
      <p className="k mb-1">{label}</p>
      <p className={`num text-xl ${color}`}>{value}</p>
      {sub && <p className="mono text-[10px] mt-1 text-slate-500">{sub}</p>}
    </div>
  );
}

export function Badge({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Meter({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "good" | "warn" | "bad" | "gold" }) {
  const bg = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : tone === "gold" ? "var(--gold)" : "var(--accent)";
  return (
    <div className="meter">
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: bg, boxShadow: `0 0 8px ${bg}` }} />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="mono text-[11px] italic" style={{ color: "var(--ink-faint)" }}>{text}</p>;
}

export function PageHeader({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h1 className="mono text-sm tracking-[0.3em] uppercase text-cyan-300 glow">{title}</h1>
        <p className="text-xs text-slate-500 mt-1">{sub}</p>
      </div>
      {right}
    </div>
  );
}

export function statusTone(status: string): string {
  if (["won", "paid", "issued", "approved", "hot", "sent"].includes(status)) return "badge-good";
  if (["meeting", "quoted", "partial", "queued"].includes(status)) return "badge-accent";
  if (["overdue", "lost", "not_interested"].includes(status)) return "badge-bad";
  if (["contacted", "replied", "paused", "draft"].includes(status)) return "badge-warn";
  return "";
}
