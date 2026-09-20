import { discoverMcpTools, loadMcpConfig } from "@/lib/mcp";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = getDb();
  const workers = db.prepare("SELECT * FROM workers ORDER BY id").all();
  const cfg = loadMcpConfig();
  const { tools, errors } = await discoverMcpTools();
  return Response.json({
    workers,
    servers: Object.keys(cfg.mcpServers),
    configured: Object.entries(cfg.mcpServers).map(([name, s]) => ({ name, command: `${s.command} ${(s.args ?? []).join(" ")}`.trim() })),
    tools: tools.map((t) => ({ name: t.name, server: t.server })),
    errors,
  });
}
