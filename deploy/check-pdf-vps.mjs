#!/usr/bin/env node
/** Verify the VPS serves the logo-branded PDF and runs the latest build. Run: node deploy/check-pdf-vps.mjs */
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
  console.log("── deployed commit vs pushed commit");
  console.log((await run(`git -C ~/jarvis log --oneline -1; git -C ~/jarvis status --short | head -3`)).out);

  console.log("── PDF render (logo build)");
  console.log((await run(`curl -s -m 15 -o /tmp/quote.pdf -w 'HTTP %{http_code} — %{size_download} bytes\\n' http://localhost:8080/api/documents/1/pdf`)).out);
  console.log("── PDF magic bytes + embedded logo image check");
  console.log((await run(`head -c 5 /tmp/quote.pdf; echo; grep -c /Image /tmp/quote.pdf 2>/dev/null || strings /tmp/quote.pdf | grep -ci image`)).out);

  console.log("── service + brain");
  console.log((await run(`systemctl is-active jarvis; curl -s -m 6 http://localhost:8080/api/system | head -c 130; echo`)).out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
