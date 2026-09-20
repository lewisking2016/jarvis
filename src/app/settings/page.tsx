"use client";

import { useState } from "react";
import { Panel, Badge, Empty, PageHeader } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/useApi";

interface SelfCheckReport {
  ran_at: string;
  verdict: string;
  brains: { healthy: number; total: number; capped: boolean };
  mcp: { servers: number; tools: number; errors: string[] };
  smtp: { marketing: boolean; formal: boolean };
}
interface Sys {
  hostname: string; platform: string; cpu: { cores: number; model: string }; memory: { total_gb: number; used_pct: number };
  uptime_hours: number; provider: string; model: string;
  brain?: {
    active: string; gemini_tier: boolean; local_tier: boolean; catalog_rerank: string;
    chain: { id: string; breaker: boolean }[];
  };
}
interface Mcp { servers?: string[]; configured?: { name: string; command: string }[]; tools?: { name: string }[]; errors?: string[] }

export default function SettingsPage() {
  const [seedMsg, setSeedMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");
  const sysApi = useApi<Sys>("/api/system");
  const mcpApi = useApi<Mcp>("/api/mcp");
  const checkApi = useApi<{ last: SelfCheckReport | null }>("/api/selfcheck");
  const sys = sysApi.data;
  const mcp = mcpApi.data;
  const last = checkApi.data?.last ?? null;

  const runNow = async (): Promise<void> => {
    setChecking(true);
    setCheckMsg("Probing every brain, MCP server and mailbox…");
    try {
      const r = await apiFetch<{ report: SelfCheckReport }>("/api/selfcheck", { method: "POST" });
      setCheckMsg(r.report.verdict.slice(0, 160));
      checkApi.reload();
      sysApi.reload();
    } catch (err) {
      setCheckMsg(err instanceof Error ? err.message : "Self-check failed.");
    } finally {
      setChecking(false);
      setTimeout(() => setCheckMsg(""), 8000);
    }
  };

  const seed = async (): Promise<void> => {
    const res = await apiFetch<{ skipped?: boolean }>("/api/seed", { method: "POST", body: "{}" });
    setSeedMsg(res.skipped ? "Data already present — use reset below to reload demo." : "Demo dataset loaded.");
    setTimeout(() => setSeedMsg(""), 4000);
  };
  const reset = async (): Promise<void> => {
    await apiFetch("/api/seed", { method: "POST", body: JSON.stringify({ reset: true }) });
    setSeedMsg("Database reset and reseeded.");
    setTimeout(() => setSeedMsg(""), 4000);
  };

  return (
    <div>
      <PageHeader title="Settings" sub="System status, configuration and the demo dataset." />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title="Runtime">
          {sys ? (
            <ul className="mono text-xs space-y-1.5" style={{ color: "var(--ink-dim)" }}>
              <li>NODE <span className="text-slate-200">{sys.hostname}</span> — {sys.platform}</li>
              <li>CPU <span className="text-slate-200">{sys.cpu.cores} cores</span> — {sys.cpu.model?.slice(0, 30)}</li>
              <li>MEM <span className="text-slate-200">{sys.memory.used_pct}%</span> of {sys.memory.total_gb} GB</li>
              <li>UPTIME <span className="text-slate-200">{sys.uptime_hours} h</span></li>
              <li>BRAIN <span className="text-cyan-300">{sys.provider} · {sys.brain?.active ?? sys.model}</span></li>
              {sys.brain && (
                <li>POOL <span className="text-slate-200">{sys.brain.chain?.length ?? 0} free models · rerank {sys.brain.catalog_rerank}</span></li>
              )}
            </ul>
          ) : <Empty text="Scanning…" />}
          {sys?.brain && (
            <>
              <p className="k mt-4 mb-2">Failover chain (free tier)</p>
              <div className="flex flex-wrap gap-1">
                {(sys.brain.chain ?? []).map((m) => (
                  <span key={m.id} className={`badge ${m.breaker ? "badge-bad" : "badge-good"}`} title={m.id}>
                    {m.breaker ? "◎" : "●"} {m.id.split("/")[1]?.replace(":free", "")}
                  </span>
                ))}
              </div>
              <p className="mono text-[10px] mt-2" style={{ color: "var(--ink-faint)" }}>
                ● ready · ◎ cooling down · Gemini tier: {sys.brain.gemini_tier ? "armed" : "off"} · local tier: {sys.brain.local_tier ? "armed" : "off"}
              </p>
            </>
          )}
          <p className="k mt-4 mb-2">Provider checklist</p>
          <ul className="mono text-[11px] space-y-1" style={{ color: "var(--ink-dim)" }}>
            <li>· OPENROUTER_API_KEY in .env → free-model pool with auto-failover</li>
            <li>· more free keys → GEMINI_API_KEY · GROQ_API_KEY · CEREBRAS_API_KEY · GITHUB_MODELS_TOKEN · MISTRAL_API_KEY · NVIDIA_API_KEY — each joins the pool</li>
            <li>· MPESA_WEBHOOK_TOKEN in .env → Android SMS bridge auth</li>
            <li>· SMTP creds for info@imeantech.com → .env only, never git</li>
          </ul>
        </Panel>

        <Panel title="MCP config (jarvis.mcp.json)">
          {mcp && (mcp.servers ?? []).length > 0 ? (
            <>
              <p className="mono text-xs mb-2">{mcp.servers?.length ?? 0} server(s) · {mcp.tools?.length ?? 0} tools</p>
              <ul className="space-y-1">
                {(mcp.servers ?? []).map((s) => <li key={s}><Badge tone="badge-accent">{s}</Badge></li>)}
              </ul>
              {(mcp.errors ?? []).length > 0 && <p className="mono text-[10px] mt-2 text-amber-300">{mcp.errors?.[0]}</p>}
            </>
          ) : <Empty text="No servers configured." />}
          <p className="k mt-4 mb-2">Webhooks</p>
          <ul className="mono text-[11px] space-y-1" style={{ color: "var(--ink-dim)" }}>
            <li>· M-Pesa bridge → POST /api/webhooks/mpesa (x-jarvis-token)</li>
            <li>· Daraja C2B (later) → same parser, Rail B</li>
          </ul>
        </Panel>

        <Panel title="Nightly self-check (03:00)">
          {last ? (
            <>
              <p className="mono text-[11px] mb-2" style={{ color: last.verdict.startsWith("ISSUES") ? "var(--bad)" : "var(--good)" }}>
                {last.verdict}
              </p>
              <p className="k mb-1">Last run: {last.ran_at?.slice(0, 16).replace("T", " ")}</p>
              <ul className="mono text-[11px] space-y-1" style={{ color: "var(--ink-dim)" }}>
                <li>· brains: {last.brains?.healthy ?? "—"}/{last.brains?.total ?? "—"} healthy{last.brains?.capped ? " · daily allowance capped" : ""}</li>
                <li>· MCP: {last.mcp?.servers ?? 0} servers · {last.mcp?.tools ?? 0} tools {last.mcp?.errors?.length ? `· ${last.mcp.errors.length} error(s)` : "· clean"}</li>
                <li>· SMTP: marketing {last.smtp?.marketing ? "✓" : "✕"} · formal {last.smtp?.formal ? "✓" : "✕"}</li>
              </ul>
            </>
          ) : (
            <Empty text="Never run — first automatic pass at 03:00, or run now." />
          )}
          <button className="btn mt-3" onClick={() => void runNow()} disabled={checking}>
            {checking ? "CHECKING…" : "RUN SELF-CHECK NOW"}
          </button>
          {checkMsg && <p className="mono text-[11px] mt-2 text-cyan-300">{checkMsg}</p>}
        </Panel>

        <Panel title="Demo dataset">
          <p className="text-[13px] mb-3" style={{ color: "var(--ink-dim)" }}>
            Load 8 leads, quotes/invoices, a week of M-Pesa transactions, outreach queue, approvals and memories —
            so every module shows you what it can do.
          </p>
          <div className="flex gap-2">
            <button className="btn" onClick={() => void seed()}>SEED DATA</button>
            <button className="btn btn-deny" onClick={() => void reset()}>RESET & RESEED</button>
          </div>
          {seedMsg && <p className="mono text-[11px] mt-2 text-cyan-300">{seedMsg}</p>}
        </Panel>

        <Panel title="Console shortcut">
          <p className="mono text-[12px]" style={{ color: "var(--ink-dim)" }}>
            Press <span className="text-cyan-300 glow">⌘K / Ctrl+K</span> anywhere to talk to JARVIS.
            Voice: 🎙 to speak, 🔊 to hear him reply.
          </p>
        </Panel>
      </div>
    </div>
  );
}
