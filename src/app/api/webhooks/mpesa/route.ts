import { NextRequest } from "next/server";
import { parseMpesaSms, insertTransaction, matchPayment, issueReceipt } from "@/lib/money";
import { createApproval } from "@/lib/approvals";
import { getDb } from "@/lib/db";
import crypto from "node:crypto";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/mpesa
 * Receives forwarded M-Pesa SMS (Android bridge) or Daraja C2B confirmations.
 * Auth: header `x-jarvis-token` must equal MPESA_WEBHOOK_TOKEN env.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.MPESA_WEBHOOK_TOKEN;
  const provided = req.headers.get("x-jarvis-token");
  if (!token || !provided || !timingSafeEqual(provided, token)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = String(body.message ?? body.text ?? body.raw ?? "");
  if (!raw) return Response.json({ error: "message/text/raw required" }, { status: 400 });

  const parsed = parseMpesaSms(raw);
  if (!parsed) {
    getDb().prepare("INSERT INTO activity (action, detail) VALUES ('MPESA_UNPARSED', ?)").run(raw.slice(0, 160));
    return Response.json({ ok: false, reason: "unrecognized format" }, { status: 422 });
  }

  const tx = insertTransaction({
    direction: parsed.direction,
    amount: parsed.amount,
    tx_type: parsed.tx_type,
    counterparty: parsed.counterparty,
    counterparty_phone: parsed.counterparty_phone,
    source: "mpesa",
    ref: parsed.ref,
    raw_sms: raw,
    balance: parsed.balance,
    occurred_at: parsed.occurred_at,
  });

  if (tx.dup) return Response.json({ ok: true, duplicate: true, id: tx.id });

  let result: Record<string, unknown> = { tx_id: tx.id };
  if (parsed.direction === "in") {
    const match = matchPayment(parsed.amount, parsed.counterparty_phone, parsed.counterparty);
    if (match.confidence === "high" && match.invoice) {
      const receipt = issueReceipt(match.invoice.id, parsed.amount, tx.id);
      result = { ...result, reconciled: match.invoice.number, receipt: receipt.number };
    } else if (match.confidence === "medium" && match.invoice) {
      createApproval(
        "reconcile_payment",
        `KES ${parsed.amount} from ${parsed.counterparty ?? parsed.counterparty_phone ?? "?"} — matches ${match.invoice.number} (${match.invoice.client}) by amount only. Reconcile?`,
        { tx_id: tx.id, invoice_id: match.invoice.id, amount: parsed.amount }
      );
      result = { ...result, needs_confirmation: match.invoice.number };
    } else {
      getDb().prepare("INSERT INTO tasks (title, priority) VALUES (?, 'high')").run(
        `Identify payment: KES ${parsed.amount} from ${parsed.counterparty ?? parsed.counterparty_phone ?? "unknown"} (tx #${tx.id})`
      );
      result = { ...result, unmatched: true };
    }
  }

  return Response.json({ ok: true, ...result });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
