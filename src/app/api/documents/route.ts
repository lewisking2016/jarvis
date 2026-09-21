import { NextRequest } from "next/server";
import { getDb, nextDocNumber, logActivity } from "@/lib/db";
import { round2 } from "@/lib/money";

export const runtime = "nodejs";

interface DocItem {
  description: string;
  qty: number;
  unit_price: number;
}

function parseItems(raw: unknown): DocItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: DocItem[] = [];
  for (const it of raw) {
    if (typeof it !== "object" || it === null) return null;
    const o = it as Record<string, unknown>;
    const description = String(o.description ?? "").trim();
    const qty = Number(o.qty);
    const unit_price = Number(o.unit_price);
    if (!description || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unit_price) || unit_price < 0) {
      return null;
    }
    items.push({ description, qty, unit_price: round2(unit_price) });
  }
  return items;
}

function computeTotal(items: DocItem[], taxRate: number): number {
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  return round2(subtotal * (1 + taxRate / 100));
}

function mapRow(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, items: JSON.parse(String(r.items_json)) };
}

export async function GET(): Promise<Response> {
  const rows = getDb().prepare("SELECT * FROM documents ORDER BY id DESC LIMIT 100").all() as Record<string, unknown>[];
  return Response.json({ documents: rows.map(mapRow) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(b.kind ?? "").toUpperCase();
  if (!["QUOTE", "INVOICE", "RECEIPT"].includes(kind)) {
    return Response.json({ error: "kind must be QUOTE, INVOICE or RECEIPT" }, { status: 400 });
  }
  const client = String(b.client ?? "").trim();
  if (!client) return Response.json({ error: "client is required" }, { status: 400 });
  const items = parseItems(b.items);
  if (!items) {
    return Response.json({ error: "items must be a non-empty list of { description, qty > 0, unit_price >= 0 }" }, { status: 400 });
  }
  const taxRate = Math.max(0, Math.min(100, Number(b.tax_rate ?? 0) || 0));
  const total = computeTotal(items, taxRate);
  const number = nextDocNumber(kind as "QUOTE" | "INVOICE" | "RECEIPT");
  const status = String(b.status ?? (kind === "RECEIPT" ? "issued" : "draft")).trim() || "draft";
  const due = b.due_date ? String(b.due_date).slice(0, 10) : null;
  const phone = b.client_phone ? String(b.client_phone).trim() : null;
  const paymentInfo = b.payment_info ? String(b.payment_info).trim().slice(0, 200) || null : null;

  const r = getDb()
    .prepare(
      `INSERT INTO documents (kind, number, client, client_phone, items_json, currency, tax_rate, total, status, due_date, payment_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kind, number, client, phone, JSON.stringify(items), String(b.currency ?? "KES") || "KES", taxRate, total, status, due, paymentInfo);

  logActivity("DOC_CREATED", `${number} — ${client} — ${round2(total)} KES (${items.length} items)`, "PRINCIPAL");
  return Response.json({ document: { id: Number(r.lastInsertRowid), number, total } }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "id is required" }, { status: 400 });
  const db = getDb();
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return Response.json({ error: `document ${id} not found` }, { status: 404 });

  const next: {
    client: string;
    client_phone: string | null;
    items_json: string;
    tax_rate: number;
    total: number;
    status: string;
    due_date: string | null;
    payment_info: string | null;
  } = {
    client: String(row.client),
    client_phone: row.client_phone ? String(row.client_phone) : null,
    items_json: String(row.items_json),
    tax_rate: Number(row.tax_rate) || 0,
    total: Number(row.total) || 0,
    status: String(row.status),
    due_date: row.due_date ? String(row.due_date) : null,
    payment_info: row.payment_info ? String(row.payment_info) : null,
  };

  if (b.client !== undefined) {
    const client = String(b.client).trim();
    if (!client) return Response.json({ error: "client cannot be empty" }, { status: 400 });
    next.client = client;
  }
  if (b.client_phone !== undefined) next.client_phone = b.client_phone ? String(b.client_phone).trim() : null;
  if (b.payment_info !== undefined) next.payment_info = b.payment_info ? String(b.payment_info).trim().slice(0, 200) || null : null;
  if (b.status !== undefined) next.status = String(b.status).trim() || "draft";
  if (b.due_date !== undefined) next.due_date = b.due_date ? String(b.due_date).slice(0, 10) : null;
  if (b.tax_rate !== undefined) next.tax_rate = Math.max(0, Math.min(100, Number(b.tax_rate) || 0));
  if (b.items !== undefined) {
    const items = parseItems(b.items);
    if (!items) {
      return Response.json({ error: "items must be a non-empty list of { description, qty > 0, unit_price >= 0 }" }, { status: 400 });
    }
    next.items_json = JSON.stringify(items);
  }
  next.total = computeTotal(JSON.parse(next.items_json) as DocItem[], next.tax_rate);

  db.prepare(
    `UPDATE documents SET client = ?, client_phone = ?, items_json = ?, tax_rate = ?, total = ?, status = ?, due_date = ?, payment_info = ? WHERE id = ?`
  ).run(next.client, next.client_phone, next.items_json, next.tax_rate, next.total, next.status, next.due_date, next.payment_info, id);

  logActivity("DOC_UPDATED", `${String(row.number)} — ${String(next.client)} — ${Number(next.total).toFixed(2)} KES · status ${String(next.status)}`, "PRINCIPAL");
  return Response.json({ document: { id, number: row.number, total: next.total, status: next.status } });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "id query param is required" }, { status: 400 });
  const row = getDb().prepare("SELECT number FROM documents WHERE id = ?").get(id) as { number: string } | undefined;
  if (!row) return Response.json({ error: `document ${id} not found` }, { status: 404 });
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
  logActivity("DOC_DELETED", `${row.number}`, "PRINCIPAL");
  return Response.json({ deleted: id, number: row.number });
}
