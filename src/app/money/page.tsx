"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader, statusTone, Stat } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Tx {
  id: number; direction: string; amount: number; currency: string; tx_type: string | null;
  counterparty: string | null; category: string | null; source: string; ref: string | null; occurred_at: string;
}
interface Doc { id: number; kind: string; number: string; client: string; total: number; status: string; due_date: string | null }
interface Financial {
  today_in: number; today_out: number; week_in: number; month_in: number; month_out: number; fees_month: number;
  balance_estimate: number | null; receivables: number; receivables_overdue: number;
  by_category_month: { category: string; total: number }[];
}

export default function MoneyPage() {
  const [form, setForm] = useState({ direction: "in", amount: "", counterparty: "", phone: "" });
  const money = useApi<{ transactions?: Tx[]; invoices?: Doc[]; fin?: Financial }>("/api/money?limit=80", { intervalMs: 10000 });
  const txs = money.data?.transactions ?? [];
  const docs = money.data?.invoices ?? [];
  const status = money.data?.fin ?? null;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.amount) return;
    await apiFetch("/api/money", {
      method: "POST",
      body: JSON.stringify({ direction: form.direction, amount: Number(form.amount), counterparty: form.counterparty || undefined, phone: form.phone || undefined }),
    });
    setForm({ direction: form.direction, amount: "", counterparty: "", phone: "" });
    money.reload();
  };

  const fmt = (n: number): string => n.toLocaleString();

  return (
    <div>
      <PageHeader title="Money Desk" sub="M-Pesa ledger, invoices, receipts — every shilling gets a story." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Stat label="Balance est." value={status?.balance_estimate != null ? fmt(status.balance_estimate) : "—"} sub="from last SMS" tone="accent" />
        <Stat label="In today" value={fmt(status?.today_in ?? 0)} tone="good" />
        <Stat label="Out today" value={fmt(status?.today_out ?? 0)} tone="bad" />
        <Stat label="Fees (month)" value={fmt(status?.fees_month ?? 0)} sub="M-Pesa charges" tone="gold" />
        <Stat label="Receivables" value={fmt(status?.receivables ?? 0)} sub={`overdue ${fmt(status?.receivables_overdue ?? 0)}`} tone={(status?.receivables_overdue ?? 0) > 0 ? "bad" : "ink"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Ledger — live transactions">
            <table className="dtable">
              <thead><tr><th>When</th><th></th><th>Amount</th><th>Party</th><th>Category</th><th>Ref</th></tr></thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="mono text-[11px] text-slate-500">{t.occurred_at?.slice(5, 16).replace("T", " ")}</td>
                    <td><Badge tone={t.direction === "in" ? "badge-good" : "badge-bad"}>{t.direction === "in" ? "IN " : "OUT"}</Badge></td>
                    <td className={`num ${t.direction === "in" ? "text-emerald-300" : "text-rose-300"}`}>{t.direction === "in" ? "+" : "−"}{fmt(t.amount)}</td>
                    <td className="text-[12px]">{t.counterparty ?? "—"}</td>
                    <td><Badge>{t.category ?? t.tx_type ?? "—"}</Badge></td>
                    <td className="mono text-[10px] text-slate-500">{t.ref ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {txs.length === 0 && <Empty text="No transactions yet — connect the M-Pesa SMS bridge (Settings)." />}
          </Panel>

          <Panel title="Invoices & receipts">
            <table className="dtable">
              <thead><tr><th>Number</th><th>Client</th><th>Total</th><th>Status</th><th>Due</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.number}>
                    <td className="mono text-[11px]" style={{ color: d.kind === "RECEIPT" ? "var(--good)" : "var(--accent)" }}>{d.number}</td>
                    <td>{d.client}</td>
                    <td className="num">{fmt(d.total)}</td>
                    <td><Badge tone={statusTone(d.status)}>{d.status}</Badge></td>
                    <td className="mono text-[11px] text-slate-500">{d.due_date?.slice(0, 10) ?? "—"}</td>
                    <td><a className="btn !py-0.5 !px-2" href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {docs.length === 0 && <Empty text="No documents yet." />}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Record manually">
            <form className="space-y-2" onSubmit={submit}>
              <div className="flex gap-2">
                <select className="input flex-1" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="in" className="bg-slate-900">Money in</option>
                  <option value="out" className="bg-slate-900">Money out</option>
                </select>
                <input className="input flex-1 num" placeholder="Amount KES" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <input className="input w-full" placeholder="Counterparty" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
              <input className="input w-full" placeholder="Phone (+2547…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <button className="btn w-full" type="submit">Record in ledger</button>
            </form>
          </Panel>

          <Panel title="Category breakdown (month)">
            {(status?.by_category_month ?? []).length === 0 ? <Empty text="No spend yet." /> : (
              <ul className="space-y-1.5">
                {status!.by_category_month.map((c) => (
                  <li key={c.category} className="flex justify-between mono text-xs">
                    <span>{c.category}</span><span className="num text-rose-300">−{fmt(c.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="M-Pesa bridge">
            <p className="mono text-[11px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>
              Forward SMS to <span className="text-cyan-300">POST /api/webhooks/mpesa</span> with header
              <span className="text-cyan-300"> x-jarvis-token</span> = MPESA_WEBHOOK_TOKEN (.env).
              Payments auto-reconcile to invoices; receipts issue automatically. Ambiguous matches land in
              <span className="text-amber-300"> Approvals</span>; unknowns become high-priority tasks.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
