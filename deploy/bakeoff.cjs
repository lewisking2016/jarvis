#!/usr/bin/env node
/**
 * BRAIN BAKE-OFF — probes every candidate free model with a REALISTIC JARVIS turn:
 *   round 1: messy directive + tools → must call create_document with CORRECT math
 *   round 2: tool result fed back → must narrate a clean confirmation (no garble,
 *            no JSON echo, no leaked thinking)
 * Scores 0-100 per candidate. Writes /tmp/bakeoff-result.json for the promoter.
 *
 * Runs ON the VPS (localhost:3001 FreeLLMAPI + localhost:20128 OmniRoute + remote
 * OpenRouter/NVIDIA/HF/CheaperInference). Usage: node /tmp/bakeoff.cjs
 */
const fs = require("fs");

// ---- env
const ENV = {};
for (const p of ["/home/jarvis/jarvis/.env", "/opt/jarvis/.env"]) {
  try { for (const line of fs.readFileSync(p, "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } break; } catch {}
}

const CHAIN = new Set([
  "nvidia/nemotron-3.5-lightning:free", "dots-studio/dots-3-note-preview:free",
  "inclusionai/ling-3.0-flash-vl:free", "nex-agi/nex-n2.5-mini:free",
  "inclusionai/ling-3.0-flash-fin:free", "qwen/qwen3.8-27b:free",
]);

const SYSTEM = "You are JARVIS, an operations butler. Use the provided tools for actions. Today is 2026-09-21. Currency KES. Infer unstated details sensibly (tax 0 if unmentioned, due date +14 days).";

const TOOLS = [{
  type: "function",
  function: {
    name: "create_document",
    description: "Create a quote, invoice or receipt",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["quote", "invoice", "receipt"] },
        client: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, qty: { type: "number" }, price: { type: "number" } }, required: ["description", "qty", "price"] } },
        total: { type: "number" },
        due_date: { type: "string" },
      },
      required: ["kind", "client", "items", "total"],
    },
  },
}];

const DIRECTIVE = "yo jarvis raise a quote for Tesh Limited — 3 access control units at 18.5k each plus installation ya 4k, wanalipa before month inaisha";

// expected: total 59500, client Tesh Limited, kind quote

async function callStream(baseUrl, key, model, messages, timeoutMs = 30000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, tools: TOOLS, temperature: 0.2, max_tokens: 400, stream: true }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, ms: Date.now() - t0, body: (await res.text()).slice(0, 120) };
    let content = "", toolArgs = null, toolName = "", firstByteMs = 0, raw = "";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByteMs) firstByteMs = Date.now() - t0;
      raw += dec.decode(value, { stream: true });
      for (const line of raw.split("\n").slice(0, -1)) {
        if (!line.startsWith("data: ")) continue;
        const d = line.slice(6).trim();
        if (d === "[DONE]") continue;
        try {
          const j = JSON.parse(d);
          const delta = j.choices?.[0]?.delta ?? {};
          if (delta.content) content += delta.content;
          const tc = delta.tool_calls?.[0];
          if (tc) {
            toolName = tc.function?.name || toolName;
            toolArgs = (toolArgs ?? "") + (tc.function?.arguments ?? "");
          }
        } catch {}
      }
      raw = raw.split("\n").slice(-1)[0];
    }
    return { content, toolName, toolArgsRaw: toolArgs, firstByteMs, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e.name === "AbortError" ? "TIMEOUT" : e.message, ms: Date.now() - t0 };
  } finally { clearTimeout(to); }
}

function scoreArgs(raw) {
  try {
    const a = JSON.parse(raw);
    const total = Number(a.total);
    const items = Array.isArray(a.items) ? a.items : [];
    const lineSum = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
    return {
      ok: true, kind: a.kind, client: a.client, total,
      mathOk: Math.abs(total - 59500) < 1 || Math.abs(lineSum - 59500) < 1,
      dueOk: !a.due_date || a.due_date > "2026-09-21",
    };
  } catch { return { ok: false }; }
}

