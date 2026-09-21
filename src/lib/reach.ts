import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, logActivity } from "./db";
import { createApproval } from "./approvals";
import type { ToolDef } from "./types";

const run = promisify(execFile);

/**
 * INTERNET REACH — JARVIS's hands on the live web, beyond plain search:
 *
 *  · agent-reach channels  — Exa neural search, Jina reader, RSS (already wired
 *    into skills.ts web tools); extended here with platform reach commands.
 *  · agent-browser         — real Chromium automation: open pages, read the
 *    accessibility tree, click, fill, extract, screenshot. This is how JARVIS
 *    works sites that have no API (including logged-in social platforms).
 *  · Social connections    — credentials for LinkedIn, X, Instagram, Facebook,
 *    TikTok, YouTube stored in app_state; every autonomous post/DM lands in the
 *    Approvals queue first (nothing goes out on the principal's accounts
 *    without a human yes).
 */

const AB_TIMEOUT = 90_000;

async function ab(args: string[], timeout = AB_TIMEOUT): Promise<string> {
  const { stdout } = await run("agent-browser", args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

/** True when the agent-browser CLI is installed on this host. */
export async function browserAvailable(): Promise<boolean> {
  try {
    await run("agent-browser", ["--version"], { timeout: 8_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Social connections store                                            */
/* ------------------------------------------------------------------ */

export interface SocialConnection {
  platform: string;
  handle: string;
  status: "connected" | "disconnected";
  /** how the session authenticates — cookie value, token, or "assisted-login" */
  auth: string;
  updated_at: string;
}

const CONN_KEY = "social_connections";

export function listConnections(): SocialConnection[] {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key=?").get(CONN_KEY) as { value: string } | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.value) as SocialConnection[];
  } catch {
    return [];
  }
}

function saveConnections(list: SocialConnection[]): void {
  getDb()
    .prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(CONN_KEY, JSON.stringify(list));
}

export function upsertConnection(c: Omit<SocialConnection, "updated_at">): SocialConnection {
  const list = listConnections().filter((x) => x.platform !== c.platform);
  const full: SocialConnection = { ...c, updated_at: new Date().toISOString() };
  list.push(full);
  saveConnections(list);
  logActivity("CONNECTION_SAVED", `${c.platform} as ${c.handle || "unspecified"} (${c.status})`);
  return full;
}

export function removeConnection(platform: string): boolean {
  const before = listConnections().length;
  saveConnections(listConnections().filter((x) => x.platform !== platform));
  return listConnections().length < before;
}

/** Session cookie for a platform, if connected — used by browser actions. */
export function connectionFor(platform: string): SocialConnection | undefined {
  return listConnections().find((c) => c.platform.toLowerCase() === platform.toLowerCase() && c.status === "connected");
}

/* ------------------------------------------------------------------ */
/* Gated social actions — draft → approval → send                      */
/* ------------------------------------------------------------------ */

/** Queue a social post/DM for the principal's approval. Never sends directly. */
export function requestSocialApproval(platform: string, action: string, target: string, content: string): number {
  const conn = connectionFor(platform);
  const summary = `[${platform.toUpperCase()} ${action}] ${target ? `→ ${target}: ` : ""}${content.slice(0, 140)}`;
  return createApproval("social_post", summary, {
    platform,
    action,
    target,
    content,
    connected: Boolean(conn),
    handle: conn?.handle ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

export const REACH_TOOLS: ToolDef[] = [
  {
    name: "browser_open",
    description:
      "Open a URL in JARVIS's real Chromium browser (agent-browser) and get an accessibility snapshot of the page with @eN element refs. Use for sites with no API, logged-in platforms, and web apps.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    handler: async (a) => {
      const out = await ab(["open", String(a.url), "-i"]);
      return { snapshot: out.slice(0, 6000) };
    },
  },
  {
    name: "browser_act",
    description:
      "Act on the open page using a ref from the last snapshot: click a button/link, fill an input, or press a key. Always browser_open first to get fresh refs.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "element ref like @e5" },
        action: { type: "string", enum: ["click", "fill", "press"], description: "default click" },
        text: { type: "string", description: "text for fill, or key name for press (e.g. Enter)" },
      },
      required: ["ref"],
    },
    handler: async (a) => {
      const act = String(a.action ?? "click");
      const args = act === "fill" ? ["fill", String(a.ref), String(a.text ?? "")] : act === "press" ? ["press", String(a.text ?? "Enter")] : ["click", String(a.ref)];
      const out = await ab(args);
      const snap = await ab(["snapshot", "-i"]).catch(() => "");
      return { result: out.trim().slice(0, 500), snapshot: snap.slice(0, 6000) };
    },
  },
  {
    name: "browser_read",
    description:
      "Extract the visible text content of the current browser page (or a CSS-scoped region) — reading articles, dashboards, message threads.",
    parameters: { type: "object", properties: { selector: { type: "string", description: "optional CSS scope" } } },
    handler: async (a) => {
      const args = ["snapshot", a.selector ? ["-s", String(a.selector)] : [], "-c"].flat();
      const out = await ab(args);
      return { text: out.slice(0, 8000) };
    },
  },
  {
    name: "browser_screenshot",
    description: "Screenshot the current browser page to a file on the server and return its path.",
    parameters: { type: "object", properties: { path: { type: "string", description: "e.g. shot.png — saved under jarvis-workspace/" } } },
    handler: async (a) => {
      const file = String(a.path ?? `shot-${Date.now()}.png`);
      const safe = file.replace(/[^a-zA-Z0-9._-]/g, "-");
      await ab(["screenshot", `jarvis-workspace/${safe}`]);
      return { saved: `jarvis-workspace/${safe}` };
    },
  },
  {
    name: "web_research",
    description:
      "Deep research on a topic: run several searches (Exa neural + DuckDuckGo), read the top results, and return a distilled brief with sources. Use for market intel, competitor scans, 'find me suppliers of X', due diligence.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string" }, depth: { type: "integer", description: "results to read, 2-6, default 3" } },
      required: ["topic"],
    },
    handler: async (a) => {
      const { webSearch, webFetchText } = await import("./skills");
      const topic = String(a.topic);
      const depth = Math.min(6, Math.max(2, typeof a.depth === "number" ? a.depth : 3));
      const queries = [topic, `${topic} Kenya prices 2026`, `${topic} best providers comparison`];
      const seen = new Set<string>();
      const sources: { title: string; url: string; snippet: string }[] = [];
      for (const q of queries) {
        try {
          const r = await webSearch(q, 5);
          for (const s of r.results) {
            if (!seen.has(s.url)) {
              seen.add(s.url);
              sources.push(s);
            }
          }
        } catch {
          /* a query failing is fine */
        }
        if (sources.length >= depth * 4) break;
      }
      const readings: { url: string; title: string; text: string }[] = [];
      for (const s of sources.slice(0, depth)) {
        try {
          readings.push(await webFetchText(s.url, 3500));
        } catch {
          /* unreadable source — skip */
        }
      }
      return { topic, sources_found: sources.length, sources: sources.slice(0, 10), readings };
    },
  },
  {
    name: "list_connections",
    description: "Show every connected social/internet platform account (LinkedIn, X, Instagram…) and its status.",
    parameters: { type: "object", properties: {} },
    handler: () => ({ connections: listConnections() }),
  },
  {
    name: "connect_platform",
    description:
      "Connect a social platform account by saving its login session (e.g. LinkedIn li_at cookie, X auth_token). The principal provides the credential; JARVIS stores it and can then act on that platform through the browser — autonomous posts still require approval.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "linkedin, x, instagram, facebook, tiktok, youtube, telegram…" },
        handle: { type: "string", description: "the account name/URL" },
        credential: { type: "string", description: "session cookie or token value" },
      },
      required: ["platform", "credential"],
    },
    handler: async (a) => {
      const c = upsertConnection({
        platform: String(a.platform).toLowerCase(),
        handle: String(a.handle ?? ""),
        status: "connected",
        auth: String(a.credential),
      });
      return {
        ok: true,
        platform: c.platform,
        note: `${c.platform} connected. Browser actions on ${c.platform} can now use this session. Autonomous posts/DMs land in Approvals first — nothing posts without the principal's yes.`,
      };
    },
  },
  {
    name: "social_post",
    description:
      "Post or send a message on a connected platform (LinkedIn post/DM, tweet, etc.). Creates an APPROVAL — it sends through the browser only after the principal approves it on the Approvals page.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string" },
        action: { type: "string", description: "post | dm | comment | connect-request" },
        target: { type: "string", description: "person/page/company for DMs and comments" },
        content: { type: "string" },
      },
      required: ["platform", "action", "content"],
    },
    handler: async (a) => {
      const id = requestSocialApproval(String(a.platform), String(a.action), String(a.target ?? ""), String(a.content));
      const conn = connectionFor(String(a.platform));
      return {
        ok: true,
        approval_id: id,
        connected: Boolean(conn),
        note: conn
          ? `Queued as approval #${id}. After you approve, JARVIS executes it in the browser using your ${a.platform} session.`
          : `Queued as approval #${id} — but ${a.platform} is not connected yet. Ask the principal for the session credential (connect_platform) before the send can execute.`,
      };
    },
  },
];
