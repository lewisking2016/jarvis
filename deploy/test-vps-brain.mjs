#!/usr/bin/env node
/** Test the live VPS brain: connectivity, a real directive, and DB verification. Run: node deploy/test-vps-brain.mjs */
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
  console.log("── [1] upstream reachability from VPS");
  console.log((await run(`curl -s -o /dev/null -m 10 -w 'openrouter: %{http_code}\\n' https://api.openrouter.ai/api/v1/models`)).out);
  console.log((await run(`curl -s -o /dev/null -m 6 -w 'omniroute-local: %{http_code}\\n' http://localhost:20128/v1/models`)).out);

  console.log("── [2] service + brain");
  console.log((await run(`systemctl is-active jarvis; curl -s -m 6 http://localhost:8080/api/system | head -c 220; echo`)).out);

  console.log("── [3] live directive (obedience + tool execution)");
  const chat = await run(
    `curl -s -m 100 -X POST http://localhost:8080/api/chat -H 'Content-Type: application/json' ` +
    `-d '{"message":"Add a lead named TestCorp with email testcorp@probe.io and status new. Then confirm exactly what you added."}' | head -c 700`,
    110_000
  );
  console.log(chat.out, "\n");

  console.log("── [4] DB verification — did the lead actually land?");
  const leads = await run(`curl -s -m 8 http://localhost:8080/api/leads | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('leads',[]); print([ (l.get('name'),l.get('email'),l.get('status')) for l in a if 'TestCorp' in str(l.get('name','')) ] or 'NOT_FOUND')"`);
  console.log(leads.out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
