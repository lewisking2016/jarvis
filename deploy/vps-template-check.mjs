#!/usr/bin/env node
/** Verify redesigned templates render on the VPS. Run: node deploy/vps-template-check.mjs */
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
const run = (cmd, timeout = 60_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => stream.close(), timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── deployed commit");
  console.log((await run(`git -C ~/jarvis log --oneline -1`)).out);

  console.log("── create one of each kind");
  for (const body of [
    `{"kind":"QUOTE","client":"Design Review Ltd","items":[{"description":"AI automation platform setup","qty":1,"unit_price":120000},{"description":"Monthly retainer","qty":3,"unit_price":15000}]}`,
    `{"kind":"INVOICE","client":"Design Review Ltd","items":[{"description":"Corporate website build","qty":1,"unit_price":85000}],"status":"sent"}`,
    `{"kind":"RECEIPT","client":"Design Review Ltd","items":[{"description":"Payment received","qty":1,"unit_price":50000}],"status":"issued"}`,
  ]) {
    const r = await run(`curl -s -m 10 -X POST http://localhost:8080/api/documents -H 'Content-Type: application/json' -d '${body}' | head -c 80; echo`);
    console.log(r.out);
  }

  console.log("── render all three PDFs");
  for (const id of [2, 3, 4]) {
    const r = await run(`curl -s -m 15 -o /tmp/d${id}.pdf -w 'doc ${id}: HTTP %{http_code} %{size_download}B ' http://localhost:8080/api/documents/${id}/pdf; head -c 5 /tmp/d${id}.pdf; echo`);
    console.log(r.out.trim());
  }
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
