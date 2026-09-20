"use client";

import { Panel, Badge, Empty, PageHeader } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Worker { id: number; name: string; kind: string; jurisdiction: string | null; status: string; tasks_done: number }
interface Mcp { servers: string[]; configured: { name: string; command: string }[]; tools: { name: string; server: string; description: string }[]; errors: string[] }

const PLANNED = [
  { name: "OpenWA", role: "WhatsApp gateway (Wave 1)", status: "awaiting deploy" },
  { name: "wechat-bot", role: "Telegram/WeChat/Lark front-end (Wave 1)", status: "awaiting config" },
  { name: "Novu", role: "notification router (Wave 1)", status: "awaiting deploy" },
  { name: "OpenOutreach", role: "B2B lead agent (Wave 2)", status: "awaiting deploy" },
  { name: "BillionMail", role: "mail server + campaigns (Wave 2)", status: "awaiting SMTP" },
  { name: "CowAgent", role: "worker fleet (Wave 3)", status: "planned" },
  { name: "gastown", role: "coding agent workspace (Wave 3)", status: "planned" },
  { name: "Phantom", role: "VM co-worker (Wave 3)", status: "planned" },
  { name: "openhuman", role: "memory context via MCP (Wave 3)", status: "planned" },
];

export default function FleetPage() {
  const fleet = useApi<{ workers?: Worker[] } & Mcp>("/api/fleet", { intervalMs: 15000 });
  const workers = fleet.data?.workers ?? [];
  const mcp = fleet.data;

  const reconnect = async (): Promise<void> => {
    await apiFetch("/api/mcp", { method: "POST" });
    fleet.reload();
  };

  return (
    <div>
      <PageHeader title="Fleet & MCP" sub="The hands: tool relays connected now, harnesses planned per DESIGN.md waves."
        right={<button className="btn" onClick={() => void reconnect()}>RECONNECT MCP</button>} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title={`MCP relays — ${mcp?.tools?.length ?? 0} tools live`}>
          {mcp && (mcp.configured ?? []).length > 0 ? (
            <>
              <ul className="space-y-1 mb-3">
                {(mcp.configured ?? []).map((s) => (
                  <li key={s.name} className="flex items-center gap-2 mono text-xs">
                    <Badge tone="badge-accent">{s.name}</Badge>
                    <span className="truncate text-slate-500">{s.command}</span>
                  </li>
                ))}
              </ul>
              <div className="max-h-64 overflow-y-auto hud-scroll">
                <table className="dtable">
                  <thead><tr><th>Tool</th><th>Server</th></tr></thead>
                  <tbody>
                    {(mcp.tools ?? []).map((t) => (
                      <tr key={t.name}><td className="mono text-[11px]">{t.name}</td><td><Badge>{t.server}</Badge></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(mcp.errors ?? []).length > 0 && (
                <p className="mono text-[10px] mt-2 text-amber-300">WARN: {mcp.errors[0]}</p>
              )}
            </>
          ) : <Empty text="No MCP servers connected — add them in jarvis.mcp.json." />}
        </Panel>

        <Panel title="Worker registry">
          <table className="dtable">
            <thead><tr><th>Name</th><th>Kind</th><th>Jurisdiction</th><th>Status</th></tr></thead>
            <tbody>
              {(workers as Worker[]).map((w) => (
                <tr key={w.id}>
                  <td className="mono text-[11px]">{w.name}</td>
                  <td><Badge>{w.kind}</Badge></td>
                  <td className="text-[12px]">{w.jurisdiction ?? "—"}</td>
                  <td><Badge tone="badge-accent">{w.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(workers as Worker[]).length === 0 && <Empty text="No workers registered yet — Wave 3 brings CowAgent pods, gastown, Phantom and OpenHuman." />}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Integration roadmap (DESIGN.md waves)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {PLANNED.map((p) => (
              <div key={p.name} className="panel corner !p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[13px]">{p.name}</p>
                  <p className="k truncate">{p.role}</p>
                </div>
                <Badge>{p.status}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