function narrationScore(text) {
  if (!text.trim()) return { clean: false, why: "empty" };
  if (/<think>|<\/think>/i.test(text)) return { clean: false, why: "thinking-leak" };
  if (/\{[\s\S]*"kind"|"total"[\s\S]*\}/.test(text)) return { clean: false, why: "json-echo" };
  const fused = (text.match(/[a-z]{3,}\d|\d[a-z]{3,}/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  if (fused >= 2 || words.length < 4) return { clean: false, why: `garble(fused=${fused},words=${words.length})` };
  const quotesReal = /59,?500|Tesh/i.test(text);
  return { clean: true, quotesReal, text: text.slice(0, 160) };
}

async function probe(id, baseUrl, key) {
  const out = { id, errors: [] };
  // round 1 — tools + math
  const r1 = await callStream(baseUrl, key, id, [
    { role: "system", content: SYSTEM },
    { role: "user", content: DIRECTIVE },
  ]);
  if (r1.error) { out.errors.push(`r1:${r1.error}`); out.score = 0; return out; }
  out.firstByteMs = r1.firstByteMs;
  out.ms1 = r1.ms;
  if (r1.toolName !== "create_document") {
    out.errors.push(`r1:no-tool(${r1.toolName || "none"}, narrated=${(r1.content || "").slice(0, 60)})`);
    out.score = 0; return out;
  }
  const a = scoreArgs(r1.toolArgsRaw);
  out.round1 = a;
  if (!a.ok) { out.errors.push("r1:bad-json"); out.score = 20; return out; }
  let s = 40;
  if (a.mathOk) s += 20; else out.errors.push("r1:math-wrong(" + a.total + ")");
  if (/tesh/i.test(a.client || "")) s += 5; else out.errors.push("r1:client-wrong(" + a.client + ")");
  if (/quote/i.test(a.kind || "")) s += 5; else out.errors.push("r1:kind(" + a.kind + ")");
  if (a.dueOk) s += 5; else out.errors.push("r1:due-past(" + a.round1?.due_date + ")");
  if (r1.firstByteMs < 3000) s += 5;
  if (r1.ms > 40000) s -= 10;
  // round 2 — narration with tool result
  const r2 = await callStream(baseUrl, key, id, [
    { role: "system", content: SYSTEM },
    { role: "user", content: DIRECTIVE },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "create_document", arguments: r1.toolArgsRaw } }] },
    { role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true, number: "QTE-2026-0099", total: a.total, client: a.client }) },
  ], 25000);
  if (r2.error) { out.errors.push(`r2:${r2.error}`); s -= 15; }
  else {
    out.ms2 = r2.ms;
    const n = narrationScore(r2.content || "");
    out.narration = n;
    if (n.clean) { s += 25; if (n.quotesReal) s += 5; } else s -= 20;
  }
  out.score = Math.max(0, Math.min(100, s));
  return out;
}

(async () => {
  const candidates = [];
  // 1. OpenRouter catalog discovery — reputable vendors, free, big context
  try {
    const cat = await (await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20000) })).json();
    const free = cat.data
      .filter((m) => m.id.endsWith(":free") && (m.context_length ?? m.top_provider?.context_length ?? 0) >= 100000)
      .filter((m) => /^(qwen|moonshot|meta-llama|mistralai|google|deepseek|nvidia|thudm|z-ai|tng)/i.test(m.id))
      .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));
    const fresh = free.filter((m) => !CHAIN.has(m.id)).slice(0, 6).map((m) => m.id);
    for (const id of [...CHAIN].slice(0, 3).concat(fresh)) candidates.push({ id, baseUrl: "https://openrouter.ai/api/v1", key: ENV.OPENROUTER_API_KEY });
  } catch (e) { console.log("catalog failed:", e.message); }
  // 2. NVIDIA direct
  candidates.push({ id: "nvidia/nemotron-3-super-120b-a12b", baseUrl: "https://integrate.api.nvidia.com/v1", key: ENV.NVIDIA_API_KEY });
  // 3. FreeLLMAPI (local)
  for (const id of ["auto", "moonshotai/Kimi-K3", "openrouter/gpt-oss-120b"]) candidates.push({ id, baseUrl: "http://localhost:3001/v1", key: ENV.FREELLMAPI_API_KEY });
  // 4. HuggingFace router — discover a free large model
  try {
    const r = await fetch("https://router.huggingface.co/v1/models", {
      headers: { Authorization: `Bearer ${ENV.HUGGINGFACE_API_KEY}` }, signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const j = await r.json();
      const big = (j.data || []).filter((m) => /deepseek|qwen3|llama-4|kimi/i.test(m.id)).slice(0, 2);
      for (const m of big) candidates.push({ id: m.id, baseUrl: "https://router.huggingface.co/v1", key: ENV.HUGGINGFACE_API_KEY });
    }
  } catch {}
  // 5. CheaperInference — discover
  try {
    const r = await fetch("https://api.cheaperinference.com/v1/models", {
      headers: { Authorization: `Bearer ${ENV.CHEAPERINFERENCE_API_KEY}` }, signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const j = await r.json();
      const ids = (j.data || []).map((m) => m.id).filter((i) => /gpt-oss|qwen|llama|deepseek/i.test(i)).slice(0, 2);
      for (const id of ids) candidates.push({ id, baseUrl: "https://api.cheaperinference.com/v1", key: ENV.CHEAPERINFERENCE_API_KEY });
    } else console.log("cheaperinference /models:", r.status);
  } catch (e) { console.log("cheaperinference unreachable:", e.message); }

  // dedupe
  const seen = new Set();
  const list = candidates.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  console.log(`probing ${list.length} candidates, 4-wide…`);

  const results = [];
  const queue = [...list];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      process.stdout.write(`  → ${c.id} … `);
      let r;
      try { r = await probe(c.id, c.baseUrl, c.key); } catch (e) { r = { id: c.id, errors: ["probe-crash:" + e.message], score: 0 }; }
      results.push(r);
      console.log(`score ${r.score} ${r.errors?.join(";") || ""}`);
      fs.writeFileSync("/tmp/bakeoff-result.json", JSON.stringify(results, null, 1));
    }
  }));
  results.sort((a, b) => b.score - a.score);
  fs.writeFileSync("/tmp/bakeoff-result.json", JSON.stringify(results, null, 1));
  console.log("\n═══ LEADERBOARD ═══");
  for (const r of results.slice(0, 10)) console.log(String(r.score).padStart(3), r.id, r.errors?.length ? "‹" + r.errors.join(";").slice(0, 90) + "›" : "‹clean›");
  console.log("BAKEOFF_DONE");
})();
