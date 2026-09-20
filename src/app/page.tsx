"use client";

import { Panel, Stat, Badge, Meter, Empty, statusTone } from "@/components/ui";
import { useApi } from "@/lib/useApi";

interface RevenueStatus {
  target: number; earned: number; pct: number; days_left: number; required_per_day: number;
  actual_per_day: number; pace_delta_pct: number; pipeline_value: number; forecast: number; actions: string[];
}
interface Financial {
  today_in: number; today_out: number; week_in: number; month_in: number; receivables: number; receivables_overdue: number; balance_estimate: number | null;
}
interface Lead { id: number; company: string; status: string; score: number }
interface Doc { id: number; kind: string; number: string; client: string; total: number; status: string }
interface Act { id: number; action: string; detail: string | null; created_at: string }
interface Task { id: number; title: string; due: string | null; priority: string }
interface Approval { id: number; kind: string; summary: string }

export default function CommandDeck() {
  const revApi = useApi<{ status?: RevenueStatus }>("/api/revenue", { intervalMs: 10000 });
  const moneyApi = useApi<{ fin?: Financial }>("/api/money?limit=5", { intervalMs: 10000 });
  const leadsApi = useApi<{ leads?: Lead[] }>("/api/leads", { intervalMs: 10000 });
  const docsApi = useApi<{ documents?: Doc[] }>("/api/documents", { intervalMs: 10000 });
  const actsApi = useApi<{ activity?: Act[] }>("/api/activity", { intervalMs: 10000 });
  const tasksApi = useApi<{ tasks?: Task[] }>("/api/tasks", { intervalMs: 10000 });
  const apprApi = useApi<{ pending?: Approval[] }>("/api/approvals", { intervalMs: 10000 });

  const rev = revApi.data?.status ?? null;
  const fin = moneyApi.data?.fin ?? null;
  const leads = leadsApi.data?.leads ?? [];
  const docs = docsApi.data?.documents ?? [];
  const acts = actsApi.data?.activity ?? [];
  const tasks = tasksApi.data?.tasks ?? [];
  const approvals = apprApi.data?.pending ?? [];

  const funnel = ["new", "contacted", "replied", "meeting", "quoted", "won"].map((s) => ({
    stage: s, n: leads.filter((l) => l.status === s).length,
  }));
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.n));
  const paceTone = (rev?.pace_delta_pct ?? 0) >= 0 ? "good" : "warn";
  const fmt = (n: number): string => `KES ${n.toLocaleString()}`;

  return (
    <div className="space-y-5">
      {/* mission strip */}
      <div className="panel corner flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex items-center gap-5">
          <MissionRing pct={rev?.pct ?? 0} ahead={(rev?.pace_delta_pct ?? 0) >= 0} />
          <div>
            <p className="k">Revenue mission · Q4</p>
            <p className="num text-2xl text-amber-300 glow-gold">{fmt(rev?.earned ?? 0)} <span className="text-sm text-slate-500">/ {fmt(rev?.target ?? 400000)}</span></p>
            <div className="w-56 mt-2"><Meter pct={rev?.pct ?? 0} tone={paceTone === "good" ? "good" : "warn"} /></div>
            <p className="mono text-[10px] mt-2 text-slate-500">
              {rev ? `${rev.days_left} days left · need ${fmt(rev.required_per_day)}/day · actual ${fmt(rev.actual_per_day)}/day` : "loading…"}
            </p>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Pace" value={`${(rev?.pace_delta_pct ?? 0) >= 0 ? "+" : ""}${rev?.pace_delta_pct ?? 0}%`} sub="vs required" tone={paceTone as "good"} />
          <Stat label="Pipeline" value={fmt(rev?.pipeline_value ?? 0)} sub={`forecast ${fmt(rev?.forecast ?? 0)}`} tone="accent" />
          <Stat label="Receivables" value={fmt(fin?.receivables ?? 0)} sub={`overdue ${fmt(fin?.receivables_overdue ?? 0)}`} tone={(fin?.receivables_overdue ?? 0) > 0 ? "bad" : "ink"} />
          <Stat label="Awaiting you" value={String(approvals.length)} sub="approval gates" tone={approvals.length ? "gold" : "ink"} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* left: funnel + leads */}
        <div className="space-y-5">
          <Panel title="Pipeline funnel">
            <div className="space-y-2">
              {funnel.map((f) => (
                <div key={f.stage} className="flex items-center gap-3">
                  <span className="k w-20">{f.stage}</span>
                  <div className="flex-1"><Meter pct={(f.n / maxFunnel) * 100} tone="accent" /></div>
                  <span className="num text-xs w-6 text-right">{f.n}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Top leads" right={<a className="k" href="/crm" style={{ color: "var(--accent)" }}>open CRM →</a>}>
            {leads.length === 0 ? <Empty text="No leads yet." /> : (
              <ul className="space-y-1.5">
                {leads.slice(0, 6).map((l) => (
                  <li key={l.id} className="flex items-center justify-between mono text-xs">
                    <span className="truncate">{l.company}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                      <span className="num text-slate-500">{l.score}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* center: today + directives */}
        <div className="space-y-5">
          <Panel title="Today's highest-leverage actions">
            <ul className="space-y-2">
              {(rev?.actions ?? []).map((a, i) => (
                <li key={i} className="flex items-start gap-2 mono text-xs">
                  <span className="text-amber-300">▲</span> {a}
                </li>
              ))}
              {!rev && <Empty text="Computing…" />}
            </ul>
          </Panel>
          <Panel title="Open tasks">
            {tasks.length === 0 ? <Empty text="Nothing open." /> : (
              <ul className="space-y-1.5">
                {tasks.slice(0, 7).map((t) => (
                  <li key={t.id} className="flex items-center justify-between mono text-xs">
                    <span className="truncate">{t.title}</span>
                    {t.due && <span className="k shrink-0 ml-2">{t.due.slice(5)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Money pulse">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="In today" value={fmt(fin?.today_in ?? 0)} tone="good" />
              <Stat label="Out today" value={fmt(fin?.today_out ?? 0)} tone="bad" />
              <Stat label="Month in" value={fmt(fin?.month_in ?? 0)} tone="accent" />
            </div>
          </Panel>
        </div>

        {/* right: activity + approvals */}
        <div className="space-y-5">
          <Panel title="Approval gates" right={<a className="k" href="/approvals" style={{ color: "var(--accent)" }}>review →</a>}>
            {approvals.length === 0 ? <Empty text="No gates pending." /> : (
              <ul className="space-y-1.5">
                {approvals.slice(0, 5).map((a) => (
                  <li key={a.id} className="mono text-xs flex items-center gap-2">
                    <span className="text-amber-300">✦</span>
                    <span className="truncate">{a.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Activity feed">
            <ul className="space-y-1 mono text-[11px]">
              {acts.slice(0, 12).map((a) => (
                <li key={a.id} className="truncate" style={{ color: "var(--ink-dim)" }}>
                  <span style={{ color: "var(--ink-faint)" }}>{a.created_at?.slice(11, 16)}</span>{" "}
                  <span style={{ color: "var(--accent)" }}>{a.action}</span> {a.detail ?? ""}
                </li>
              ))}
              {acts.length === 0 && <Empty text="Awaiting first directive." />}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MissionRing({ pct, ahead }: { pct: number; ahead: boolean }) {
  const stroke = ahead ? "var(--good)" : "var(--gold)";
  return (
    <div className="relative w-[110px] h-[110px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="50" cy="50" r="44" fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, pct) / 100) * 276} 276`} transform="rotate(-90 50 50)"
          style={{ filter: `drop-shadow(0 0 6px ${stroke})` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-lg" style={{ color: stroke }}>{pct}%</span>
        <span className="k" style={{ fontSize: 8 }}>{ahead ? "AHEAD" : "BEHIND"}</span>
      </div>
    </div>
  );
}
