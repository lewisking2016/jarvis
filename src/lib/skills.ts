import { getDb } from "./db";
import { financialStatus } from "./money";
import { revenueStatus } from "./revenue";
import { sendEmail, type Mailbox } from "./email";
import { sendWhatsApp, createLinkedinDraft, scheduleFollowup } from "./comms";
import type { ToolDef } from "./types";

/**
 * SKILL LIBRARY — research, computation and briefing capabilities beyond the
 * core CRM/ERP tools. Keeps JARVIS from improvising when the principal asks
 * for facts, math or a full operational picture.
 */

/* ---------------- Web research (free, no key) ---------------- */

interface DdgResult {
  firsturl?: string;
  text?: string;
  snippet?: string;
}

/** Tier 2 — DuckDuckGo HTML endpoint (no key, direct scrape). */
async function ddgSearch(query: string, limit = 6): Promise<{ results: { title: string; url: string; snippet: string }[] }> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  const html = await res.text();

  const results: { title: string; url: string; snippet: string }[] = [];
  const blocks = html.split('class="result__body"').slice(1);
  for (const b of blocks) {
    if (results.length >= limit) break;
    const linkMatch = b.match(/href="([^"]*uddg=[^"]*)"/);
    const titleMatch = b.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch || !titleMatch) continue;
    try {
      const raw = new URL("https://duckduckgo.com" + linkMatch[1]);
      const url = raw.searchParams.get("uddg") ?? raw.toString();
      const strip = (s: string): string => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      results.push({ title: strip(titleMatch[1]).slice(0, 140), url: decodeURIComponent(url), snippet: snippetMatch ? strip(snippetMatch[1]).slice(0, 240) : "" });
    } catch {
      /* skip malformed */
    }
  }
  if (!results.length) throw new Error("no results parsed");
  return { results };
}

/** Tier 1 — Exa neural search via agent-reach (mcporter). Tolerant parser of its tool output. */
async function exaSearch(query: string, limit = 6): Promise<{ results: { title: string; url: string; snippet: string }[] }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run(
    "mcporter",
    ["call", "exa.web_search_exa(query: " + JSON.stringify(query) + ", numResults: " + Math.min(limit, 8) + ")"],
    { timeout: 25_000, windowsHide: true }
  );
  const results: { title: string; url: string; snippet: string }[] = [];
  try {
    const j = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1));
    const arr = Array.isArray(j) ? j : ((j.results ?? j.data ?? []) as Record<string, unknown>[]);
    for (const r of arr) {
      if (r.url || r.link)
        results.push({
          title: String(r.title ?? "").slice(0, 140),
          url: String(r.url ?? r.link),
          snippet: String(r.text ?? r.snippet ?? "").slice(0, 240),
        });
    }
  } catch {
    for (const block of stdout.split(/\n\s*\n/)) {
      const urlM = block.match(/https?:\/\/[^\s)>"']+/);
      if (!urlM) continue;
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("http") && !/^[•\-*]/.test(l));
      results.push({ title: (lines[0] ?? urlM[0]).slice(0, 140), url: urlM[0], snippet: lines.slice(1).join(" ").slice(0, 240) });
    }
  }
  if (!results.length) throw new Error("exa returned nothing parseable");
  return { results: results.slice(0, limit) };
}

/** Public entry — agent-reach Exa first (neural relevance), DuckDuckGo fallback. */
export async function webSearch(query: string, limit = 6): Promise<{ results: { title: string; url: string; snippet: string }[] }> {
  try {
    return await exaSearch(query, limit);
  } catch {
    return ddgSearch(query, limit);
  }
}

