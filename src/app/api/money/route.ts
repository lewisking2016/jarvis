import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { insertTransaction, matchPayment, issueReceipt, parseMpesaSms, financialStatus } from "@/lib/money";
import { createApproval } from "@/lib/approvals";

export const runtime = "nodejs";

/** GET /api/money?limit=50 — transactions + status */
export async function GET(req: NextRequest): Promise<Response> {
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 60));
  const db = getDb();
  const rows = db.prepare("SELECT * FROM transactions ORDER BY occurred_at DESC LIMIT ?").all(limit);
  const docs = db.prepare("SELECT kind, number, client, total, status, due_date FROM documents WHERE kind IN ('INVOICE','RECEIPT') ORDER BY id DESC LIMIT 30").all();
  return Response.json({ transactions: rows, invoices: docs, fin: financialStatus() });
}

/** POST /api/money — record a payment/expense manually */
export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.amount !== "number") return Response.json({ error: "amount (number) required" }, { status: 400 });
  const direction = b.direction === "out" ? "out" : "in";
  const tx = insertTransaction({
    direction,
    amount: b.amount,
    counterparty: b.counterparty ? String(b.counterparty) : null,
    counterparty_phone: b.phone ? String(b.phone) : null,
    category: b.category ? String(b.category) : direction === "in" ? "revenue_in" : null,
    source: "manual",
    ref: b.ref ? String(b.ref) : null,
  });
  return Response.json({ ok: true, id: tx.id });
}

/** PUT /api/money — reconcile a transaction to an invoice (used by approvals) */
export async function PUT(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { tx_id?: number; invoice_id?: number };
  if (!b.tx_id || !b.invoice_id) return Response.json({ error: "tx_id and invoice_id required" }, { status: 400 });
  const db = getDb();
  const tx = db.prepare("SELECT amount FROM transactions WHERE id = ?").get(b.tx_id) as { amount: number } | undefined;
  if (!tx) return Response.json({ error: "transaction not found" }, { status: 404 });
  const receipt = issueReceipt(b.invoice_id, tx.amount, b.tx_id);
  return Response.json({ ok: true, receipt: receipt.number });
}
