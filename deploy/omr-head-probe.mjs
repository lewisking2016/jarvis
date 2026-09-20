#!/usr/bin/env node
/** Probe jarvis-pro head models on VPS OmniRoute. Run: node deploy/omr-head-probe.mjs */
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

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000,
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

const HEADS = [
  "moonshot/kimi-k2.6",
  "cheaperinference/claude-opus-4.8",
  "cheaperinference/gpt-5.6-sol",
  "cheaperinference/gemini-3.1-pro",
  "deepseek/deepseek-v4-pro",
  "cheaperinference/glm-5.2",
  "cheaperinference/kimi-k3",
  "openrouter/free",
  "huggingface/deepseek-ai/DeepSeek-V3",
];

try {
  for (const model of HEADS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${APP_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
        signal: AbortSignal.timeout(45000),
      });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      if (r.status === 200 && j?.choices?.[0]) {
        console.log(`  ✓ ${model.padEnd(40)} → OK (${(j.model || "?").slice(0, 50)})`);
      } else {
        const err = (j?.error?.message || text || "").slice(0, 90).replace(/\n/g, " ");
        console.log(`  ✗ ${model.padEnd(40)} → ${r.status} ${err}`);
      }
    } catch (e) {
      console.log(`  ✗ ${model.padEnd(40)} → ${String(e.message || e).slice(0, 80)}`);
    }
  }
} finally {
  server.close();
  conn.end();
}
