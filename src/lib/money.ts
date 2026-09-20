import { getDb, nextDocNumber, logActivity } from "./db";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ParsedMpesa {
  direction: "in" | "out";
  tx_type: string;
  amount: number;
  counterparty: string | null;
  counterparty_phone: string | null;
  ref: string | null;
  balance: number | null;
  occurred_at: string;
}

/** Parse a Kenyan M-Pesa SMS (standard Safaricom confirmation format). */
export function parseMpesaSms(raw: string): ParsedMpesa | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!/M-PESA|mpesa/i.test(text)) return null;

  const amountM = text.match(/Ksh\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amountM) return null;
  const amount = parseFloat(amountM[1].replace(/,/g, ""));

  const refM = text.match(/\b([A-Z0-9]{8,12})\b/);
  const ref = refM ? refM[1] : null;

  const dateM = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})/i);
  let occurred_at = new Date().toISOString();
  if (dateM) {
    const [, d, mo, y, h, mi] = dateM;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    occurred_at = new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), 0)).toISOString();
  }

  const balM = text.match(/New M-PESA balance is Ksh\s*([\d,]+(?:\.\d{1,2})?)/i);
  const balance = balM ? parseFloat(balM[1].replace(/,/g, "")) : null;

  let direction: "in" | "out";
  let tx_type: string;
  let counterparty: string | null = null;
  let phone: string | null = null;

  const phoneM = text.match(/(\+?2547\d{8}|07\d{8})/);
  if (phoneM) phone = phoneM[1].startsWith("+") ? phoneM[1] : `+254${phoneM[1].slice(1)}`;

  if (/received/i.test(text)) {
    direction = "in";
    tx_type = "receive";
    const fromM = text.match(/from\s+([A-Z][A-Z\s]+?)(?:\s+\d{1,2}\/|$)/i);
    if (fromM) counterparty = fromM[1].trim();
  } else if (/sent to/i.test(text)) {
    direction = "out";
    tx_type = "send";
    const toM = text.match(/sent to\s+([A-Za-z\s]+?)(?:\s+\d{1,2}\/|$)/i);
    if (toM) counterparty = toM[1].trim();
  } else if (/paid to/i.test(text)) {
    direction = "out";
    tx_type = "paybill";
    const toM = text.match(/paid to\s+([A-Za-z0-9\s&.\-]+?)(?:\.|\s+\d{1,2}\/)/i);
    if (toM) counterparty = toM[1].trim();
  } else if (/withdraw/i.test(text)) {
    direction = "out";
    tx_type = "withdraw";
  } else if (/bought|airtime/i.test(text)) {
    direction = "out";
    tx_type = "airtime";
  } else {
    return null;
  }

  return { direction, tx_type, amount, counterparty, counterparty_phone: phone, ref, balance, occurred_at };
}

function categorize(direction: string, tx_type: string, counterparty: string | null, raw: string): string {
  const t = `${counterparty ?? ""} ${raw}`.toUpperCase();
  if (tx_type === "withdraw") return "fees";
  if (/KPLC|KENYA POWER|TOKEN/i.test(t)) return "utilities";
  if (/SAFARICOM|AIRTIME|FIBRE|FAIBA/i.test(t)) return "connectivity";
  if (/RENT/i.test(t)) return "rent";
  if (/SALARY|WAGE|STIPEND/i.test(t)) return "salary";
  if (/TRANSPORT|FUEL|BODA|TAXI|UBER/i.test(t)) return "transport";
  if (/BANK|CHARGE|FEE/i.test(t)) return "fees";
  if (/TILL|PAYBILL/i.test(t)) return "business_payment";
  return direction === "in" ? "revenue_in" : "other_expense";
}

export interface TxInput {
  direction: "in" | "out";
  amount: number;
  currency?: string;
  tx_type?: string;
  counterparty?: string | null;
  counterparty_phone?: string | null;
  category?: string | null;
  source?: string;
  ref?: string | null;
  raw_sms?: string | null;
  balance?: number | null;
  occurred_at?: string;
}

