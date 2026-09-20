#!/usr/bin/env node
/** Diagnose external reachability of VPS :8080. Run: node deploy/check-port.mjs */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  if (m[2] === "HOST") HOST = m[3].trim(); else if (m[2] === "USER") USER = m[3].trim(); else if (m[2] === "PASS") PASS = m[3].trim();
}
if (!PASS) PASS = process.env.JARVIS_VPS_PASS || "";

const conn = new SSHClient();
const run = (cmd, timeout = 25_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => stream.close(), timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── bind address (must be 0.0.0.0:8080)");
  console.log((await run(`ss -tlnp 2>/dev/null | head -20`)).out.split("\n").filter(l => l.includes("8080") || l.includes("20128")).join("\n") || "NO-LISTENER");
  console.log("\n── ufw status");
  console.log((await run(`Sudo -n ufw status 2>/dev/null || sudo -n ufw status 2>/dev/null || echo "ufw-check-failed"`)).out);
  console.log("── local curl");
  console.log((await run(`curl -s -o /dev/null -m 6 -w '127.0.0.1:8080 -> %{http_code}\\n' http://127.0.0.1:8080/api/system`)).out);
  console.log("── public-IP self-curl (hairpin)");
  console.log((await run(`curl -s -o /dev/null -m 8 -w 'self-pubip:8080 -> %{http_code}\\n' http://172.209.208.171:8080/api/system`)).out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });

// Independent external vantage (check-host.net) — runs while SSH wraps up
setTimeout(async () => {
  try {
    const ping = await fetch(`https://check-host.net/check-tcp?host=172.209.208.171:8080&max_nodes=3`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const j = await ping.json();
    if (!j.request_id) { console.log("EXT-CHECK:", JSON.stringify(j).slice(0, 120)); return; }
    await new Promise(r => setTimeout(r, 12000));
    const res = await fetch(`https://check-host.net/check-result/${j.request_id}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const rj = await res.json();
    for (const [node, v] of Object.entries(rj)) {
      console.log("EXT", node.split(".")[0], "->", v && v[0] ? (v[0].time != null ? `OPEN ${v[0].time}s` : v[0].error ?? JSON.stringify(v[0]).slice(0, 60)) : "pending");
    }
  } catch (e) { console.log("EXT-CHECK FAIL:", e.name); }
}, 20000);
