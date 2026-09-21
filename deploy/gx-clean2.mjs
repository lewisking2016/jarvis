#!/usr/bin/env node
/** Second cleanup pass: transactions table uses `ref`, not `reference`. */
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
const exec = (cmd, timeout = 45000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => { if (e) { clearTimeout(to); return rej(e); } let o = ""; s.on("data", (d) => (o += d)); s.stderr.on("data", (d) => (o += d)); s.on("close", () => { clearTimeout(to); res(o); }); });
});

console.log(await exec(`cd /home/jarvis && node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/jarvis/.jarvis-data/jarvis.data.sqlite');
const cols=db.prepare(\\"PRAGMA table_info(transactions)\\").all().map(c=>c.name);
console.log('tx cols:', cols.join(','));
const r=db.prepare(\\"DELETE FROM transactions WHERE ref='RP-881' OR IFNULL(counterparty,'') LIKE '%Rafiki Prints%' OR IFNULL(counterparty,'') LIKE '%TESTGX%'\\").run();
console.log('transactions deleted:', r.changes);
const left=db.prepare(\\"SELECT count(*) c FROM transactions WHERE ref='RP-881'\\").get();
console.log('remaining RP-881:', left.c);
"`));
conn.end();
console.log("CLEAN2_DONE");
