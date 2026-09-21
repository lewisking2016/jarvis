import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getDb, nextDocNumber, logActivity } from "./db";
import { insertTransaction, financialStatus, matchPayment, issueReceipt, round2 } from "./money";
import { revenueStatus } from "./revenue";
import { scheduleSequence, classifyReply } from "./outreach";
import { createApproval } from "./approvals";
import { remember, recall } from "./memory";
import { runDistiller } from "./distiller";
import type { ToolDef } from "./types";

const execAsync = promisify(exec);

export const BUILT_IN_TOOLS: ToolDef[] = [
  /* ---------------- CRM ---------------- */
  {
    name: "add_lead",
    description: "Record a new prospect/lead in the CRM.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string" },
        contact: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        source: { type: "string", description: "e.g. referral, website, linkedin, osint, openoutreach" },
        score: { type: "integer", description: "Qualification score 0-100" },
        notes: { type: "string" },
      },
      required: ["company"],
    },
    handler: (a) => {
      const r = getDb()
        .prepare("INSERT INTO leads (company, contact, email, phone, source, score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(String(a.company), a.contact ? String(a.contact) : null, a.email ? String(a.email) : null, a.phone ? String(a.phone) : null, a.source ? String(a.source) : null, typeof a.score === "number" ? a.score : 0, a.notes ? String(a.notes) : null);
      logActivity("LEAD_ADDED", `${a.company} (score ${a.score ?? 0})`);
      return { ok: true, id: Number(r.lastInsertRowid) };
    },
  },
  {
    name: "list_leads",
    description: "List leads, optionally filtered by status.",
    parameters: { type: "object", properties: { status: { type: "string", description: "new|contacted|replied|meeting|quoted|won|lost" } } },
    handler: (a) => {
      const db = getDb();
      const rows = a.status
        ? db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY score DESC").all(String(a.status))
        : db.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 100").all();
      return { leads: rows };
    },
  },
  {
    name: "update_lead_status",
    description: "Move a lead to a new pipeline status.",
    parameters: { type: "object", properties: { id: { type: "integer" }, status: { type: "string" } }, required: ["id", "status"] },
    handler: (a) => {
      getDb().prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(String(a.status), Number(a.id));
      logActivity("LEAD_UPDATED", `#${a.id} -> ${a.status}`);
      return { ok: true };
    },
  },
  {
    name: "score_lead",
    description: "Score a lead with BANT (Budget, Authority, Need, Timeline). Stores the scorecard.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer" },
        budget: { type: "string", description: "Evidence of budget" },
        authority: { type: "string", description: "Evidence of decision authority" },
        need: { type: "string" },
        timeline: { type: "string" },
      },
      required: ["id", "budget", "authority", "need", "timeline"],
    },
    handler: (a) => {
      const dims = [a.budget, a.authority, a.need, a.timeline].map((v) => String(v));
      const strong = dims.filter((d) => /yes|clear|confirmed|stated|strong/i.test(d)).length;
      const partial = dims.filter((d) => /partial|maybe|unclear|some/i.test(d)).length;
      const score = Math.min(100, strong * 22 + partial * 8);
      const bant = JSON.stringify({ budget: a.budget, authority: a.authority, need: a.need, timeline: a.timeline, score });
      getDb().prepare("UPDATE leads SET score = ?, bant = ?, updated_at = datetime('now') WHERE id = ?").run(score, bant, Number(a.id));
      logActivity("LEAD_SCORED", `#${a.id} BANT score ${score}`);
      return { ok: true, score, verdict: score >= 60 ? "qualified — pursue now" : score >= 35 ? "nurture" : "low priority" };
    },
  },

  /* ---------------- Documents & payments ---------------- */
  {
    name: "create_document",
    description: "Create a QUOTE or INVOICE with line items. Totals and numbers are computed automatically. Reason the principal's free-form wording into these fields (dates, quantities, prices); only kind/client/items are required — everything else has a default: tax_rate 0, due_date +14 days, currency KES.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["QUOTE", "INVOICE"] },
        client: { type: "string" },
        client_phone: { type: "string", description: "Phone used for M-Pesa reconciliation" },
        items: {
          type: "array",
          items: { type: "object", properties: { description: { type: "string" }, qty: { type: "number" }, unit_price: { type: "number" } }, required: ["description", "qty", "unit_price"] },
        },
        tax_rate: { type: "number", description: "Percent, default 0 — use only if the principal names a tax" },
        currency: { type: "string", default: "KES" },
        due_date: { type: "string", description: "YYYY-MM-DD. COMPUTE from phrases like 'end of month', 'by Friday', 'net 30'; default +14 days from today" },
      },
      required: ["kind", "client", "items"],
    },
    handler: (a) => {
      const items = (a.items as { description: string; qty: number; unit_price: number }[]) ?? [];
      if (!items.length) throw new Error("At least one line item is required");
      const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const taxRate = typeof a.tax_rate === "number" ? a.tax_rate : 0;
      const total = round2(subtotal * (1 + taxRate / 100));
      const kind = a.kind === "INVOICE" ? "INVOICE" : "QUOTE";
      const number = nextDocNumber(kind);
      getDb()
        .prepare("INSERT INTO documents (kind, number, client, client_phone, items_json, currency, tax_rate, total, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(kind, number, String(a.client), a.client_phone ? String(a.client_phone) : null, JSON.stringify(items), a.currency ? String(a.currency) : "KES", taxRate, total, kind === "INVOICE" ? "sent" : "draft", a.due_date ? String(a.due_date) : null);
      logActivity("DOC_CREATED", `${number} ${a.client} — ${total}`);
      return { ok: true, number, subtotal: round2(subtotal), tax: round2((subtotal * taxRate) / 100), total };
    },
  },
  {
    name: "list_documents",
    description: "List quotes, invoices and receipts.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["QUOTE", "INVOICE", "RECEIPT"] } } },
    handler: (a) => {
      const db = getDb();
      const rows = (
        a.kind
          ? db.prepare("SELECT * FROM documents WHERE kind = ? ORDER BY id DESC LIMIT 50").all(String(a.kind))
          : db.prepare("SELECT * FROM documents ORDER BY id DESC LIMIT 50").all()
      ) as Record<string, unknown>[];
      return { documents: rows.map((r) => ({ ...r, items: JSON.parse(String(r.items_json)) })) };
    },
  },
  {
    name: "record_payment",
    description: "Record a received payment; auto-reconciles against open invoices and issues a receipt on confident match.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number" },
        phone: { type: "string" },
        counterparty: { type: "string" },
        ref: { type: "string", description: "M-Pesa code" },
        raw_sms: { type: "string" },
        occurred_at: { type: "string" },
      },
      required: ["amount"],
    },
    handler: (a) => {
      const amount = Number(a.amount);
      const tx = insertTransaction({
        direction: "in",
        amount,
        tx_type: "receive",
        counterparty: a.counterparty ? String(a.counterparty) : null,
        counterparty_phone: a.phone ? String(a.phone) : null,
        category: "revenue_in",
        source: a.raw_sms ? "mpesa" : "manual",
        ref: a.ref ? String(a.ref) : null,
        raw_sms: a.raw_sms ? String(a.raw_sms) : null,
        occurred_at: a.occurred_at ? String(a.occurred_at) : undefined,
      });
      const match = matchPayment(amount, a.phone ? String(a.phone) : null, a.counterparty ? String(a.counterparty) : null);
      if (match.confidence === "high" && match.invoice) {
        const receipt = issueReceipt(match.invoice.id, amount, tx.id);
        return { ok: true, tx_id: tx.id, reconciled: match.invoice.number, receipt: receipt.number };
      }
      if (match.confidence === "medium" && match.invoice) {
        createApproval("reconcile_payment", `KES ${amount} — matches ${match.invoice.number} (${match.invoice.client}) by amount only. Approve to reconcile?`, { tx_id: tx.id, invoice_id: match.invoice.id, amount });
        return { ok: true, tx_id: tx.id, needs_confirmation: match.invoice.number };
      }
      const r = getDb().prepare("INSERT INTO tasks (title, priority) VALUES (?, 'high')").run(`Identify payment: KES ${amount} from ${a.counterparty ?? a.phone ?? "unknown"} (tx #${tx.id})`);
      return { ok: true, tx_id: tx.id, unmatched_task: Number(r.lastInsertRowid) };
    },
  },
  {
    name: "record_expense",
    description: "Record an outgoing expense (M-Pesa or otherwise).",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number" },
        counterparty: { type: "string" },
        category: { type: "string", description: "utilities|connectivity|rent|salary|transport|fees|hardware|other" },
        ref: { type: "string" },
        raw_sms: { type: "string" },
      },
      required: ["amount"],
    },
    handler: (a) => {
      const r = insertTransaction({
        direction: "out",
        amount: Number(a.amount),
        tx_type: a.category === "fees" ? "fee" : "payment",
        counterparty: a.counterparty ? String(a.counterparty) : null,
        category: a.category ? String(a.category) : null,
        source: a.raw_sms ? "mpesa" : "manual",
        ref: a.ref ? String(a.ref) : null,
        raw_sms: a.raw_sms ? String(a.raw_sms) : null,
      });
      return { ok: true, tx_id: r.id };
    },
  },
  {
    name: "financial_status",
    description: "Full money briefing: cash in/out (today/week/month), fees, balance, receivables, category breakdown.",
    parameters: { type: "object", properties: {} },
    handler: () => financialStatus(),
  },
  {
    name: "revenue_status",
    description: "Q4 revenue mission status: target, earned, pace delta, required daily rate, forecast, top actions.",
    parameters: { type: "object", properties: {} },
    handler: () => revenueStatus(),
  },

  /* ---------------- Outreach ---------------- */
  {
    name: "schedule_outreach",
    description: "Queue an outreach touch (email/linkedin/telegram/whatsapp). LinkedIn and channel initiations are auto-gated for approval per policy.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "integer" },
        channel: { type: "string", enum: ["email", "linkedin", "telegram", "whatsapp"] },
        step: { type: "integer", description: "Sequence step (1=first touch)" },
        template: { type: "string" },
        body: { type: "string", description: "The personalized message" },
        scheduled_for: { type: "string", description: "ISO datetime; default now" },
      },
      required: ["lead_id", "channel"],
    },
    handler: (a) => {
      const res = scheduleSequence({
        lead_id: Number(a.lead_id),
        channel: a.channel as "email" | "linkedin" | "telegram" | "whatsapp",
        step: typeof a.step === "number" ? a.step : 1,
        template: a.template ? String(a.template) : undefined,
        body: a.body ? String(a.body) : undefined,
        scheduled_for: a.scheduled_for ? String(a.scheduled_for) : undefined,
      });
      return { ok: true, ...res };
    },
  },
  {
    name: "classify_reply",
    description: "Classify an inbound reply (hot / not_now / not_interested / referral / ooo / question) and get the prescribed action.",
    parameters: { type: "object", properties: { text: { type: "string" }, lead_id: { type: "integer" } }, required: ["text"] },
    handler: (a) => {
      const res = classifyReply(String(a.text));
      logActivity("REPLY_CLASSIFIED", `${res.cls}: ${String(a.text).slice(0, 80)}`);
      return res;
    },
  },

  /* ---------------- Approvals ---------------- */
  {
    name: "create_approval",
    description: "Create an approval request for the principal (sends, reconciliations, public posts, campaigns).",
    parameters: {
      type: "object",
      properties: { kind: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } },
      required: ["kind", "summary"],
    },
    handler: (a) => {
      const id = createApproval(String(a.kind), String(a.summary), a.payload);
      return { ok: true, id, note: "Awaiting the principal's yes in Approvals." };
    },
  },

  /* ---------------- Memory ---------------- */
  {
    name: "remember",
    description: "Store a durable memory: fact, decision, preference, event, lesson, or relationship.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "decision", "preference", "event", "lesson", "relationship"] },
        content: { type: "string", description: "One atomic, self-contained statement" },
        entities: { type: "array", items: { type: "string" }, description: "e.g. [\"lead:3\",\"client:acme\"]" },
        importance: { type: "integer", description: "1-5" },
      },
      required: ["kind", "content"],
    },
    handler: (a) => {
      const r = remember({
        kind: a.kind as "fact",
        content: String(a.content),
        entities: Array.isArray(a.entities) ? (a.entities as string[]) : undefined,
        importance: typeof a.importance === "number" ? a.importance : 2,
        source: "agent",
      });
      return { ok: true, id: r.id, deduped: r.deduped };
    },
  },
  {
    name: "recall",
    description: "Search long-term memory for facts, decisions, lessons about a topic.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    handler: (a) => ({ memories: recall(String(a.query), 8) }),
  },
  {
    name: "run_distiller",
    description: "Run the memory distiller now: condense recent activity into durable memories (normally runs nightly at 03:00).",
    parameters: { type: "object", properties: {} },
    handler: () => runDistiller(),
  },

  /* ---------------- Tasks & notes ---------------- */
  {
    name: "add_task",
    description: "Add a task or follow-up with optional due date and priority.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, due: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] } },
      required: ["title"],
    },
    handler: (a) => {
      const r = getDb().prepare("INSERT INTO tasks (title, due, priority) VALUES (?, ?, ?)").run(String(a.title), a.due ? String(a.due) : null, a.priority ? String(a.priority) : "normal");
      logActivity("TASK_ADDED", String(a.title));
      return { ok: true, id: Number(r.lastInsertRowid) };
    },
  },
  {
    name: "list_tasks",
    description: "List tasks (default: open).",
    parameters: { type: "object", properties: { status: { type: "string" } } },
    handler: (a) => {
      const status = a.status ? String(a.status) : "open";
      return { tasks: getDb().prepare("SELECT * FROM tasks WHERE status = ? ORDER BY due IS NULL, due").all(status) };
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done.",
    parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    handler: (a) => {
      getDb().prepare("UPDATE tasks SET status='done', completed_at=datetime('now') WHERE id=?").run(Number(a.id));
      logActivity("TASK_DONE", `#${a.id}`);
      return { ok: true };
    },
  },
  {
    name: "add_note",
    description: "Store a note, briefing or meeting summary.",
    parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title", "content"] },
    handler: (a) => {
      const r = getDb().prepare("INSERT INTO notes (title, content) VALUES (?, ?)").run(String(a.title), String(a.content));
      logActivity("NOTE_ADDED", String(a.title));
      return { ok: true, id: Number(r.lastInsertRowid) };
    },
  },
  {
    name: "search_notes",
    description: "Search notes by keyword.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    handler: (a) => ({
      notes: getDb().prepare("SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY id DESC LIMIT 20").all(`%${a.query}%`, `%${a.query}%`),
    }),
  },
  {
    name: "system_report",
    description: "Machine and platform health report.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const db = getDb();
      const counts = {
        leads: (db.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c,
        documents: (db.prepare("SELECT COUNT(*) c FROM documents").get() as { c: number }).c,
        transactions: (db.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }).c,
        open_tasks: (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='open'").get() as { c: number }).c,
        memories: (db.prepare("SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL").get() as { c: number }).c,
        pending_approvals: (db.prepare("SELECT COUNT(*) c FROM approvals WHERE status='pending'").get() as { c: number }).c,
      };
      let gitBranch = "unknown";
      try {
        const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD");
        gitBranch = stdout.trim();
      } catch { /* not a repo */ }
      return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        cpu: { model: os.cpus()[0]?.model, cores: os.cpus().length, load: os.loadavg() },
        memory: { total_gb: round2(os.totalmem() / 2 ** 30), free_gb: round2(os.freemem() / 2 ** 30) },
        uptime_hours: round2(os.uptime() / 3600),
        git_branch: gitBranch,
        database: counts,
      };
    },
  },
];
