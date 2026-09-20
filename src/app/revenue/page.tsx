"use client";

import { Panel, Stat, Meter, Empty, PageHeader, Badge, statusTone } from "@/components/ui";
import { useApi } from "@/lib/useApi";

interface RevenueStatus {
  target: number; earned: number; pct: number; days_total: number; days_left: number;
  required_per_day: number; actual_per_day: number; pace_delta_pct: number;
  pipeline_value: number; forecast: number; saas_users: number; actions: string[];
}
interface Doc { id: number; kind: string; number: string; client: string; total: number; status: string }interface Lead { id: number; company: string; status: string; score: number }

export default function RevenuePage() {
  const rev = useApi<{ status?: RevenueStatus }>("/api/revenue", { intervalMs: 12000 });
  const docsApi = useApi<{ documents?: Doc[] }>("/api/documents", { intervalMs: 12000 });
  const leadsApi = useApi<{ leads?: Lead[] }>("/api/leads", { intervalMs: 12000 });
  const status = rev.data?.status ?? null;
  const docs = (docsApi.data?.documents ?? []).filter((x) => x.kind !== "RECEIPT");
  const leads = leadsApi.data?.leads ?? [];

  const fmt = (n: number): string => `KES ${n.toLocaleString()}`;
  const ahead = (status?.pace_delta_pct ?? 0) >= 0;

  return (
    <div>
      <PageHeader title="Revenue Mission" sub="Q4 target KES 400,000 — the reactor ring on the Command Deck is this page, on duty 24/7." />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel title="Mission status" className="xl:col-span-2">
          {status ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="Earned" value={fmt(status.earned)} sub={`${status.pct}% of target`} tone="gold" />
                <Stat label="Required/day" value={fmt(status.required_per_day)} sub={`${status.days_left} days left`} />
                <Stat label="Actual/day" value={fmt(status.actual_per_day)} tone={ahead ? "good" : "bad"} />
                <Stat label="Pace" value={`${ahead ? "+" : ""}${status.pace_delta_pct}%`} sub="vs required curve" tone={ahead ? "good" : "bad"} />
              </div>
              <Meter pct={status.pct} tone={ahead ? "good" : "warn"} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Stat label="Open pipeline" value={fmt(status.pipeline_value)} tone="accent" />
                <Stat label="Forecast" value={fmt(status.forecast)} sub="pace + 15% of pipeline" />
                <Stat label="SaaS cohort" value={String(status.saas_users)} sub="won via SaaS source" tone="accent" />
                <Stat label="Days left" value={String(status.days_left)} sub={`of ${status.days_total}`} />
              </div>
            </>
          ) : <Empty text="Computing mission math…" />}
        </Panel>

        <Panel title="Today's levers">
          <ul className="space-y-2">
            {(status?.actions ?? []).map((a, i) => (
              <li key={i} className="flex items-start gap-2 mono text-xs"><span className="text-amber-300">▲</span> {a}</li>
            ))}
            {!status && <Empty text="…" />}
          </ul>
          <p className="k mt-4 mb-2">Open documents</p>
          <ul className="space-y-1">
            {docs.filter((d) => d.status !== "paid").slice(0, 6).map((d) => (
              <li key={d.id} className="flex items-center justify-between mono text-xs">
                <span className="truncate">{d.number} · {d.client}</span>
                <Badge tone={statusTone(d.status)}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Pipeline by value (quotes & invoices open)">
          <table className="dtable">
            <thead><tr><th>Doc</th><th>Client</th><th>Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="mono text-[11px]" style={{ color: d.kind === "INVOICE" ? "var(--accent)" : "var(--ink-dim)" }}>{d.number}</td>
                  <td>{d.client}</td>
                  <td className="num">{fmt(d.total)}</td>
                  <td><Badge tone={statusTone(d.status)}>{d.status}</Badge></td>
                  <td><a className="btn !py-0.5 !px-2" href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {docs.length === 0 && <Empty text="No documents yet." />}
        </Panel>
      </div>
    </div>
  );
}
