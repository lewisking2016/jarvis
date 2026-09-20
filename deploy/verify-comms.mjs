#!/usr/bin/env node
/** Verify comms results on the VPS via its APIs. Run: node deploy/verify-comms.mjs */
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
const run = (cmd, timeout = 30_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => stream.close(), timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── approvals (latest 3)");
  console.log((await run(`curl -s -m 8 'http://localhost:8080/api/approvals' | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('approvals',d.get('pending',[])); [print(x.get('id'),x.get('kind'),x.get('status'),'—',str(x.get('summary'))[:80]) for x in (a[:3] if isinstance(a,list) else [a])]"`)).out);
  console.log("── tasks (latest 3)");
  console.log((await run(`curl -s -m 8 'http://localhost:8080/api/tasks' | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('tasks',[]); [print(x.get('id'),x.get('due'),x.get('status'),'—',str(x.get('title'))[:80]) for x in (a[:3] if isinstance(a,list) else [a])]" 2>&1 | head -5`)).out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
