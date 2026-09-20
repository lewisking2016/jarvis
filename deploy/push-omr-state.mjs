#!/usr/bin/env node
/**
 * PUSH OMNIROUTE STATE (API mode) — replicate the local OmniRoute provider
 * connections + JARVIS combos onto the VPS through its own management API,
 * tunneled over a single SSH connection. No multi-MB file transfer.
 *
 * Steps: ensure server up → add missing providers → upsert 4 combos →
 * upgrade `jarvis` combo → verify → live brain test.
 *
 * Run: node deploy/push-omr-state.mjs
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
  const k = m[2], v = m[3].trim();
  if (k === "HOST") HOST = v;
  else if (k === "USER") USER = v;
  else if (k === "PASS") PASS = v;
}
const APP_KEY = (fs.readFileSync(".env", "utf8").match(/^OMNIROUTE_API_KEY=(.+)$/m) || [, ""])[1].trim();
const OR_KEY = (fs.readFileSync(".env", "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m) || [, ""])[1].trim();

/* ── desired state (mirror of local) ────────────────────────────────────── */

/* provider keys come from .env (never hardcoded — this file is in git) */
const envKey = (name) => (fs.readFileSync(".env", "utf8").match(new RegExp(`^${name}=(.+)$`, "m")) || [, ""])[1].trim();

const PROVIDERS = [
  { provider: "moonshot", name: "main", apiKey: envKey("MOONSHOT_API_KEY") },
  { provider: "deepseek", name: "main", apiKey: envKey("DEEPSEEK_API_KEY") },
  { provider: "cheaperinference", name: "main", apiKey: envKey("CHEAPERINFERENCE_API_KEY") },
  { provider: "huggingface", name: "main", apiKey: envKey("HUGGINGFACE_API_KEY") },
  ...(OR_KEY ? [{ provider: "openrouter", name: "main", apiKey: OR_KEY }] : []),
].filter((p) => p.apiKey);

const M = (model, providerId) => ({ kind: "model", model: `${providerId}/${model}`, providerId });

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
      M("north-mini-code:free", "openrouter"),
      M("big-pickle", "opencode"),
    ],
  },
  {
    name: "jarvis-free",
    strategy: "priority",
    capabilities: { multimodal: false, reasoning: true, caching: false },
    models: [
      M("deepseek-flash", "deepseek"),
      M("kimi-k2.6", "moonshot"),
      M("free", "openrouter"),
      M("glm-5.2:free", "openrouter"),
      M("ling-3.0-flash-fin:free", "openrouter"),
      M("z-ai/glm-5.2", "nvidia"),
      M("deepseek-ai/DeepSeek-V3", "huggingface"),
    ],
  },
];

const JARVIS_HEADS = [
  M("kimi-k2.6", "moonshot"),
  M("claude-opus-4.8", "cheaperinference"),
  M("gpt-5.6-sol", "cheaperinference"),
  M("deepseek-v4-pro", "deepseek"),
  M("gemini-3.1-flash-lite", "cheaperinference"),
];

/* ── SSH transport: one connection, exec + a 20128 reverse tunnel ───────── */

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS,
  readyTimeout: 25000, keepaliveInterval: 10000,
}));
console.log(`── connected to ${USER}@${HOST}`);

function exec(cmd, timeout = 30000) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`exec timeout: ${cmd.slice(0, 60)}`)), timeout);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(to); return rej(err); }
      let out = "", errOut = "";
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (errOut += d));
      stream.on("close", (code) => { clearTimeout(to); res({ out, errOut, code }); });
    });
  });
}

// reverse tunnel: local ephemeral port → VPS localhost:20128
const server = net.createServer((sock) => {
  conn.forwardOut("127.0.0.1", 0, "127.0.0.1", 20128, (err, stream) => {
    if (err) { sock.destroy(); return; }
    sock.pipe(stream).pipe(sock);
  });
});
const listenPort = await new Promise((res, rej) => {
  server.once("error", rej);
  server.listen(0, "127.0.0.1", () => res(server.address().port));
});

