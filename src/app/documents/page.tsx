"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader, statusTone, Stat } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

type Kind = "QUOTE" | "INVOICE" | "RECEIPT";

interface DocItem {
  description: string;
  qty: number;
  unit_price: number;
}

interface Doc {
  id: number;
  kind: Kind;
  number: string;
  client: string;
  client_phone: string | null;
  items: DocItem[];
  currency: string;
  tax_rate: number;
  total: number;
  status: string;
  due_date: string | null;
  payment_info?: string | null;
  created_at: string;
}

interface ItemRow {
  description: string;
  qty: string;
  unit_price: string;
}

interface FormState {
  id: number | null;
  kind: Kind;
  client: string;
  client_phone: string;
  due_date: string;
  tax_rate: string;
  status: string;
  pay_method: "MPESA" | "BANK";
  pay_code: string;
  items: ItemRow[];
}

const EMPTY_FORM: FormState = {
  id: null,
  kind: "INVOICE",
  client: "",
  client_phone: "",
  due_date: "",
  tax_rate: "16",
  status: "draft",
  pay_method: "MPESA",
  pay_code: "",
  items: [{ description: "", qty: "1", unit_price: "" }],
};

const STATUSES = ["draft", "sent", "partial", "paid", "issued", "overdue", "void"];
const KINDS: Kind[] = ["QUOTE", "INVOICE", "RECEIPT"];
const FILTERS: ("ALL" | Kind)[] = ["ALL", "QUOTE", "INVOICE", "RECEIPT"];