/** Read a URL and extract readable text (HTML tags, scripts and styles stripped). */
export async function webFetchText(url: string, maxChars = 4000): Promise<{ url: string; title: string; text: string }> {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("only http(s) URLs allowed");

  // Tier 1 — Jina Reader (agent-reach web channel): clean extraction, no key, handles JS-heavy pages.
  try {
    const jr = await fetch("https://r.jina.ai/" + u.toString(), {
      headers: { "User-Agent": "agent-reach/1.0 (JARVIS research)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (jr.ok) {
      const md = await jr.text();
      const titleM = md.match(/^Title:\s*(.+)$/m);
      const body = md
        .replace(/^Title:.*$/m, "")
        .replace(/^URL Source:.*$/m, "")
        .replace(/^Markdown Content:\s*/m, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .trim();
      if (body.length > 80)
        return { url: u.toString(), title: titleM ? titleM[1].trim().slice(0, 140) : "", text: body.slice(0, maxChars) };
    }
  } catch {
    /* fall through to direct fetch */
  }

  const res = await fetch(u.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const ctype = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/(xhtml|json|xml)/.test(ctype)) throw new Error(`unreadable content-type: ${ctype}`);

  const raw = await res.text();
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  return { url: u.toString(), title: titleMatch ? titleMatch[1].trim().slice(0, 140) : "", text };
}

/* ---------------- Precise arithmetic ---------------- */

/**
 * Safe arithmetic evaluator: whitelist tokenizer + shunting-yard, no eval.
 * Supports + - * / % ^ and parentheses.
 */
export function calculate(expr: string): { expr: string; value: number } {
  const cleaned = expr.replace(/\s+/g, "");
  if (!/^[-+*/%^().0-9,]+$/.test(cleaned)) throw new Error("expression contains non-arithmetic characters");
  if (cleaned.length > 300) throw new Error("expression too long");

  const tokens: string[] = [];
  const num = /(\d+\.?\d*)/y;
  let i = 0;
  while (i < cleaned.length) {
    num.lastIndex = i;
    const m = num.exec(cleaned);
    if (m) {
      tokens.push(m[1]);
      i += m[1].length;
      continue;
    }
    tokens.push(cleaned[i]);
    i++;
  }

  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  const output: string[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (/^\d/.test(t)) output.push(t);
    else if (t === "(") ops.push(t);
    else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
      if (!ops.length) throw new Error("unbalanced parentheses");
      ops.pop();
    } else {
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[t]) output.push(ops.pop()!);
      ops.push(t);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") throw new Error("unbalanced parentheses");
    output.push(op);
  }

  const stack: number[] = [];
  for (const t of output) {
    if (/^\d/.test(t)) stack.push(parseFloat(t));
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("malformed expression");
      switch (t) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "%": stack.push(a % b); break;
        case "^": stack.push(a ** b); break;
        default: throw new Error(`unknown operator ${t}`);
      }
    }
  }
  const value = stack.pop();
  if (value === undefined || !Number.isFinite(value)) throw new Error("no finite result");
  return { expr: cleaned, value };
}

/* ---------------- Daily briefing composer ---------------- */

export async function composeDailyBriefing(): Promise<Record<string, unknown>> {
  const db = getDb();
  const fin = financialStatus();
  const rev = revenueStatus();
  const openTasks = db.prepare("SELECT id, title, due, priority FROM tasks WHERE status='open' ORDER BY due IS NULL, due LIMIT 10").all();
  const pendingApprovals = db.prepare("SELECT id, kind, summary FROM approvals WHERE status='pending' ORDER BY id DESC LIMIT 10").all();
  const todayActs = db
    .prepare("SELECT action, detail, created_at FROM activity WHERE created_at >= date('now') ORDER BY id DESC LIMIT 20")
    .all();
  const unidentified = db
    .prepare("SELECT COUNT(*) c FROM tasks WHERE status='open' AND title LIKE 'Identify payment%'")
    .get() as { c: number };

  return {
    money: fin,
    revenue_mission: rev,
    open_tasks: openTasks,
    pending_approvals: pendingApprovals,
    unidentified_payments: unidentified.c,
    today_activity: todayActs,
    directive: "Compose a tight executive briefing: money pulse first, mission pace second, what awaits the principal's decision third, then today's leverage actions.",
  };
}

/* ---------------- Tool definitions ---------------- */

