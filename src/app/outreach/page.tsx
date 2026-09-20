"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface QueueItem {
  id: number; lead_id: number; company: string | null; contact: string | null; channel: string;
  step: number; template: string | null; body: string | null; scheduled_for: string;
  status: string; approval_required: number;
}
interface SentItem { id: number; company: string | null; channel: string; step: number; sent_at: string | null }
interface ChannelStat { channel: string; n: number; sent: number | null }

export default function OutreachPage() {
  const feed = useApi<{ queue?: QueueItem[]; sent?: SentItem[]; byChannel?: ChannelStat[] }>("/api/outreach", { intervalMs: 12000 });
  const queue = feed.data?.queue ?? [];
  const sent = feed.data?.sent ?? [];
  const stats = feed.data?.byChannel ?? [];
  const [reply, setReply] = useState("");
  const [verdict, setVerdict] = useState<{ cls: string; action: string } | null>(null);

  const process = async (): Promise<void> => {
    await apiFetch("/api/outreach", { method: "POST", body: JSON.stringify({ action: "process" }) });
    feed.reload();
  };
  const classify = async (): Promise<void> => {
    try {
      const v = await apiFetch<{ cls: string; action: string }>("/api/outreach", { method: "POST", body: JSON.stringify({ action: "classify", text: reply }) });
      setVerdict(v);
    } catch (err) {
      setVerdict({ cls: "error", action: err instanceof Error ? err.message : "Classification failed." });
    }
  };

  return (
    <div>
      <PageHeader title="Outbound Engine" sub="Sequences, queues and kill-switches — volume that earns its reputation."
        right={<button className="btn" onClick={() => void process()}>PROCESS DUE NOW</button>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {stats.map((s) => (
          <Stat key={s.channel} label={s.channel} value={String(s.sent ?? 0)} sub={`${s.n} queued total`} tone="accent" />
        ))}
        {stats.length === 0 && <Stat label="Queued" value="0" sub="engine idle" />}
        <Stat label="Awaiting your yes" value={String(queue.filter((q) => q.approval_required === 1 && q.status === "paused").length)} sub="gated sends" tone="gold" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Queue — pending & gated">
            <table className="dtable">
              <thead><tr><th>Lead</th><th>Channel</th><th>Step</th><th>Message</th><th>When</th><th>State</th></tr></thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id}>
                    <td>{q.company ?? `#${q.lead_id}`}</td>
                    <td><Badge tone={q.channel === "linkedin" ? "badge-gold" : ""}>{q.channel}</Badge></td>
                    <td className="num">{q.step}</td>
                    <td className="text-[11px] text-slate-400 truncate max-w-[240px]">{q.body ?? q.template ?? "—"}</td>
                    <td className="mono text-[11px] text-slate-500">{q.scheduled_for?.slice(5, 16).replace("T", " ")}</td>
                    <td><Badge tone={q.approval_required ? "badge-gold" : "badge-accent"}>{q.approval_required ? "gated" : q.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {queue.length === 0 && <Empty text="Queue empty — JARVIS builds it nightly from the funnel." />}
          </Panel>

          <Panel title="Recent sends">
            <ul className="space-y-1">
              {sent.map((s) => (
                <li key={s.id} className="mono text-xs flex items-center justify-between">
                  <span className="truncate">{s.company ?? `#${s.id}`} <span className="k">· {s.channel} step {s.step}</span></span>
                  <span className="text-slate-500 text-[11px]">{s.sent_at?.slice(11, 16)}</span>
                </li>
              ))}
              {sent.length === 0 && <Empty text="Nothing sent yet." />}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Reply classifier">
            <p className="k mb-2">Paste an inbound reply — JARVIS classes it and prescribes the action.</p>
            <textarea className="input w-full h-24 resize-none" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. We're interested — what's the cost for 3 sites?" />
            <button className="btn w-full mt-2" onClick={() => void classify()} disabled={!reply.trim()}>CLASSIFY</button>
            {verdict && (
              <div className="mt-3 panel corner !p-3">
                <Badge tone={verdict.cls === "hot" ? "badge-good" : verdict.cls === "not_interested" ? "badge-bad" : "badge-warn"}>{verdict.cls}</Badge>
                <p className="mono text-[11px] mt-2" style={{ color: "var(--ink-dim)" }}>{verdict.action}</p>
              </div>
            )}
          </Panel>

          <Panel title="Kill-switch doctrine">
            <ul className="mono text-[11px] space-y-1.5" style={{ color: "var(--ink-dim)" }}>
              <li>· reply rate &lt;0.5% after 200 sends → template paused</li>
              <li>· bounce &gt;3% → mailbox quarantined</li>
              <li>· complaint &gt;0.1% → domain investigated</li>
              <li>· unsubscribe → permanent suppression, all channels</li>
              <li>· LinkedIn initiations always gated — replies never wait</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