const fmt = (n: number): string => n.toLocaleString();

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function DocumentsPage() {
  const docs = useApi<{ documents?: Doc[] }>("/api/documents", { intervalMs: 20000 });
  const [filter, setFilter] = useState<"ALL" | Kind>("ALL");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const all = docs.data?.documents ?? [];
  const list = filter === "ALL" ? all : all.filter((d) => d.kind === filter);

  const openQuotes = all.filter((d) => d.kind === "QUOTE" && d.status !== "void");
  const openInvoices = all.filter((d) => d.kind === "INVOICE" && !["paid", "void"].includes(d.status));
  const invoicedValue = openInvoices.reduce((s, d) => s + d.total, 0);

  const subtotal = form.items.reduce((s, i) => s + num(i.qty) * num(i.unit_price), 0);
  const tax = subtotal * (num(form.tax_rate) / 100);
  const grand = subtotal + tax;

  const editing = form.id !== null;

  const setItem = (idx: number, patch: Partial<ItemRow>): void => {
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  };

  const startEdit = (d: Doc): void => {
    setForm({
      id: d.id,
      kind: d.kind,
      client: d.client,
      client_phone: d.client_phone ?? "",
      due_date: d.due_date?.slice(0, 10) ?? "",
      tax_rate: String(d.tax_rate ?? 0),
      status: d.status,
      pay_method: d.payment_info?.startsWith("BANK · ") ? "BANK" : "MPESA",
      pay_code: d.payment_info?.replace(/^(M-PESA · |BANK · )/, "") ?? "",
      items: (d.items ?? []).map((i) => ({ description: i.description, qty: String(i.qty), unit_price: String(i.unit_price) })),
    });
    setMsg(null);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const flash = (ok: boolean, text: string): void => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.client.trim()) return void flash(false, "Client name is required.");
    const items = form.items
      .map((i) => ({ description: i.description.trim(), qty: num(i.qty), unit_price: num(i.unit_price) }))
      .filter((i) => i.description && i.qty > 0);
    if (items.length === 0) return void flash(false, "At least one line item with description and quantity is required.");

    setSaving(true);
    try {
      const payload = {
        ...(form.id !== null ? { id: form.id } : { kind: form.kind }),
        client: form.client,
        client_phone: form.client_phone || undefined,
        items,
        tax_rate: num(form.tax_rate),
        status: form.status,
        due_date: form.due_date || undefined,
        payment_info:
          form.kind === "INVOICE" || form.kind === "RECEIPT"
            ? form.pay_code.trim()
              ? (form.pay_method === "MPESA" ? "M-PESA · " : "BANK · ") + form.pay_code.trim()
              : undefined
            : undefined,
      };
      const r = await apiFetch<{ document?: { number?: string } }>("/api/documents", {
        method: form.id !== null ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      flash(true, `${form.id !== null ? "Updated" : "Created"} ${r.document?.number ?? "document"} — KES ${fmt(grand)}.`);
      setForm(EMPTY_FORM);
      docs.reload();
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Doc): Promise<void> => {
    if (!window.confirm(`Delete ${d.number} (${d.client})? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/documents?id=${d.id}`, { method: "DELETE" });
      flash(true, `Deleted ${d.number}.`);
      if (form.id === d.id) setForm(EMPTY_FORM);
      docs.reload();
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Paper Desk"
        sub="Create, edit and issue quotes, invoices and receipts directly — no console needed."
        right={
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button key={f} className={`btn shrink-0 whitespace-nowrap ${filter === f ? "text-cyan-300" : ""}`} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Documents" value={String(all.length)} sub={`${all.filter((d) => d.kind === "RECEIPT").length} receipts issued`} />
        <Stat label="Open quotes" value={String(openQuotes.length)} sub="awaiting decision" tone="accent" />
        <Stat label="Open invoices" value={String(openInvoices.length)} sub={`KES ${fmt(invoicedValue)} outstanding`} tone="gold" />
        <Stat
          label={editing ? `Editing #${form.id}` : "New document"}
          value={editing ? "✎" : "＋"}
          sub={editing ? "changes apply on save" : "form below"}
          tone={editing ? "bad" : "good"}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <Panel title={`Documents — ${list.length}`}>
            {docs.loading && list.length === 0 ? (
              <Empty text="Loading documents…" />
            ) : docs.error && list.length === 0 ? (
              <Empty text={`Could not load documents — ${docs.error}`} />
            ) : list.length === 0 ? (
              <Empty text={filter === "ALL" ? "No documents yet — create your first one with the form." : `No ${filter.toLowerCase()}s yet.`} />
            ) : (
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Client</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id}>
                      <td className="mono text-[11px]" style={{ color: d.kind === "RECEIPT" ? "var(--good)" : d.kind === "INVOICE" ? "var(--accent)" : "var(--ink-dim)" }}>
                        {d.number}
                      </td>
                      <td>{d.client}</td>
                      <td className="num text-slate-500">{d.items?.length ?? 0}</td>
                      <td className="num">{fmt(d.total)}</td>
                      <td><Badge tone={statusTone(d.status)}>{d.status}</Badge></td>
                      <td className="mono text-[11px] text-slate-500">{d.due_date?.slice(0, 10) ?? "—"}</td>
                      <td>
                        <div className="flex gap-1 justify-end">
                          <button className="btn !py-0.5 !px-2" onClick={() => startEdit(d)}>EDIT</button>
                          <a className="btn !py-0.5 !px-2" href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                          <button className="btn btn-deny !py-0.5 !px-2" onClick={() => void remove(d)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div>
          <Panel title={editing ? `Edit ${form.kind} #${form.id}` : "New document"}>
            <form className="space-y-2" onSubmit={submit}>
              {!editing && (
                <div className="flex gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn flex-1 ${form.kind === k ? "text-cyan-300" : ""}`}
                      onClick={() => setForm({ ...form, kind: k, status: k === "RECEIPT" ? "issued" : "draft" })}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
              <p className="k" style={{ marginBottom: 3 }}>Client</p>
              <input className="input w-full" placeholder="Client name *" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
              <div style={{ height: 6 }} />
              <p className="k" style={{ marginBottom: 3 }}>Phone (for M-Pesa receipts)</p>
              <input className="input w-full" placeholder="Client phone — +2547…" value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
              <div style={{ height: 6 }} />
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <p className="k" style={{ marginBottom: 3 }}>Due date</p>
                  <input className="input w-full" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="k" style={{ marginBottom: 3 }}>Status</p>
                  <select className="input w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(form.kind === "INVOICE" || form.kind === "RECEIPT") && (
                <>
                  <div style={{ height: 6 }} />
                  <p className="k" style={{ marginBottom: 3 }}>Money — payment channel & code</p>
                  <div className="flex gap-1" role="group" aria-label="Payment channel">
                    {(["MPESA", "BANK"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`btn flex-1 ${form.pay_method === m ? "text-cyan-300" : ""}`}
                        style={form.pay_method === m ? { borderColor: "rgba(34,211,238,0.55)", background: "rgba(34,211,238,0.1)" } : undefined}
                        onClick={() => setForm({ ...form, pay_method: m })}
                      >
                        {m === "MPESA" ? "M-PESA" : "BANK"}
                      </button>
                    ))}
                  </div>
                  <div style={{ height: 6 }} />
                  <input
                    className="input w-full num"
                    inputMode="numeric"
                    placeholder={form.pay_method === "MPESA" ? "Paybill / till number" : "Bank code / account reference"}
                    value={form.pay_code}
                    onChange={(e) => setForm({ ...form, pay_code: e.target.value })}
                  />
                  <p className="mono text-[10px] mt-1" style={{ color: "var(--ink-faint)" }}>
                    KES {fmt(grand)} {form.pay_method === "MPESA" ? "via M-Pesa" : "via bank transfer"} — prints on the PDF payment block
                  </p>
                </>
              )}

              <p className="k" style={{ margin: "10px 0 3px" }}>Line items — KES</p>
              <div className="flex gap-1 px-0.5">
                <span className="k" style={{ flex: 3 }}>Item</span>
                <span className="k num" style={{ flex: 1, textAlign: "right" }}>Qty</span>
                <span className="k num" style={{ flex: 1.5, textAlign: "right" }}>Price (KES)</span>
                <span style={{ flex: "0 0 30px" }} />
              </div>
              {form.items.map((it, idx) => (
                <div key={idx} className="flex gap-1">
                  <input
                    className="input flex-[3] !py-1 !text-xs"
                    placeholder={`Item ${idx + 1} description`}
                    value={it.description}
                    onChange={(e) => setItem(idx, { description: e.target.value })}
                  />
                  <input
                    className="input flex-1 !py-1 !text-xs num"
                    placeholder="Qty"
                    value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value })}
                  />
                  <input
                    className="input flex-[1.5] !py-1 !text-xs num"
                    placeholder="Price"
                    value={it.unit_price}
                    onChange={(e) => setItem(idx, { unit_price: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-deny !py-1 !px-2"
                    title="Remove item"
                    onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn w-full !py-1"
                onClick={() => setForm((f) => ({ ...f, items: [...f.items, { description: "", qty: "1", unit_price: "" }] }))}
              >
                ＋ ADD ITEM
              </button>

              <div className="flex gap-2 items-center pt-1">
                <span className="k">Tax %</span>
                <input className="input w-14 num" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} />
                <span className="k">Subtotal</span>
                <span className="num text-sm text-cyan-300">KES {fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-1" style={{ borderColor: "var(--line)" }}>
                <span className="k">Total — KES</span>
                <span className="num text-lg text-amber-300 glow-gold">{fmt(grand)}</span>
              </div>

              <div className="flex gap-2 pt-1">
                <button className="btn flex-1" type="submit" disabled={saving}>
                  {saving ? "SAVING…" : editing ? "SAVE CHANGES" : `CREATE ${form.kind}`}
                </button>
                {editing && (
                  <button className="btn btn-deny" type="button" onClick={() => setForm(EMPTY_FORM)}>
                    CANCEL
                  </button>
                )}
              </div>
              {msg && (
                <p className="mono text-[11px] mt-1" style={{ color: msg.ok ? "var(--good)" : "var(--bad)" }}>
                  {msg.ok ? "✓" : "✕"} {msg.text}
                </p>
              )}
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
