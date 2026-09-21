import { listConnections, upsertConnection, removeConnection, browserAvailable } from "@/lib/reach";
import { discoverMcpTools } from "@/lib/mcp";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const browser = await browserAvailable();
  const { tools } = await discoverMcpTools();
  return Response.json({
    connections: listConnections(),
    browser_available: browser,
    mcp_tools_live: tools.length,
    guide: {
      linkedin:
        "Browser → linkedin.com → DevTools (F12) → Application → Cookies → https://www.linkedin.com → copy the value of 'li_at'. JARVIS uses it as your logged-in session.",
      x: "Browser → x.com → DevTools → Application → Cookies → copy 'auth_token'.",
      facebook: "Browser → facebook.com → DevTools → Application → Cookies → copy 'c_user' together with 'xs' (format: c_user value, then xs value).",
      instagram: "Browser → instagram.com → DevTools → Application → Cookies → copy 'sessionid'.",
      tiktok: "Browser → tiktok.com → DevTools → Application → Cookies → copy 'sessionid'.",
      youtube: "Connect through Google: add the google-drive/gmail MCP server in Fleet & MCP, or paste a YouTube session cookie (SID).",
      telegram: "Create a bot with @BotFather, then paste the bot token (format 123456:ABC-DEF...).",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    platform?: string;
    handle?: string;
    credential?: string;
  };

  if (body.action === "remove" && body.platform) {
    const ok = removeConnection(String(body.platform));
    return Response.json({ ok, connections: listConnections() });
  }
  if (body.platform && body.credential) {
    const c = upsertConnection({
      platform: String(body.platform).toLowerCase(),
      handle: String(body.handle ?? ""),
      status: "connected",
      auth: String(body.credential),
    });
    logActivity("CONNECTION_SAVED", `${c.platform} connected via dashboard`);
    return Response.json({ ok: true, connections: listConnections() });
  }
  return Response.json({ ok: false, error: "platform and credential required" }, { status: 400 });
}
