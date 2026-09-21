#!/usr/bin/env node
/** One-off: remove humanization-test rows from the VPS (test quote + test till). Run: node deploy/cleanup-humanize-testdata.mjs */
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

const exec = (cmd, timeout = 30000) => new Promise((res, rej) => {
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
  const out = await exec(`python3 - << 'EOF'
import sqlite3, os, json
db = os.path.expanduser('~/.jarvis-data/jarvis.data.sqlite')
c = sqlite3.connect(db)
n = c.execute("delete from documents where client='Greenview Hotel'").rowcount
print(f"removed {n} test quote(s)")
row = c.execute("select value from app_state where key='company_profile'").fetchone()
if row:
    p = json.loads(row[0])
    p["payment"]["till"] = ""  # my test values were 888777/999555 — reset to unset
    c.execute("update app_state set value=? where key='company_profile'", (json.dumps(p),))
    print("profile till reset to empty; paybill:", repr(p["payment"].get("paybill","")))
c.commit()
print("docs now:", [r[0] for r in c.execute("select number from documents order by id")])
EOF`);
  console.log(out.trim());
} finally {
  conn.end();
}
console.log("HUMANIZE_CLEANUP_DONE");
