import { discoverMcpTools, loadMcpConfig, addMcpServer, removeMcpServer, resetMcpCache } from "@/lib/mcp";
import { resetMcpCache as resetAgentToolCache } from "@/lib/agent";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const cfg = loadMcpConfig();
  const { tools, errors } = await discoverMcpTools();
  return Response.json({
    servers: Object.keys(cfg.mcpServers),
    configured: Object.entries(cfg.mcpServers).map(([name, s]) => ({ name, command: `${s.command} ${(s.args ?? []).join(" ")}`.trim() })),
    tools: tools.map((t) => ({ name: t.name, server: t.server, description: t.description.slice(0, 120) })),
    errors,
  });
}

/**
 * MCP manager: add/remove/reconnect servers live. The config file is the source
 * of truth (jarvis.mcp.json), clients reconnect on demand, and the agent's tool
 * cache is dropped so the new tools reach JARVIS on the very next message.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    command?: string;
    args?: unknown;
    env?: Record<string, string>;
  };

  let changed: string | null = null;
  try {
    if (body.action === "add" && body.name && body.command) {
      await addMcpServer(String(body.name), String(body.command), Array.isArray(body.args) ? body.args.map(String) : [], body.env);
      changed = `added ${body.name}`;
      logActivity("MCP_SERVER_ADDED", String(body.name));
    } else if (body.action === "remove" && body.name) {
      const ok = await removeMcpServer(String(body.name));
      changed = ok ? `removed ${body.name}` : `not found: ${body.name}`;
      if (ok) logActivity("MCP_SERVER_REMOVED", String(body.name));
    } else if (body.action === "reconnect") {
      changed = "reconnected all";
    }
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  await resetMcpCache(); // drop cached MCP clients → fresh discovery
  resetAgentToolCache(); // drop cached agent tool list → JARVIS sees new tools
  const { tools, errors } = await discoverMcpTools();
  return Response.json({
    ok: true,
    changed,
    reconnected: true,
    toolCount: tools.length,
    servers: Object.keys(loadMcpConfig().mcpServers),
    errors,
  });
}