async function api(method, path, body) {
  const r = await fetch(`http://127.0.0.1:${listenPort}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text };
}

try {
  /* ── 0. cleanup partial upload from the abandoned snapshot attempt ── */
  await exec("rm -f /home/jarvis/.omniroute/storage.sqlite.new").catch(() => {});

  /* ── 1. ensure the server is up ── */
  let health = await api("GET", "/v1/models").catch(() => ({ status: 0 }));
  if (health.status !== 200) {
    console.log("  server down → starting headless");
    await exec("nohup omniroute serve --headless --port 20128 > /home/jarvis/.omniroute/omniroute.log 2>&1 & sleep 7", 20000).catch(() => {});
    health = await api("GET", "/v1/models").catch(() => ({ status: 0 }));
  }
  console.log(`  server /v1/models → ${health.status}`);

  /* ── 2. ensure provider connections ── */
  const provs = await api("GET", "/api/providers");
  const have = new Set((provs.json?.connections || []).map((c) => c.provider));
  console.log(`  existing providers: ${[...have].join(",") || "none"}`);
  for (const p of PROVIDERS) {
    if (have.has(p.provider)) { console.log(`  provider ${p.provider}: already connected`); continue; }
    const r = await api("POST", "/api/providers", p);
    console.log(`  provider ${p.provider}: ${r.status === 201 || r.status === 200 ? "ADDED" : "ERR " + r.status} ${(r.text || "").slice(0, 100)}`);
  }

  /* ── 3. upsert the 4 JARVIS combos ── */
  const existing = await api("GET", "/api/combos");
  const byName = new Map((existing.json?.combos || []).map((c) => [c.name, c]));
  for (const combo of COMBOS) {
    const cur = byName.get(combo.name);
    const r = cur
      ? await api("PUT", `/api/combos/${cur.id}`, combo)
      : await api("POST", "/api/combos", combo);
    console.log(`  combo ${combo.name}: ${r.status === 200 || r.status === 201 ? "OK" : "ERR " + r.status}${r.status >= 400 ? " " + (r.text || "").slice(0, 140) : ""}`);
  }

  /* ── 4. upgrade the legacy `jarvis` combo with premium heads ── */
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
    console.log(`  combo jarvis (upgraded): ${r.status === 200 || r.status === 201 ? "OK" : "ERR " + r.status} → ${merged.length} models, premium heads first`);
  } else {
    console.log("  combo jarvis: not found — skipped upgrade");
  }

  /* ── 5. verify ── */
  const after = await api("GET", "/api/combos");
  const list = after.json?.combos || [];
  const pv = await api("GET", "/api/providers");
  console.log(`\n── Providers on VPS (${(pv.json?.connections || []).length}): ${(pv.json?.connections || []).map((c) => c.provider).join(", ")}`);
  console.log(`── Combos on VPS (${list.length}):`);
  for (const c of list) console.log(`  ${(c.name || "?").padEnd(14)} ${c.strategy || "?"}  ${(c.models || []).length} models`);

  /* ── 6. live brain test through jarvis-pro ── */
  console.log("\n── Live test: jarvis-pro");
  const test = await api("POST", "/v1/chat/completions", {
    model: "jarvis-pro",
    messages: [{ role: "user", content: "Reply with exactly: JARVIS PRO COMBO ONLINE" }],
    max_tokens: 20,
  });
  if (test.json?.choices?.[0]?.message?.content) {
    console.log(`  model: ${test.json.model || "?"}`);
    console.log(`  reply: ${test.json.choices[0].message.content.slice(0, 120).replace(/\n/g, " ")}`);
  } else {
    console.log(`  ERR: ${(test.text || "no body").slice(0, 200)}`);
  }
} finally {
  server.close();
  conn.end();
}
console.log("\nDONE — VPS OmniRoute now mirrors local (providers + combos).");
