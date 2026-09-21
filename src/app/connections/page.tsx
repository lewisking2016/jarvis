"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface Conn { platform: string; handle: string; status: string; updated_at: string }
interface Data { connections: Conn[]; browser_available: boolean; mcp_tools_live: number; guide: Record<string, string> }

const PLATFORMS = ["linkedin", "x", "instagram", "facebook", "tiktok", "youtube", "telegram"];

export default function ConnectionsPage() {
  const { data, reload } = useApi<Data>("/api/connections");
  const [form, setForm] = useState({ platform: "linkedin", handle: "", credential: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connect = (): void => {
    if (!form.credential.trim()) return;
    setBusy(true);
    setMsg(null);
    void apiFetch("/api/connections", {
      method: "POST",
      body: JSON.stringify({ action: "save", ...form, platform: form.platform.toLowerCase() }),
    })
      .then(() => {
        setMsg(`${form.platform} connected — JARVIS can now act on it with your session.`);
        setForm({ platform: form.platform, handle: "", credential: "" });
        reload();
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const remove = (platform: string): void => {
    setBusy(true);
    void apiFetch("/api/connections", { method: "POST", body: JSON.stringify({ action: "remove", platform }) })
      .then(() => reload())
      .finally(() => setBusy(false));
  };

  const connected = new Set((data?.connections ?? []).map((c) => c.platform));

  return (
    <div>
      <PageHeader
        title="Connections"
        sub="Social platforms & internet sessions JARVIS operates on your behalf. Autonomous sends are approval-gated."
        right={<Badge tone={data?.browser_available ? "badge-accent" : ""}>{data?.browser_available ? "BROWSER READY" : "BROWSER OFF"}</Badge>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title={`Connected — ${(data?.connections ?? []).length}`}>
          {(data?.connections ?? []).length === 0 && <Empty text="Nothing connected yet. Add your first platform →" />}
          <ul className="space-y-2">
            {(data?.connections ?? []).map((c) => (
              <li key={c.platform} className="panel corner !p-3 flex items-center gap-3">
                <Badge tone="badge-accent">{c.platform}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] truncate">{c.handle || "(no handle saved)"}</p>
                  <p className="k text-[10px]">connected {new Date(c.updated_at).toLocaleDateString()}</p>
                </div>
                <button className="k hover:text-red-400 text-[10px]" disabled={busy} onClick={() => remove(c.platform)}>
                  REMOVE
                </button>
              </li>
            ))}
          </ul>
          {msg && <p className="mono text-[10px] mt-3 text-cyan-300">{msg}</p>}
        </Panel>

        <Panel title="Connect a platform">
          <div className="flex flex-wrap gap-2 mb-3">
            {PLATFORMS.map((p) => (
              <button key={p}
                className={`k text-[11px] border px-2 py-1 ${form.platform === p ? "border-cyan-400 text-cyan-300" : "border-[var(--line)]"} ${connected.has(p) ? "opacity-50" : ""}`}
                onClick={() => setForm({ ...form, platform: p })}>
                {connected.has(p) ? "✓ " : "+ "}{p}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <input className="input w-full" placeholder="handle or profile URL (optional)" value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })} />
            <input className="input w-full mono text-xs" placeholder="session credential (cookie value or token)" value={form.credential}
              onChange={(e) => setForm({ ...form, credential: e.target.value })} />
            <button className="btn w-full" disabled={busy || !form.credential.trim()} onClick={connect}>CONNECT</button>
          </div>
          {data?.guide?.[form.platform] && (
            <p className="k text-[11px] mt-3 leading-relaxed border border-[var(--line)] p-2">{data.guide[form.platform]}</p>
          )}
        </Panel>

        <Panel title="How JARVIS uses these">
          <ul className="space-y-2 text-[13px] leading-relaxed list-disc pl-4">
            <li><b>Research:</b> web_research runs Exa search + reads real pages; the browser tools open anything a search can't reach.</li>
            <li><b>Acting:</b> with a connected session, JARVIS opens the platform in his browser as you — reads threads, drafts DMs, prepares posts.</li>
            <li><b>Gate:</b> nothing posts or sends autonomously. Every outward action lands in <b>Approvals</b> first; you press yes, then it executes.</li>
            <li><b>MCP:</b> deeper platform integrations (Google Drive, Gmail, Maps…) live in <b>Fleet &amp; MCP</b> — same principle, official APIs.</li>
          </ul>
          <p className="k text-[10px] mt-3">{data?.mcp_tools_live ?? 0} MCP tools live · credentials stored server-side only, never in chat history.</p>
        </Panel>
      </div>
    </div>
  );
}
