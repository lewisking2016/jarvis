"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Memory {
  id: number; kind: string; content: string; importance: number; source: string; use_count: number; created_at: string;
}

const KINDS = ["fact", "decision", "preference", "event", "lesson", "relationship"];

export default function MemoryPage() {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ kind: "fact", content: "", importance: "2" });
  const [distillMsg, setDistillMsg] = useState("");
  const [distilling, setDistilling] = useState(false);
  const memUrl = query ? `/api/memory?q=${encodeURIComponent(query)}` : "/api/memory";
  const mem = useApi<{ memories?: Memory[] }>(memUrl);
  const dist = useApi<{ last_run?: string | null }>("/api/distiller");
  const memories = mem.data?.memories ?? [];
  const lastRun = dist.data?.last_run ?? null;

  const distill = async (): Promise<void> => {
    setDistilling(true);
    try {
      const r = await apiFetch<{ added: number; deduped: number; activity_scanned: number }>("/api/distiller", { method: "POST" });
      setDistillMsg(`Distilled: ${r.added} new memories, ${r.deduped} duplicates skipped (${r.activity_scanned} actions scanned).`);
      mem.reload();
      dist.reload();
    } catch (err) {
      setDistillMsg(err instanceof Error ? `Distiller failed — ${err.message}` : "Distiller failed — check server logs.");
    }
    setTimeout(() => setDistillMsg(""), 6000);
    setDistilling(false);
  };

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.content.trim()) return;
    await apiFetch("/api/memory", {
      method: "POST",
      body: JSON.stringify({ kind: form.kind, content: form.content, importance: Number(form.importance) }),
    });
    setForm({ kind: form.kind, content: "", importance: form.importance });
    mem.reload();
  };

  const tone = (k: string): string =>
    k === "identity" ? "badge-gold" : k === "lesson" ? "badge-warn" : k === "preference" ? "badge-accent" : k === "decision" ? "badge-good" : "";

  return (
    <div>
      <PageHeader title="Memory Core" sub="What JARVIS knows for certain — identity, lessons, decisions. The nightly distiller feeds this from every interaction." />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Panel title={query ? `Search: “${query}”` : "All memories (top by importance)"}
            right={<input className="input !py-1 !text-xs w-44" placeholder="recall search…" value={query}
              onChange={(e) => setQuery(e.target.value)} />}>
            <ul className="space-y-2">
              {memories.map((m) => (
                <li key={m.id} className="flex items-start gap-3 panel corner !p-3">
                  <Badge tone={tone(m.kind)}>{m.kind}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px]">{m.content}</p>
                    <p className="k mt-1">imp {m.importance} · used ×{m.use_count} · {m.source} · {m.created_at?.slice(0, 10)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {memories.length === 0 && <Empty text="No memories yet." />}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Teach JARVIS">
            <form className="space-y-2" onSubmit={add}>
              <select className="input w-full" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k} className="bg-slate-900">{k}</option>)}
              </select>
              <textarea className="input w-full h-20 resize-none" placeholder="One atomic statement — 'Acme's decision maker is John Mwangi.'"
                value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              <div className="flex gap-2 items-center">
                <span className="k">importance</span>
                <select className="input flex-1" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })}>
                  {[1, 2, 3, 4, 5].map((i) => <option key={i} value={i} className="bg-slate-900">{i}</option>)}
                </select>
              </div>
              <button className="btn w-full" type="submit">Remember</button>
            </form>
          </Panel>

          <Panel title="Nightly distiller">
            <p className="mono text-[11px] mb-3" style={{ color: "var(--ink-dim)" }}>
              Condenses the day's activity into memories — receipts, pipeline moves, directives, a daily rollup.
              Runs automatically at 03:00.
            </p>
            <p className="k mb-2">Last run: {lastRun ?? "never"}</p>
            <button className="btn w-full" onClick={() => void distill()} disabled={distilling}>
              {distilling ? "DISTILLING…" : "RUN DISTILLER NOW"}
            </button>
            {distillMsg && <p className="mono text-[11px] mt-2 text-cyan-300">{distillMsg}</p>}
          </Panel>

          <Panel title="How memory works">
            <ul className="mono text-[11px] space-y-1.5" style={{ color: "var(--ink-dim)" }}>
              <li>· identity rows (gold) are permanent ground truth</li>
              <li>· distiller runs nightly, condensing the day into facts/decisions/lessons</li>
              <li>· recall is scored: match + recency + importance + usage</li>
              <li>· ~500 tokens injected per conversation — budgeted, never flooding</li>
              <li>· contradictions: newer supersedes, older kept for audit</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
