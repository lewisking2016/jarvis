#!/usr/bin/env node
/**
 * PUSH OMNIROUTE STATE — ensure the provider connections (with current keys
 * from .env) and the JARVIS combos exist on an OmniRoute instance.
 *
 * Usage:
 *   node deploy/push-omr-state.mjs local   → localhost:20128
 *   node deploy/push-omr-state.mjs vps     → VPS over an SSH reverse tunnel
 *
 * Provider keys come from .env (never hardcoded — this file is in git).
 */
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  if (m[2] === "HOST") HOST = m[3].trim();
  else if (m[2] === "USER") USER = m[3].trim();
  else if (m[2] === "PASS") PASS = m[3].trim();
}
const APP_KEY = (fs.readFileSync(".env", "utf8").match(/^OMNIROUTE_API_KEY=(.+)$/m) || [, ""])[1].trim();
const OR_KEY = (fs.readFileSync(".env", "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m) || [, ""])[1].trim();

/* ── desired state (keys from .env) ─────────────────────────────────────── */

const envKey = (name) => (fs.readFileSync(".env", "utf8").match(new RegExp(`^${name}=(.+)$`, "m")) || [, ""])[1].trim();

const PROVIDERS = [
  { provider: "moonshot", name: "main", apiKey: envKey("MOONSHOT_API_KEY") },
  { provider: "deepseek", name: "main", apiKey: envKey("DEEPSEEK_API_KEY") },
  { provider: "cheaperinference", name: "main", apiKey: envKey("CHEAPERINFERENCE_API_KEY") },
  { provider: "huggingface", name: "main", apiKey: envKey("HUGGINGFACE_API_KEY") },
  { provider: "nvidia", name: "main", apiKey: envKey("NVIDIA_API_KEY") },
  ...(OR_KEY ? [{ provider: "openrouter", name: "main", apiKey: OR_KEY }] : []),
].filter((p) => p.apiKey);

const M = (model, providerId) => ({ kind: "model", model: `${providerId}/${model}`, providerId });

/* verified-live NVIDIA heads (probed via integrate.api.nvidia.com) */
const NVIDIA_HEADS = [
  M("nemotron-3-super-120b-a12b", "nvidia"),
  M("gpt-oss-20b", "nvidia"),
  M("nemotron-3-ultra-550b-a55b", "nvidia"),
  M("deepseek-v4-flash-0731", "nvidia"),
];

const COMBOS = [
  {
    name: "jarvis-pro",
    strategy: "priority",
    capabilities: { multimodal: true, reasoning: true, caching: true },
    models: [
      M("kimi-k2.6", "moonshot"),
      M("claude-opus-4.8", "cheaperinference"),
      M("gpt-5.6-sol", "cheaperinference"),
      M("gemini-3.1-pro", "cheaperinference"),
      M("deepseek-v4-pro", "deepseek"),
      M("glm-5.2", "cheaperinference"),
      M("kimi-k3", "cheaperinference"),
      M("free", "openrouter"),
      ...NVIDIA_HEADS,
      M("deepseek-ai/DeepSeek-V3", "huggingface"),
    ],
  },
  {
    name: "jarvis-fast",
    strategy: "priority",
    capabilities: { multimodal: false, reasoning: true, caching: true },
    models: [
      M("gemini-3.1-flash-lite", "cheaperinference"),
      M("gemini-3-flash-preview", "cheaperinference"),
      M("deepseek-flash", "deepseek"),
      M("gpt-5.4-mini", "cheaperinference"),
      M("kimi-k2.7-code", "moonshot"),
      M("gpt-oss-20b", "nvidia"),
      M("nemotron-3-super-120b-a12b", "nvidia"),
      M("glm-5.2:free", "openrouter"),
      M("ling-3.0-flash-fin:free", "openrouter"),
    ],
  },
  {
    name: "jarvis-coder",
    strategy: "priority",
    capabilities: { multimodal: false, reasoning: true, caching: true },
    models: [
      M("kimi-k2.7-code", "moonshot"),
      M("claude-sonnet-5", "cheaperinference"),
      M("deepseek-v4-flash", "cheaperinference"),
      M("gpt-5.4", "cheaperinference"),
      M("deepseek-v4-pro", "deepseek"),
      M("deepseek-v4-flash-0731", "nvidia"),
      M("gpt-oss-20b", "nvidia"),
      M("north-mini-code:free", "openrouter"),
      M("big-pickle", "opencode"),
    ],
  },
  {
    name: "jarvis-free",
    replace: true, /* full rewrite: working providers first, capped tail last */
    strategy: "priority",
    capabilities: { multimodal: false, reasoning: true, caching: false },
    models: [
      M("nemotron-3-super-120b-a12b", "nvidia"),
      M("gpt-oss-20b", "nvidia"),
      M("nemotron-3-ultra-550b-a55b", "nvidia"),
      M("deepseek-v4-flash-0731", "nvidia"),
      M("deepseek-ai/DeepSeek-V3", "huggingface"),
      M("kimi-k2.6", "moonshot"),
      M("free", "openrouter"),
      M("glm-5.2:free", "openrouter"),
      M("ling-3.0-flash-fin:free", "openrouter"),
      M("deepseek-flash", "deepseek"),
    ],
  },
];

const JARVIS_HEADS = [
  M("kimi-k2.6", "moonshot"),
  M("claude-opus-4.8", "cheaperinference"),
  M("gpt-5.6-sol", "cheaperinference"),
  M("deepseek-v4-pro", "deepseek"),
  M("gemini-3.1-flash-lite", "cheaperinference"),
  M("nemotron-3-super-120b-a12b", "nvidia"),
];

/* ── transport ──────────────────────────────────────────────────────────── */

const mode = process.argv[2] || "vps";
let cleanupTunnel = () => {};
let closeConn = () => {};

async function makeApi() {
  if (mode === "local") {
    return async function api(method, path, body) {
      const r = await fetch(`http://localhost:20128${path}`, {
        method,
        headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, json, text };
    };
  }
  const conn = new SSHClient();
  await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
    host: HOST, port: 22, username: USER, password: PASS,
    readyTimeout: 25000, keepaliveInterval: 10000,
  }));
  closeConn = () => conn.end();
  const server = net.createServer((sock) => {
    conn.forwardOut("127.0.0.1", 0, "127.0.0.1", 20128, (err, stream) => {
      if (err) { sock.destroy(); return; }
      sock.pipe(stream).pipe(sock);
    });
  });
  const port = await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res(server.address().port));
  });
  cleanupTunnel = () => server.close();
  return async function api(method, path, body) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
}

