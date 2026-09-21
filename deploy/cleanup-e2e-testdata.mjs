#!/usr/bin/env node
/** One-off: remove end-to-end TEST rows (this session's probes) from the VPS DB.
 *  Keeps all real data (SMS-ingested transactions, pre-existing docs). Run: node deploy/cleanup-e2e-testdata.mjs */
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
import sqlite3, os
db = os.path.expanduser('~/.jarvis-data/jarvis.data.sqlite')
c = sqlite3.connect(db)
refs = ('KSW-8891','ACM-4432','BRM-7781','DLX-2210','ZBP-5590')
q = ",".join("?"*len(refs))
n1 = c.execute(f"delete from transactions where ref in ({q})", refs).rowcount
docs = ('INV-2026-0002','INV-2026-0003','INV-2026-0004','QTE-2026-0003','QTE-2026-0004')
q2 = ",".join("?"*len(docs))
n2 = c.execute(f"delete from documents where number in ({q2})", docs).rowcount
n3 = c.execute("delete from tasks where title like 'Identify payment: KES %' and created_at >= datetime('now','-4 hours')").rowcount
c.commit()
print(f"removed: {n1} test transactions, {n2} test documents, {n3} identify-payment tasks")
print("remaining transactions:", list(c.execute("select id, counterparty, amount, ref from transactions")))
print("remaining docs:", [r[0] for r in c.execute("select number from documents order by id")])
EOF`);
  console.log(out.trim());
} finally {
  conn.end();
}
console.log("E2E_CLEANUP_DONE");
