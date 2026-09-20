export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDef extends ToolDecl {
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_end"; name: string; ok: boolean; summary: string }
  | { type: "failover"; from: string; to: string; reason: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}
