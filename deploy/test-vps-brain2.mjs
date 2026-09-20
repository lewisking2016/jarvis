#!/usr/bin/env node
/** PII-free brain test on the VPS. Run: node deploy/test-vps-brain2.mjs */
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
const run = (cmd, timeout = 120_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => { out += "\n[TIMEOUT]"; stream.close(); }, timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── PII-FREE directive (no email in the payload)");
  const chat = await run(
    `curl -s -m 100 -X POST http://localhost:8080/api/chat -H 'Content-Type: application/json' ` +
    `-d '{"message":"Add a lead named ProbeCorp with status new. Use my company email for the lead contact. Then confirm exactly what you added."}' | tail -c 900`,
    110_000
  );
  console.log(chat.out, "\n");

  console.log("── DB verification");
  const leads = await run(`curl -s -m 8 http://localhost:8080/api/leads | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('leads',[]); print([ (l.get('name'),l.get('email'),l.get('status')) for l in a if 'ProbeCorp' in str(l.get('name','')) ] or 'NOT_FOUND')"`);
  console.log(leads.out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
