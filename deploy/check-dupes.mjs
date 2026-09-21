#!/usr/bin/env node
/** Check the live DB for duplicate TESTGX docs + inventory all gauntlet rows. */
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
console.log('DOCS:');
for(const r of db.prepare("select id,kind,number,client,total,status,created_at from documents where client like '%TESTGX%' order by id").all()) console.log(' ',r.id,r.kind,r.number,'|',r.client,'|',r.total,'|',r.created_at);
console.log('PAYMENTS:');
for(const r of db.prepare("select id,amount,counterparty,reference,paid_at from payments where counterparty like '%TESTGX%' or reference like '%RP-881%' order by id").all()) console.log(' ',r.id,r.amount,'|',r.counterparty,'|',r.reference,'|',r.paid_at);
console.log('LEADS:');
for(const r of db.prepare("select id,company,contact,phone from leads where company like '%TESTGX%' or contact like '%TESTGX%' order by id").all()) console.log(' ',r.id,'|',r.company,'|',r.contact,'|',r.phone);
console.log('TASKS:');
for(const r of db.prepare("select id,title,status,due_date from tasks where title like '%TESTGX%' or title like '%Nile Supply%' order by id").all()) console.log(' ',r.id,'|',r.title,'|',r.status,'|',r.due_date);
console.log('PROFILE-GX:', JSON.stringify(db.prepare("select key,value from app_state where key like '%warranty%' or value like '%TESTGX%'").all()));
console.log('MEMORIES-GX:', db.prepare("select count(*) c from memories where content like '%TESTGX%' or content like '%warranty%'").get().c);
`;
fs.writeFileSync("/tmp/gx-check.cjs", script);
await new Promise((res, rej) => conn.sftp((e, sftp) => e ? rej(e) : sftp.fastPut("/tmp/gx-check.cjs", "/tmp/gx-check.cjs", (e2) => e2 ? rej(e2) : res())));
console.log(await exec("node /tmp/gx-check.cjs"));
await exec("rm -f /tmp/gx-check.cjs");
conn.end();
console.log("GXCHECK_DONE");
