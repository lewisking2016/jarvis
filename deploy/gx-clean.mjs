#!/usr/bin/env node
/** Clean ALL gauntlet test rows (TESTGX / gauntlet artifacts) from the live DB. */
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

const script = `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/jarvis/.jarvis-data/jarvis.data.sqlite');
const wipe=(label,sql,args=[])=>{ try{ const r=db.prepare(sql).run(...args); console.log(label+':',r.changes,'deleted'); }catch(e){ console.log(label+': ERR '+e.message);} };
wipe('documents', "DELETE FROM documents WHERE client LIKE '%TESTGX%'");
// find the actual ledger table name for payments
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name);
console.log('tables:', tables.join(','));
for(const t of ['transactions','payments']){
  if(tables.includes(t)) wipe(t, \`DELETE FROM \${t} WHERE counterparty LIKE '%Rafiki Prints%' OR ref='RP-881' OR reference='RP-881' OR counterparty LIKE '%TESTGX%'\`);
}
if(tables.includes('tasks')) wipe('tasks', "DELETE FROM tasks WHERE title LIKE '%TESTGX%' OR title LIKE '%Nile Supply%'");
if(tables.includes('leads')) wipe('leads', "DELETE FROM leads WHERE company LIKE '%TESTGX%' OR contact LIKE '%TESTGX%'");
if(tables.includes('memories')) wipe('memories', "DELETE FROM memories WHERE content LIKE '%TESTGX%'");
if(tables.includes('activity')) wipe('activity', "DELETE FROM activity WHERE detail LIKE '%TESTGX%' OR detail LIKE '%RP-881%'");
// profile: remove warranty test fact if present
try{
  const p=db.prepare("SELECT value FROM app_state WHERE key='profile'").get();
  if(p){ const j=JSON.parse(p.value); const before=JSON.stringify(j);
    const clean=JSON.parse(before.replace(/[^"]*TESTGX[^"]*,?/g,''));
    for(const k of Object.keys(clean)) if(/warranty/i.test(k)) delete clean[k];
    if(JSON.stringify(clean)!==before){ db.prepare("UPDATE app_state SET value=? WHERE key='profile'").run(JSON.stringify(clean)); console.log('profile: test facts removed'); }
    else console.log('profile: clean');
  }
}catch(e){ console.log('profile:', e.message); }
`;
fs.writeFileSync("/tmp/gx-clean.cjs", script);
await new Promise((res, rej) => conn.sftp((e, sftp) => e ? rej(e) : sftp.fastPut("/tmp/gx-clean.cjs", "/tmp/gx-clean.cjs", (e2) => e2 ? rej(e2) : res())));
console.log(await exec("node /tmp/gx-clean.cjs"));
await exec("rm -f /tmp/gx-clean.cjs");
conn.end();
console.log("GXCLEAN_DONE");
