import { getDb, logActivity } from "./db";

/**
 * COMMUNICATIONS — WhatsApp, LinkedIn, follow-ups.
 *
 * WhatsApp: CallMeBot free API (api.callmebot.com) — the principal registers their own
 * number once and gets an API key; perfect for JARVIS → principal notifications.
 * Outreach to OTHER numbers is approval-gated (never autonomous).
 *
 * LinkedIn: no free official API, and automation violates ToS — DMs are DRAFTED and
 * approval-gated; actual sending happens through the browser tools when a logged-in
 * session exists on the host machine.
 */

export interface SendResult {
  ok: boolean;
  via: string;
  detail: string;
}

export async function sendWhatsApp(to: string, text: string): Promise<SendResult> {
  const phone = to.replace(/\D/g, "");
  const key = (process.env.WHATSAPP_API_KEY ?? "").trim();
  const bound = (process.env.WHATSAPP_PHONE ?? "").replace(/\D/g, "");
  if (!key || !bound) {
    return {
      ok: false,
      via: "callmebot",
      detail:
        "WhatsApp not configured. Free setup (2 min): WhatsApp 'I allow callmebot to send me messages' to +34 644 51 95 23, then set WHATSAPP_PHONE and WHATSAPP_APIKEY in .env.",
    };
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text.slice(0, 900))}&apikey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const ok = res.ok;
    logActivity(ok ? "WHATSAPP_SENT" : "WHATSAPP_FAILED", `${phone} — ${text.slice(0, 60)}`);
    return { ok, via: "callmebot", detail: ok ? "sent" : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, via: "callmebot", detail: err instanceof Error ? err.message : "network error" };
  }
}

/** LinkedIn DMs are drafted + gated; nothing is ever sent autonomously. */
export function createLinkedinDraft(company: string, contact: string | null, message: string): { approvalId: number } {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES ('linkedin_dm', ?, ?)")
    .run(
      `LinkedIn DM → ${company}${contact ? ` (${contact})` : ""}: ${message.slice(0, 140)}`,
      JSON.stringify({ company, contact, message })
    );
  logActivity("LINKEDIN_DRAFTED", `${company} — awaiting approval`);
  return { approvalId: Number(r.lastInsertRowid) };
}

/** A dated follow-up lands on the Command Deck task list and pings the scheduler. */
export function scheduleFollowup(about: string, due: string, channel = "email"): { taskId: number } {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO tasks (title, due, priority, status) VALUES (?, ?, 'normal', 'open')")
    .run(`Follow up (${channel}): ${about.slice(0, 150)}`, due.slice(0, 10));
  logActivity("FOLLOWUP_SCHEDULED", `${channel} ${due.slice(0, 10)} — ${about.slice(0, 60)}`);
  return { taskId: Number(r.lastInsertRowid) };
}
