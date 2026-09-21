"use client";

import { useState } from "react";
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

const QUICK = [
  { name: "google-drive", command: "npx", args: ["-y", "@modelcontextprotocol/server-gdrive"] },
  { name: "gmail", command: "npx", args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"] },
  { name: "google-maps", command: "npx", args: ["-y", "@modelcontextprotocol/server-google-maps"] },
  { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  { name: "slack", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"] },
  { name: "puppeteer-browser", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
];

export default function FleetPage() {
  const fleet = useApi<{ workers?: Worker[] } & Mcp>("/api/fleet", { intervalMs: 15000 });
  const workers = fleet.data?.workers ?? [];
  const mcp = fleet.data;

  const [form, setForm] = useState({ name: "", command: "npx", args: "", env: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const post = async (payload: Record<string, unknown>, label: string): Promise<void> => {
    setBusy(label);
    setMsg(null);
    try {
      const r = (await apiFetch("/api/mcp", { method: "POST", body: JSON.stringify(payload) })) as { changed?: string; toolCount?: number; errors?: string[] };
      setMsg(r.errors && r.errors.length ? `${r.changed ?? label} — ${r.errors.length} server(s) failed to connect` : `${r.changed ?? label} — ${r.toolCount ?? 0} tools live`);
      fleet.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addServer = (name: string, command: string, args: string[]): void => {
    if (!name || !command) return;
    void post({ action: "add", name, command, args }, `add:${name}`);
  };

  const submitForm = (): void => {
    const args = form.args.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    let env: Record<string, string> | undefined;
    if (form.env.trim()) {
      env = {};
      for (const line of form.env.split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m) env[m[1]] = m[2].trim();
      }
    }
    void post({ action: "add", name: form.name, command: form.command, args, env }, "add:custom");
    setForm({ name: "", command: "npx", args: "", env: "" });
  };

  return (
    <div>
      <PageHeader title="Fleet & MCP" sub="The hands: tool relays connected now, harnesses planned per DESIGN.md waves."
        right={<button className="btn" onClick={() => void post({ action: "reconnect" }, "reconnect")}>{busy === "reconnect" ? "RECONNECTING…" : "RECONNECT MCP"}</button>} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title={`MCP relays — ${mcp?.tools?.length ?? 0} tools live`}>
          {mcp && (mcp.configured ?? []).length > 0 ? (
            <>
              <ul className="space-y-1 mb-3">
                {(mcp.configured ?? []).map((s) => (
                  <li key={s.name} className="flex items-center gap-2 mono text-xs">
                    <Badge tone="badge-accent">{s.name}</Badge>
                    <span className="truncate text-slate-500">{s.command}</span>
                    <button
                      className="ml-auto k hover:text-red-400 text-[10px]"
                      disabled={busy !== null}
                      onClick={() => void post({ action: "remove", name: s.name }, `rm:${s.name}`)}
                    >
                      {busy === `rm:${s.name}` ? "…" : "REMOVE"}
                    </button>
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
          ) : <Empty text="No MCP servers connected — add one below." />}
        </Panel>

        <Panel title="Connect an MCP server">
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK.map((q) => (
              <button key={q.name} className="k text-[11px] border border-[var(--line)] px-2 py-1 hover:border-cyan-400"
                disabled={busy !== null}
                onClick={() => addServer(q.name, q.command, q.args)}>
                + {q.name}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <input className="input w-full" placeholder="server name (e.g. notion)" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input w-full mono text-xs" placeholder="command (default npx)" value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })} />
            <input className="input w-full mono text-xs" placeholder="arguments, space-separated (e.g. -y @modelcontextprotocol/server-notion)" value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })} />
            <textarea className="input w-full mono text-xs h-16" placeholder={"env vars, one per line (e.g. NOTION_TOKEN=secret)"} value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })} />
            <button className="btn w-full" disabled={busy !== null || !form.name || !form.command} onClick={submitForm}>
              {busy === "add:custom" ? "CONNECTING…" : "CONNECT SERVER"}
            </button>
          </div>
          {msg && <p className="mono text-[10px] mt-2 text-cyan-300">{msg}</p>}
          <p className="k text-[10px] mt-2">Servers launch as child processes on the JARVIS host. Tools appear in his kit instantly — no restart.</p>
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