export function insertTransaction(tx: TxInput): { id: number; dup: boolean } {
  const db = getDb();
  if (tx.ref) {
    const existing = db.prepare("SELECT id FROM transactions WHERE ref = ?").get(tx.ref);
    if (existing) return { id: Number((existing as { id: number }).id), dup: true };
  }
  const category =
    tx.category ??
    categorize(tx.direction, tx.tx_type ?? "", tx.counterparty ?? null, tx.raw_sms ?? "");
  const r = db
    .prepare(
      `INSERT INTO transactions (direction, amount, currency, tx_type, counterparty, counterparty_phone, category, source, ref, raw_sms, balance, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tx.direction,
      tx.amount,
      tx.currency ?? "KES",
      tx.tx_type ?? null,
      tx.counterparty ?? null,
      tx.counterparty_phone ?? null,
      category,
      tx.source ?? "mpesa",
      tx.ref ?? null,
      tx.raw_sms ? tx.raw_sms.slice(0, 400) : null,
      typeof tx.balance === "number" ? tx.balance : null,
      tx.occurred_at ?? new Date().toISOString()
    );
  logActivity("TX_RECORDED", `${tx.direction === "in" ? "+" : "-"}KES ${tx.amount}${tx.counterparty ? ` (${tx.counterparty})` : ""}`);
  return { id: Number(r.lastInsertRowid), dup: false };
}

export interface FinancialStatus {
  today_in: number;
  today_out: number;
  week_in: number;
  week_out: number;
  month_in: number;
  month_out: number;
  fees_month: number;
  balance_estimate: number | null;
  receivables: number;
  receivables_overdue: number;
  by_category_month: { category: string; total: number }[];
}

export function financialStatus(): FinancialStatus {
  const db = getDb();
  const sumIn = (since: string): number =>
    ((db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE direction='in' AND occurred_at >= ?").get(since) as { s: number }).s);
  const sumOut = (since: string): number =>
    ((db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE direction='out' AND occurred_at >= ?").get(since) as { s: number }).s);

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 864e5).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const lastBal = db.prepare("SELECT balance FROM transactions WHERE balance IS NOT NULL ORDER BY occurred_at DESC LIMIT 1").get() as { balance: number | null } | undefined;

  const receivablesRow = db
    .prepare("SELECT COALESCE(SUM(total),0) s FROM documents WHERE kind='INVOICE' AND status IN ('sent','partial','overdue')")
    .get() as { s: number };
  const overdueRow = db
    .prepare("SELECT COALESCE(SUM(total),0) s FROM documents WHERE kind='INVOICE' AND status IN ('overdue') OR (kind='INVOICE' AND status='sent' AND due_date < date('now'))")
    .get() as { s: number };

  const byCat = db
    .prepare("SELECT category, COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) total FROM transactions WHERE occurred_at >= ? GROUP BY category ORDER BY total DESC LIMIT 6")
    .all(monthStart) as { category: string; total: number }[];

  return {
    today_in: round2(sumIn(dayStart)),
    today_out: round2(sumOut(dayStart)),
    week_in: round2(sumIn(weekStart)),
    week_out: round2(sumOut(weekStart)),
    month_in: round2(sumIn(monthStart)),
    month_out: round2(sumOut(monthStart)),
    fees_month: round2((db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE category='fees' AND occurred_at >= ?").get(monthStart) as { s: number }).s),
    balance_estimate: lastBal ? lastBal.balance : null,
    receivables: round2(receivablesRow.s),
    receivables_overdue: round2(overdueRow.s),
    by_category_month: byCat,
  };
}

/** Reconcile an incoming payment against open invoices; returns matched invoice id if confident. */
export function matchPayment(amount: number, phone: string | null, counterparty: string | null):
  { confidence: "high" | "medium" | "none"; invoice?: { id: number; number: string; client: string; total: number } } {
  const db = getDb();
  const open = db
    .prepare("SELECT id, number, client, client_phone, total FROM documents WHERE kind='INVOICE' AND status IN ('sent','partial','overdue') ORDER BY id DESC LIMIT 50")
    .all() as { id: number; number: string; client: string; client_phone: string | null; total: number }[];
  if (!open.length) return { confidence: "none" };

  if (phone) {
    const byPhone = open.find((i) => i.client_phone && i.client_phone.replace(/\s/g, "").endsWith(phone.slice(-9)));
    if (byPhone && Math.abs(byPhone.total - amount) < 1) return { confidence: "high", invoice: byPhone };
  }
  const byAmount = open.filter((i) => Math.abs(i.total - amount) < 1);
  if (byAmount.length === 1) return { confidence: "high", invoice: byAmount[0] };
  if (byAmount.length > 1) return { confidence: "medium", invoice: byAmount[0] };
  return { confidence: "none" };
}

export function issueReceipt(invoiceId: number, amount: number, txId: number): { number: string } {
  const db = getDb();
  const inv = db.prepare("SELECT number, client, client_phone FROM documents WHERE id = ?").get(invoiceId) as { number: string; client: string; client_phone: string | null } | undefined;
  const number = nextDocNumber("RECEIPT");
  db.prepare(
    `INSERT INTO documents (kind, number, client, client_phone, items_json, currency, total, status, linked_doc)
     VALUES ('RECEIPT', ?, ?, ?, ?, 'KES', ?, 'issued', ?)`
  ).run(number, inv?.client ?? "unknown", inv?.client_phone ?? null,
    JSON.stringify([{ description: `Payment for ${inv?.number ?? "invoice"}`, qty: 1, unit_price: amount, ref: `tx:${txId}` }]),
    amount, invoiceId);
  db.prepare("UPDATE documents SET status='paid' WHERE id = ?").run(invoiceId);
  logActivity("RECEIPT_ISSUED", `${number} for ${inv?.number ?? invoiceId} — KES ${amount}`);
  return { number };
}
