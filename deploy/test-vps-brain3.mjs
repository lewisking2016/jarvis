#!/usr/bin/env node
/** VPS brain test with concise summary. Run: node deploy/test-vps-brain3.mjs */
import fs from "node:fs";
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

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000, keepaliveInterval: 10000,
}));

const exec = (cmd, timeout = 180000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", () => { clearTimeout(to); res(out); });
  });
});

try {
  const body = JSON.stringify({
    message: "Create a lead named Probe NIM with email probe.nim@example.com and phone 0700000003.",
  }).replace(/'/g, `'\\''`);

  const out = await exec(
    `curl -sN --max-time 170 -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" -d '${body}'`,
    180000,
  );

  const events = out.split("\n").filter((l) => l.startsWith("data: "));
  let provider = "", tools = [], failovers = [], text = "";
  for (const line of events) {
    try {
      const e = JSON.parse(line.slice(6));
      if (e.type === "provider") provider = e.provider;
      if (e.type === "failover") failovers.push(`${e.from} → ${e.to} (${(e.reason || "").slice(0, 50)})`);
      if (e.type === "tool") tools.push(e.name || e.tool || "?");
      if (e.type === "done") { text = e.text || ""; provider = e.provider || provider; }
    } catch {}
  }
  console.log("provider:", provider || "(none)");
  console.log("failovers:", failovers.length ? failovers.join(" | ") : "none");
  console.log("tools executed:", tools.length ? tools.join(", ") : "NONE");
  console.log("answer:", text.slice(0, 180).replace(/\n/g, " "));

  const verify = await exec(`python3 - << 'EOF'
import sqlite3, glob, os
for db in glob.glob(os.path.expanduser('~/.jarvis-data/*.sqlite')) + glob.glob('data/*.sqlite'):
    try:
        c = sqlite3.connect(db)
        rows = list(c.execute("select id, company, email from leads where company like '%Probe NIM%' or email like '%probe.nim%'"))
        print('leads matching probe:', rows if rows else 'NOT_FOUND')
        break
    except Exception as e:
        print('db err', e)
EOF`);
  console.log(verify.trim());
} finally {
  conn.end();
}
console.log("\nDONE");
