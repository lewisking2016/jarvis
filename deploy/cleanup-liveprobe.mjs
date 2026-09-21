#!/usr/bin/env node
/** One-off: remove the LiveSite Probe lead from the VPS DB. Run: node deploy/cleanup-liveprobe.mjs */
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
import sqlite3, glob, os
for db in glob.glob(os.path.expanduser('~/.jarvis-data/*.sqlite')) + glob.glob(os.path.expanduser('~/jarvis/data/*.sqlite')):
    try:
        c = sqlite3.connect(db)
        n0 = list(c.execute("select count(*) from leads"))[0][0]
        c.execute("delete from leads where email='liveprobe@example.com'")
        c.commit()
        n1 = list(c.execute("select count(*) from leads"))[0][0]
        print(f'{db}: removed {n0-n1} probe lead(s), {n1} remain')
        break
    except Exception as e:
        print(db, 'skip:', e)
EOF`);
  console.log(out.trim());
} finally {
  conn.end();
}
console.log("CLEANUP_DONE");
