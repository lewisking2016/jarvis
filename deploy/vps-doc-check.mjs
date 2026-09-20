#!/usr/bin/env node
/** Create a doc on the VPS and verify the logo-branded PDF renders. Run: node deploy/vps-doc-check.mjs */
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
const run = (cmd, timeout = 40_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => stream.close(), timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── create doc on VPS");
  console.log((await run(`curl -s -m 10 -X POST http://localhost:8080/api/documents -H 'Content-Type: application/json' -d '{"kind":"QUOTE","client":"VPS Verify Ltd","items":[{"description":"Logo-branded PDF verification","qty":1,"unit_price":1000}]}' | head -c 160`)).out);

  console.log("── render its PDF");
  const create = await run(`curl -s -m 10 'http://localhost:8080/api/documents' | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('documents',[]); print(a[0]['id'] if a else 0)"`);
  const id = (create.out.match(/\\d+/) || ["0"])[0];
  console.log((await run(`curl -s -m 15 -o /tmp/vps.pdf -w 'HTTP %{http_code} — %{size_download} bytes\\n' http://localhost:8080/api/documents/${id}/pdf`)).out);
  console.log((await run(`head -c 5 /tmp/vps.pdf; echo; strings /tmp/vps.pdf | grep -c imtblack 2>/dev/null; strings /tmp/vps.pdf | grep -ci 'xref\\|stream' 2>/dev/null | head -1`)).out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
