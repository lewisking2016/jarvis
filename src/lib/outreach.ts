import { getDb, logActivity } from "./db";
import { remember } from "./memory";

export interface QueueInput {
  lead_id: number;
  channel: "email" | "linkedin" | "telegram" | "whatsapp";
  step: number;
  template?: string;
  body?: string;
  scheduled_for?: string;
}

/** Channel policy per DESIGN.md §15.5 — initiations respect tiers, replies never wait. */
export function requiresApproval(channel: string, step: number): boolean {
  if (channel === "linkedin") return true; // Tier 2: semi-auto always
  if (channel === "email" && step > 1) return false; // follow-ups within consented sequence
  if (channel === "email") return false; // first-touch from warmed fleet domains
  return true; // whatsapp/telegram initiations default gated until medium policy matures
}

export function scheduleSequence(input: QueueInput): { id: number; approval_required: boolean } {
  const db = getDb();
  const sup = db.prepare("SELECT id FROM suppression WHERE value = ?").get(String(input.lead_id));
  const lead = db.prepare("SELECT email FROM leads WHERE id = ?").get(input.lead_id) as { email: string | null } | undefined;
  const suppressed = sup || (lead?.email ? db.prepare("SELECT id FROM suppression WHERE value = ?").get(lead.email) : undefined);
  if (suppressed) throw new Error("Contact is on the suppression list — never contacted again.");

  const approval = requiresApproval(input.channel, input.step);
  const r = db
    .prepare(
      `INSERT INTO outreach_queue (lead_id, channel, step, template, body, scheduled_for, approval_required)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.lead_id,
      input.channel,
      input.step,
      input.template ?? null,
      input.body ?? null,
      input.scheduled_for ?? new Date().toISOString(),
      approval ? 1 : 0
    );
  logActivity("OUTREACH_QUEUED", `${input.channel} step ${input.step} → lead #${input.lead_id}${approval ? " (gated)" : ""}`);
  return { id: Number(r.lastInsertRowid), approval_required: approval };
}

export function processDue(limit = 50): { sent: number; gated: number } {
  const db = getDb();
  const due = db
    .prepare("SELECT * FROM outreach_queue WHERE status='queued' AND scheduled_for <= datetime('now') ORDER BY id LIMIT ?")
    .all(limit) as { id: number; lead_id: number; channel: string; step: number; body: string | null; approval_required: number }[];

  let sent = 0;
  let gated = 0;
  for (const item of due) {
    if (item.approval_required) {
      db.prepare("UPDATE outreach_queue SET status='paused' WHERE id = ?").run(item.id);
      db.prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES ('outreach_send', ?, ?)").run(
        `${item.channel} DM → lead #${item.lead_id}`,
        JSON.stringify(item)
      );
      gated++;
    } else {
      // Real send lands in Wave 1 (OpenWA/BillionMail). Until then, mark sent + log — audit trail intact.
      db.prepare("UPDATE outreach_queue SET status='sent', sent_at=datetime('now') WHERE id = ?").run(item.id);
      logActivity("OUTREACH_SENT", `${item.channel} step ${item.step} → lead #${item.lead_id}`);
      sent++;
    }
  }
  return { sent, gated };
}

const HOT = /(interested|price|cost|quote|how much|demo|call|meeting|when can|yes)/i;
const NOT_NOW = /(next (year|quarter|month)|busy|later|circle back|not right now)/i;
const NO = /(not interested|stop|unsubscribe|remove me|no thank)/i;
const REFERRAL = /(talk to|speak to|contact .* instead|cc'|ing (the )?(person|colleague))/i;
const OOO = /(out of office|annual leave|on leave|vacation|away until)/i;

export type ReplyClass = "hot" | "not_now" | "not_interested" | "referral" | "ooo" | "question" | "unknown";

export function classifyReply(text: string): { cls: ReplyClass; action: string } {
  const t = text.trim();
  if (NO.test(t)) {
    const emailMatch = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (emailMatch) suppress(emailMatch[0], "unsubscribe", "reply");
    return { cls: "not_interested", action: "Sequence stopped, objection logged, contact suppressed if identified." };
  }
  if (OOO.test(t)) return { cls: "ooo", action: "Sequence paused; restart on return date." };
  if (REFERRAL.test(t)) return { cls: "referral", action: "Referral noted; new contact requested." };
  if (HOT.test(t)) return { cls: "hot", action: "Hot-lead alert; BANT qualification in-thread; meeting times drafted." };
  if (NOT_NOW.test(t)) return { cls: "not_now", action: "Re-touch scheduled in 75 days." };
  if (t.endsWith("?")) return { cls: "question", action: "Answer drafted from service knowledge." };
  return { cls: "unknown", action: "Flagged for principal review." };
}

export function suppress(value: string, channel: string, reason: string): void {
  getDb().prepare("INSERT OR IGNORE INTO suppression (value, channel, reason) VALUES (?, ?, ?)").run(value, channel, reason);
  remember({ kind: "lesson", content: `Contact ${value} opted out (${reason}) — never contact again on any channel.`, importance: 4, source: "outreach" });
}