const api = await makeApi();
console.log(`── OmniRoute state sync → ${mode}`);

try {
  /* 1. provider connections: add missing, rotate key if changed */
  const provs = await api("GET", "/api/providers");
  const conns = provs.json?.connections || [];
  const byProv = new Map(conns.map((c) => [c.provider, c]));
  for (const p of PROVIDERS) {
    const cur = byProv.get(p.provider);
    if (!cur) {
      const r = await api("POST", "/api/providers", p);
      console.log(`  provider ${p.provider}: ${r.status === 201 || r.status === 200 ? "ADDED" : "ERR " + r.status} ${(r.text || "").slice(0, 80)}`);
    } else if (cur.apiKey && cur.apiKey !== p.apiKey) {
      const r = await api("PUT", `/api/providers/${cur.id}`, { ...cur, apiKey: p.apiKey });
      console.log(`  provider ${p.provider}: KEY ROTATED ${r.status === 200 || r.status === 201 ? "OK" : "ERR " + r.status} ${(r.text || "").slice(0, 80)}`);
    } else {
      console.log(`  provider ${p.provider}: already current`);
    }
  }

  /* 2. upsert combos (merge new heads in, keep working order) */
  const existing = await api("GET", "/api/combos");
  const byName = new Map((existing.json?.combos || []).map((c) => [c.name, c]));
  for (const combo of COMBOS) {
    const cur = byName.get(combo.name);
    if (cur) {
      const have = new Set((cur.models || []).map((m) => m.model));
      const merged = combo.replace
        ? combo.models
        : [...(cur.models || []), ...combo.models.filter((m) => !have.has(m.model))];
      const r = await api("PUT", `/api/combos/${cur.id}`, { ...combo, models: merged });
      console.log(`  combo ${combo.name}: ${r.status === 200 || r.status === 201 ? "OK" : "ERR " + r.status} → ${merged.length} models${r.status >= 400 ? " " + (r.text || "").slice(0, 120) : ""}`);
    } else {
      const r = await api("POST", "/api/combos", combo);
      console.log(`  combo ${combo.name}: ${r.status === 200 || r.status === 201 ? "CREATED" : "ERR " + r.status} → ${combo.models.length} models${r.status >= 400 ? " " + (r.text || "").slice(0, 120) : ""}`);
    }
  }

  /* 3. upgrade legacy jarvis combo */
  const curJ = byName.get("jarvis");
  if (curJ) {
    const curModels = (curJ.models || []).map((m) => ({ kind: m.kind || "model", model: m.model, providerId: m.providerId }));
    const haveKeys = new Set(curModels.map((m) => m.model));
    const merged = [...JARVIS_HEADS.filter((h) => !haveKeys.has(h.model)), ...curModels];
    const r = await api("PUT", `/api/combos/${curJ.id}`, {
      name: "jarvis",
      strategy: curJ.strategy || "priority",
      models: merged,
      capabilities: curJ.capabilities || { multimodal: false, reasoning: true, caching: false },
    });
    console.log(`  combo jarvis (upgraded): ${r.status === 200 || r.status === 201 ? "OK" : "ERR " + r.status} → ${merged.length} models`);
  }

  /* 4. verify */
  const after = await api("GET", "/api/combos");
  const list = after.json?.combos || [];
  const pv = await api("GET", "/api/providers");
  console.log(`\n── Providers (${(pv.json?.connections || []).length}): ${(pv.json?.connections || []).map((c) => c.provider).join(", ")}`);
  console.log(`── Combos (${list.length}):`);
  for (const c of list) console.log(`  ${(c.name || "?").padEnd(14)} ${c.strategy || "?"}  ${(c.models || []).length} models`);
} finally {
  cleanupTunnel();
  closeConn();
}
console.log(`\nDONE — ${mode} OmniRoute state ensured.`);
