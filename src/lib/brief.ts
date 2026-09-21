import { getDb, logActivity } from "./db";
import { financialStatus } from "./money";
import { revenueStatus } from "./revenue";
import { sendWhatsApp, principalWhatsApp, whatsappConfigured } from "./comms";
import { sendEmail } from "./email";
import { remember } from "./memory";

/**
 * MORNING VOICE — the 08:00 Nairobi brief, in JARVIS's own spoken voice.
 *
 * 1. COMPOSE — real numbers, no filler: money in/out, receivables, revenue pace,
 *    today's tasks and follow-ups, open approvals, anything that needs the
 *    principal's decision. Written in the learned writing voice.
 * 2. DELIVER — WhatsApp text + WhatsApp VOICE NOTE (his neural voice) when the
 *    Cloud API is configured; falls back to callmebot text; email formal always
 *    gets a copy so the brief is never lost.
 * 3. SCHEDULE — 08:00 Africa/Nairobi daily from ensureScheduler().
 */

interface Brief {
  date: string;
  text: string;
  spoken: string;
}

function nairobiNow(): Date {
  // EAT = UTC+3 year-round (no DST in Kenya)
  return new Date(Date.now() + 3 * 3600_000);
}

export async function composeBrief(): Promise<Brief> {
  const db = getDb();
  const today = nairobiNow().toISOString().slice(0, 10);

  // money
  let moneyLine = "Money: ledger quiet.";
  try {
    const f = financialStatus();
    moneyLine = `Money: KES ${Number(f.today_in).toLocaleString("en-US")} in today · KES ${Number(f.month_in).toLocaleString("en-US")} this month · KES ${Number(f.receivables).toLocaleString("en-US")} receivable${f.receivables_overdue ? ` (KES ${Number(f.receivables_overdue).toLocaleString("en-US")} overdue)` : ""}.`;
  } catch { /* keep default */ }

  // revenue pace
  let paceLine = "";
  try {
    const r = revenueStatus();
    paceLine = `Quarter pace: ${Math.round(r.pct)}% of KES ${r.target.toLocaleString("en-US")} target${r.pace_delta_pct < -5 ? " — behind, worth a push" : r.pace_delta_pct > 5 ? " — ahead of schedule" : ""}.`;
  } catch { /* optional */ }

  // today's tasks + follow-ups
  let tasksLine = "Today: nothing scheduled.";
  try {
    const tasks = db
      .prepare("SELECT title, priority FROM tasks WHERE status = 'open' AND (due <= ? OR due IS NULL) ORDER BY priority = 'high' DESC, due LIMIT 6")
      .all(today) as { title: string; priority: string }[];
    if (tasks.length) tasksLine = `Today (${tasks.length}): ${tasks.map((t) => `${t.priority === "high" ? "‼️ " : ""}${t.title.slice(0, 60)}`).join(" · ")}`;
  } catch { /* keep default */ }

  // open approvals
  let approvalsLine = "";
  try {
    const n = (db.prepare("SELECT count(*) c FROM approvals WHERE status = 'pending'").get() as { c: number }).c;
    if (n > 0) approvalsLine = `⚠️ ${n} approval${n === 1 ? "" : "s"} waiting on you.`;
  } catch { /* optional */ }

  // unreconciled payments (money in without a matched document)
  let unmatchLine = "";
  try {
    const n = (db.prepare("SELECT count(*) c FROM transactions WHERE direction='in' AND (linked_doc IS NULL OR linked_doc='') AND occurred_at >= date('now','-7 days')").get() as { c: number }).c;
    if (n > 0) unmatchLine = `💡 ${n} payment${n === 1 ? "" : "s"} this week not yet matched to an invoice — want me to identify them?`;
  } catch { /* optional */ }

  const greeting = `Good morning, sir. ${nairobiNow().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.`;
  const text = [greeting, moneyLine, paceLine, tasksLine, approvalsLine, unmatchLine]
    .filter(Boolean)
    .join("\n");

  const spoken = `${greeting} ${moneyLine} ${paceLine} ${tasksLine} ${approvalsLine} ${unmatchLine}`.replace(/\s+/g, " ").trim();
  return { date: today, text, spoken };
}

/** Compose + deliver the brief through every channel that is configured. */
export async function sendMorningBrief(): Promise<{ delivered: string[]; brief: Brief }> {
  const brief = await composeBrief();
  const delivered: string[] = [];

  // 1. WhatsApp text + voice note
  const waTo = principalWhatsApp();
  const waMode = whatsappConfigured();
  if (waTo && waMode) {
    const t = await sendWhatsApp(waTo, brief.text);
    if (t.ok) delivered.push(`whatsapp-text:${waMode}`);
    if (waMode === "cloud") {
      const v = await sendWhatsApp(waTo, brief.spoken, { voice: true });
      if (v.ok) delivered.push("whatsapp-voice");
    }
  }

  // 2. email copy (formal mailbox) — never lose the brief
  try {
    await sendEmail({
      to: "info@imeantech.com",
      subject: `JARVIS morning brief — ${brief.date}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;white-space:pre-wrap">${brief.text}</div>`,
      mailbox: "formal",
    });
    delivered.push("email");
  } catch { /* mail down: WhatsApp already tried */ }

  logActivity("MORNING_BRIEF", `delivered: ${delivered.join(",") || "none configured"}`);
  void remember({ kind: "event", content: `Morning brief ${brief.date} delivered via ${delivered.join(",") || "no channel"}.`, importance: 1, source: "brief" });
  return { delivered, brief };
}

let briefStarted = false;
/** 08:00 Africa/Nairobi daily (= 05:00 UTC). Called from ensureScheduler(). */
export function ensureMorningBriefScheduler(): void {
  if (briefStarted) return;
  briefStarted = true;
  const schedule = (): void => {
    // compute ms until next 05:00 UTC (08:00 EAT)
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(5, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    setTimeout(() => {
      void sendMorningBrief().catch(() => {});
      schedule();
    }, next.getTime() - now.getTime());
  };
  schedule();
}