export const SKILL_TOOLS: ToolDef[] = [
  {
    name: "web_search",
    description: "Search the live web for facts, market intel, prospect research. Returns titles, URLs and snippets.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", description: "1-8, default 6" } },
      required: ["query"],
    },
    handler: (a) => webSearch(String(a.query), typeof a.limit === "number" ? Math.min(8, Math.max(1, a.limit)) : 6),
  },
  {
    name: "web_fetch",
    description: "Read a specific URL and return its readable text. Use after web_search to read a promising result.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, max_chars: { type: "integer", description: "default 4000" } },
      required: ["url"],
    },
    handler: (a) => webFetchText(String(a.url), typeof a.max_chars === "number" ? Math.min(12000, Math.max(500, a.max_chars)) : 4000),
  },
  {
    name: "calculate",
    description: "Evaluate arithmetic precisely: totals, margins, percentages, projections, quotes math.",
    parameters: { type: "object", properties: { expression: { type: "string", description: "e.g. (42000*3)*1.16" } }, required: ["expression"] },
    handler: (a) => calculate(String(a.expression)),
  },
  {
    name: "daily_briefing",
    description: "Compose the full operational picture: money pulse, revenue mission pace, open tasks, pending approvals, today's activity.",
    parameters: { type: "object", properties: {} },
    handler: () => composeDailyBriefing(),
  },
  {
    name: "send_email",
    description:
      "Send an email through IMT's SMTP. mailbox 'formal' (default) uses admin@imeantech.com for quotations, invoices, receipts and serious correspondence; 'marketing' uses info@imeantech.com for campaigns and outreach (policy-gated sends). Optionally attach a QUOTE/INVOICE/RECEIPT PDF by its document id.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "recipient email address" },
        subject: { type: "string" },
        body: { type: "string", description: "email body; plain text or simple HTML (<p>, <b>, <ul>)" },
        mailbox: { type: "string", enum: ["formal", "marketing"] },
        doc_id: { type: "integer", description: "attach this document's PDF (quote/invoice/receipt)" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async (a) => {
      const { sendEmail, emailShell } = await import("./email");
      const mailbox = a.mailbox === "marketing" ? "marketing" : "formal";
      const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
      if (a.doc_id !== undefined) {
        const { getDb } = await import("./db");
        const { renderDocumentPdf } = await import("./pdf");
        const row = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(Number(a.doc_id)) as Record<string, unknown> | undefined;
        if (!row) throw new Error(`document ${a.doc_id} not found`);
        const pdf = await renderDocumentPdf(row as unknown as import("./pdf").DocRow);
        attachments.push({ filename: `${String(row.number)}.pdf`, content: pdf, contentType: "application/pdf" });
      }
      const body = String(a.body);
      const title = String(a.subject);
      const isHtml = /<\w+[^>]*>/.test(body);
      const html = emailShell(title, isHtml ? body : body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join(""));
      const r = await sendEmail({
        to: String(a.to),
        subject: title,
        html,
        text: body,
        mailbox,
        attachments: attachments.length ? attachments : undefined,
      });
      return { ok: true, mailbox, from: r.from, messageId: r.messageId, attachment: attachments[0]?.filename ?? null };
    },
  },
  {
    name: "send_whatsapp",
    description:
      "Send a WhatsApp message to the principal's registered number — urgent alerts, status briefs, confirmations. Requires WHATSAPP_PHONE + WHATSAPP_APIKEY in .env; if missing, returns the 2-minute setup instructions.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    handler: async (a) => {
      const { sendWhatsApp } = await import("./comms");
      const r = await sendWhatsApp(process.env.WHATSAPP_PHONE ?? "", String(a.text ?? ""));
      return r.ok ? "WhatsApp delivered to the principal." : ("WhatsApp failed: " + r.detail);
    },
  },
  {
    name: "draft_linkedin_dm",
    description:
      "Draft a LinkedIn outreach DM for the principal to approve. LinkedIn has no free official send API, so nothing is sent autonomously — it creates an approval; the actual sending happens through the browser tools against a logged-in session after the principal approves.",
    parameters: {
      type: "object",
      properties: { company: { type: "string" }, contact: { type: "string" }, message: { type: "string" } },
      required: ["company", "message"],
    },
    handler: async (a) => {
      const { createLinkedinDraft } = await import("./comms");
      const r = createLinkedinDraft(String(a.company ?? ""), a.contact ? String(a.contact) : null, String(a.message ?? ""));
      return "LinkedIn DM drafted for " + a.company + " — approval #" + r.approvalId + " created. Sends only after principal approval.";
    },
  },
  {
    name: "schedule_followup",
    description:
      "Schedule a dated follow-up (email / whatsapp / linkedin / call) about a lead, quote or deal so nothing is ever dropped. Lands on the task list.",
    parameters: {
      type: "object",
      properties: { about: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, channel: { type: "string" } },
      required: ["about", "due"],
    },
    handler: (a) => {
      const { scheduleFollowup } = require("./comms");
      const r = scheduleFollowup(String(a.about ?? ""), String(a.due ?? new Date().toISOString().slice(0, 10)), String(a.channel ?? "email"));
      return "Follow-up scheduled for " + a.due + " — task #" + r.taskId + ".";
    },
  },
];
