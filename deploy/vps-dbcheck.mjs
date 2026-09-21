#!/usr/bin/env node
/** Inspect the VPS DB: locate the sqlite file, show recent probe leads, clean test rows. */
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
  conn.exec(cmd, (e, s) => {
    if (e) { clearTimeout(to); return rej(e); }
    let o = "";
    s.on("data", (d) => (o += d)).stderr.on("data", (d) => (o += d));
    s.on("close", (c) => { clearTimeout(to); res(o); });
  });
});

const script = `
const fs=require('fs');
// find the sqlite file
const candidates=[];
function walk(d,depth){ if(depth>3) return; for(const f of fs.readdirSync(d,{withFileTypes:true})){ const p=d+'/'+f.name; if(f.isDirectory()){ if(['node_modules','.next','.git'].includes(f.name)) continue; walk(p,depth+1);} else if(/\\.sqlite|\\.db$/.test(f.name)) candidates.push(p);} }
walk('/opt/jarvis',0); walk('/home/jarvis/.jarvis-data',2);
console.log('DB FILES:', JSON.stringify(candidates));
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(candidates[0]);
const rows=db.prepare("select id,company,phone,created_at from leads where company like '%TESTVON%' or company like 'Invoice%' or company='Lead' order by id desc limit 10").all();
console.log('PROBE LEADS:', rows.length);
for(const r of rows) console.log(r.id,'|',r.company,'|',r.phone,'|',r.created_at);
const att=db.prepare("select id,name,mime,length(data) sz from attachments order by id desc limit 5").all();
console.log('ATTACHMENTS:', JSON.stringify(att));
const del1=db.prepare("delete from leads where company like '%TESTVON%' or company like 'Invoice 42K%'").run();
const del2=db.prepare("delete from attachments where mime in ('image/png','text/csv')").run();
console.log('CLEANED:', del1.changes,'leads,',del2.changes,'attachments');
`;
fs.writeFileSync("/tmp/vps-dbcheck.cjs", script);
await new Promise((res, rej) => conn.sftp((e, sftp) => e ? rej(e) : sftp.fastPut("/tmp/vps-dbcheck.cjs", "/tmp/vps-dbcheck.cjs", (e2) => e2 ? rej(e2) : res())));
console.log(await exec("cd /opt/jarvis && node /tmp/vps-dbcheck.cjs"));
await exec("rm -f /tmp/vps-dbcheck.cjs");
conn.end();
console.log("DBCHECK_DONE");
