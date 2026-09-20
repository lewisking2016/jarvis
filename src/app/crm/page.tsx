"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader, statusTone } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Lead {
  id: number; company: string; contact: string | null; email: string | null; phone: string | null;
  source: string | null; status: string; score: number; notes: string | null;
}

const STAGES = ["new", "contacted", "replied", "meeting", "quoted", "won", "lost"] as const;

export default function CrmPage() {
  const [view, setView] = useState<"board" | "table">("board");
  const leads = useApi<{ leads?: Lead[] }>("/api/leads", { intervalMs: 12000 });
  const list = leads.data?.leads ?? [];

  const move = async (id: number, status: string): Promise<void> => {
    await apiFetch("/api/mutate", { method: "PATCH", body: JSON.stringify({ entity: "lead", id, status }) });
    leads.reload();
  };

  return (
    <div>
      <PageHeader title="CRM / Pipeline" sub="Every relationship, one record, one score — fed by chat, outreach and research."
        right={
          <div className="flex gap-1">
            <button className={`btn ${view === "board" ? "text-cyan-300" : ""}`} onClick={() => setView("board")}>BOARD</button>
            <button className={`btn ${view === "table" ? "text-cyan-300" : ""}`} onClick={() => setView("table")}>TABLE</button>
          </div>
        } />

      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto hud-scroll pb-2">
          {STAGES.map((s) => {
            const items = list.filter((l) => l.status === s);
            return (
              <div key={s} className="min-w-[220px] flex-1">
                <p className="k mb-2">{s} · {items.length}</p>
                <div className="space-y-2">
                  {items.map((l) => (
                    <div key={l.id} className="panel corner !p-3">
                      <p className="text-[13px] mb-0.5 truncate">{l.company}</p>
                      <p className="k truncate">{l.contact ?? "—"} · {l.source ?? "—"}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className={`num text-xs ${l.score >= 60 ? "text-emerald-300" : l.score >= 35 ? "text-amber-300" : "text-slate-500"}`}>{l.score}</span>
                        <select
                          className="mono text-[10px] bg-transparent border rounded px-1 py-0.5"
                          style={{ borderColor: "var(--line-bright)", color: "var(--ink-dim)" }}
                          value={l.status}
                          onChange={(e) => void move(l.id, e.target.value)}
                        >
                          {STAGES.map((st) => <option key={st} value={st} className="bg-slate-900">{st}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="panel corner !p-3 opacity-40"><Empty text="empty" /></div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Panel title="All leads">
          <table className="dtable">
            <thead><tr><th>Company</th><th>Contact</th><th>Channel</th><th>Source</th><th>Score</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id}>
                  <td>{l.company}</td>
                  <td className="mono text-[11px] text-slate-400">{l.contact ?? "—"}</td>
                  <td className="mono text-[11px] text-slate-400">{l.email ?? l.phone ?? "—"}</td>
                  <td><Badge>{l.source ?? "—"}</Badge></td>
                  <td className="num">{l.score}</td>
                  <td><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                  <td>
                    <select
                      className="mono text-[10px] bg-transparent border rounded px-1 py-0.5"
                      style={{ borderColor: "var(--line-bright)", color: "var(--ink-dim)" }}
                      value={l.status}
                      onChange={(e) => void move(l.id, e.target.value)}
                    >
                      {STAGES.map((st) => <option key={st} value={st} className="bg-slate-900">{st}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <Empty text="No leads yet — ask JARVIS to hunt." />}
        </Panel>
      )}
    </div>
  );
}
