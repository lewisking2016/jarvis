#!/usr/bin/env node
/** Remove duplicate Probe NIM test leads on the VPS (keep newest). Run: node deploy/cleanup-probe-leads.mjs */
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
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000,
}));

const exec = (cmd, timeout = 60000) => new Promise((res, rej) => {
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
  console.log(await exec(`python3 - << 'EOF'
import sqlite3, glob, os
dbs = glob.glob(os.path.expanduser('~/.jarvis-data/*.sqlite')) + glob.glob('data/*.sqlite')
for db in dbs:
    try:
        c = sqlite3.connect(db, timeout=5)
        rows = list(c.execute("select id from leads where company like 'Probe NIM%'"))
        if not rows: continue
        keep = max(r[0] for r in rows)
        ids = [str(r[0]) for r in rows if r[0] != keep]
        if ids:
            c.execute("delete from leads where id in (%s)" % ",".join(ids))
            c.commit()
        print(db, '→ kept lead', keep, 'deleted', ids or 'none')
        break
    except Exception as e:
        print(db, 'ERR', e)
EOF`));
} finally {
  conn.end();
}
console.log("DONE");
