"use client";

import { Panel, Badge, Empty, PageHeader } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Approval { id: number; kind: string; summary: string; created_at: string }

export default function ApprovalsPage() {
  const pendingApi = useApi<{ pending?: Approval[] }>("/api/approvals", { intervalMs: 8000 });
  const actApi = useApi<{ activity?: { id: number; action: string; detail: string | null; created_at: string }[] }>("/api/activity", { intervalMs: 8000 });
  const pending = pendingApi.data?.pending ?? [];
  const history = (actApi.data?.activity ?? [])
    .filter((a) => ["APPROVAL_GRANTED", "APPROVAL_DENIED"].includes(a.action))
    .map((a) => ({
      id: a.id, kind: a.action, summary: a.detail ?? "", created_at: a.created_at,
      status: a.action === "APPROVAL_GRANTED" ? "approved" : "denied", resolved_via: null as string | null,
    }))
    .slice(0, 10);

  const resolve = async (id: number, approve: boolean): Promise<void> => {
    await apiFetch("/api/approvals", { method: "POST", body: JSON.stringify({ id, approve }) });
    pendingApi.reload();
    actApi.reload();
  };

  return (
    <div>
      <PageHeader title="Approval Gates" sub="Where JARVIS waits for your yes — sends, reconciliations, campaigns, public posts." />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Panel title={`Pending — ${pending.length}`}>
            {pending.length === 0 ? <Empty text="Nothing awaits you, sir." /> : (
              <ul className="space-y-2">
                {pending.map((a) => (
                  <li key={a.id} className="panel corner !p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1"><Badge tone="badge-gold">{a.kind}</Badge>
                        <span className="k">{a.created_at?.slice(11, 16)}</span></div>
                      <p className="text-[13px] truncate">{a.summary}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="btn btn-approve" onClick={() => void resolve(a.id, true)}>APPROVE</button>
                      <button className="btn btn-deny" onClick={() => void resolve(a.id, false)}>DENY</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Recent decisions">
            <ul className="space-y-1">
              {history.map((h) => (
                <li key={h.id} className="mono text-[11px] flex items-center justify-between gap-2">
                  <span className="truncate" style={{ color: "var(--ink-dim)" }}>{h.summary || h.kind}</span>
                  <Badge tone={h.status === "approved" ? "badge-good" : "badge-bad"}>{h.status}</Badge>
                </li>
              ))}
              {history.length === 0 && <Empty text="No decisions yet." />}
            </ul>
          </Panel>

          <Panel title="Policy (medium)">
            <ul className="mono text-[11px] space-y-1.5" style={{ color: "var(--ink-dim)" }}>
              <li className="text-emerald-300">· autonomous: reads, records, drafts, replies to existing contacts</li>
              <li className="text-amber-300">· gated: first contact, LinkedIn/X DMs, campaigns &gt;5, invoices issued</li>
              <li className="text-rose-300">· never: suppressed contacts, unprompted public posts</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
