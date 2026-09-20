import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { ToolDecl } from "./types";

export interface McpTool extends ToolDecl {
  server: string;
  call: (args: Record<string, unknown>) => Promise<unknown>;
  /** Unified invoker so built-in and MCP tools share one call shape. */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export const MCP_CONFIG_PATH = path.join(process.cwd(), "jarvis.mcp.json");

const clients = new Map<string, Client>();

export function loadMcpConfig(): McpConfigFile {
  if (!existsSync(MCP_CONFIG_PATH)) return { mcpServers: {} };
  try {
    const raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf8"));
    if (raw && typeof raw === "object" && raw.mcpServers) return raw as McpConfigFile;
    return { mcpServers: {} };
  } catch {
    return { mcpServers: {} };
  }
}

async function getClient(name: string, cfg: McpServerConfig): Promise<Client> {
  const existing = clients.get(name);
  if (existing) return existing;
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
  });
  const client = new Client({ name: `jarvis-${name}`, version: "1.0.0" });
  await client.connect(transport);
  clients.set(name, client);
  return client;
}

function toToolDecls(mcpTools: {
  name: string;
  description?: string;
  inputSchema?: object;
}[]): ToolDecl[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
  }));
}

/** Connect to every configured server and collect their tools. Never throws. */
export async function discoverMcpTools(): Promise<{ tools: McpTool[]; errors: string[] }> {
  const cfg = loadMcpConfig();
  const tools: McpTool[] = [];
  const errors: string[] = [];

  await Promise.all(
    Object.entries(cfg.mcpServers).map(async ([name, serverCfg]) => {
      try {
        const client = await getClient(name, serverCfg);
        const res = await client.listTools();
        for (const t of res.tools) {
          tools.push({
            name: t.name,
            description: `[${name}] ${t.description ?? ""}`.trim(),
            parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
            server: name,
            call: (args) => client.callTool({ name: t.name, arguments: args }),
            handler: (args) => client.callTool({ name: t.name, arguments: args }),
          });
        }
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  return { tools, errors };
}

export async function shutdownMcp(): Promise<void> {
  for (const [name, client] of clients) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    clients.delete(name);
  }
}
