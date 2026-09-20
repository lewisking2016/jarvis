#!/usr/bin/env node
/**
 * OMNIROUTE MODEL TESTER — probes every unique model across the JARVIS combos
 * (plus the app-chain internals) with a tiny real completion, and prints a
 * verdict per model: OK / EMPTY / HTTP <code> / TIMEOUT.
 *
 * Usage:
 *   node deploy/omr-model-test.mjs vps      (default)
 *   node deploy/omr-model-test.mjs local
 *
 * Output: verdict table + machine-readable lines "VERDICT|<model>|<status>|<ms>"
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

const mode = process.argv[2] || "vps";

let cleanup = () => {};
async function makeApi() {
  if (mode === "local") {
    return async (method, path, body, timeout = 45000) => {
      const r = await fetch(`http://localhost:20128${path}`, {
        method,
        headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
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
  cleanup = () => { server.close(); conn.end(); };
  return async (method, path, body, timeout = 45000) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
}

const api = await makeApi();

/* models under test = every unique model across the 4 named combos
   + the internals the app chain actually uses (omniroute auto + freeaiapikey) */
const combos = await api("GET", "/api/combos");
const byName = new Map((combos.json?.combos || []).map((c) => [c.name, c]));
const target = new Map();
for (const name of ["jarvis-pro", "jarvis-fast", "jarvis-coder", "jarvis-free"]) {
  for (const m of byName.get(name)?.models || []) {
    if (!target.has(m.model)) target.set(m.model, m.providerId);
  }
}
for (const extra of ["omniroute/auto-best", "freeaiapikey/auto"]) {
  if (!target.has(extra)) target.set(extra, "internal");
}

console.log(`── testing ${target.size} models on ${mode}…\n`);
const rows = [];

async function probe(model) {
  const t0 = Date.now();
  try {
    const r = await api("POST", "/v1/chat/completions",
      { model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 15 },
      60000);
    const ms = Date.now() - t0;
    const j = r.json;
    if (r.status === 200 && j?.choices?.[0]) {
      const txt = (j.choices[0].message?.content || "").trim();
      if (txt.length > 0) return { model, status: "OK", ms, via: (j.model || "").slice(0, 45) };
      return { model, status: "EMPTY", ms, via: (j.model || "").slice(0, 45) };
    }
    const msg = (j?.error?.message || r.text || "").slice(0, 70).replace(/\n/g, " ");
    return { model, status: `HTTP ${r.status}`, ms, via: msg };
  } catch (e) {
    return { model, status: "TIMEOUT", ms: Date.now() - t0, via: String(e.message || e).slice(0, 40) };
  }
}

/* run in batches of 4 to be gentle on rate limits */
const all = [...target.keys()];
for (let i = 0; i < all.length; i += 4) {
  const batch = all.slice(i, i + 4);
  const results = await Promise.all(batch.map(probe));
  for (const r of results) {
    rows.push(r);
    const mark = r.status === "OK" ? "✓" : r.status === "EMPTY" ? "~" : "✗";
    console.log(`${mark} ${r.model.padEnd(46)} ${String(r.status).padEnd(10)} ${String(r.ms).padStart(6)}ms  ${r.via}`);
    console.log(`VERDICT|${r.model}|${r.status}|${r.ms}`);
  }
}

const ok = rows.filter((r) => r.status === "OK").length;
const empty = rows.filter((r) => r.status === "EMPTY").length;
console.log(`\n── summary: ${ok} OK, ${empty} empty-but-alive, ${rows.length - ok - empty} dead/limited of ${rows.length}`);
cleanup();
