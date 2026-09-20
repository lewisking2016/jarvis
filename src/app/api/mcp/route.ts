import { discoverMcpTools, loadMcpConfig } from "@/lib/mcp";
import { resetMcpCache } from "@/lib/agent";

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

export async function POST(): Promise<Response> {
  resetMcpCache();
  const { tools, errors } = await discoverMcpTools();
  return Response.json({ reconnected: true, toolCount: tools.length, errors });
}
