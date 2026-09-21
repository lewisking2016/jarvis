#!/usr/bin/env node
/** Verify BOTH SMTP mailboxes from inside the VPS: handshake+auth, then one real
 *  test send per mailbox to info@imeantech.com. Run: node deploy/smtp-verify.mjs */
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
const exec = (cmd, timeout = 90000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => { if (e) { clearTimeout(to); return rej(e); } let o = ""; s.on("data", (d) => (o += d)); s.stderr.on("data", (d) => (o += d)); s.on("close", () => { clearTimeout(to); res(o); }); });
});

const script = `
const nodemailer=require('/home/jarvis/jarvis/node_modules/nodemailer');
const env={};
for(const l of require('fs').readFileSync('/home/jarvis/jarvis/.env','utf8').split('\\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim();}
(async()=>{
  for(const [name,user,pass] of [['marketing',env.SMTP_INFO_USER,env.SMTP_INFO_PASS],['formal',env.SMTP_ADMIN_USER,env.SMTP_ADMIN_PASS]]){
    const t0=Date.now();
    try{
      const tr=nodemailer.createTransport({host:env.SMTP_HOST||'my.mailbux.com',port:Number(env.SMTP_PORT||587),secure:false,requireTLS:true,auth:{user,pass},connectionTimeout:15000,greetingTimeout:12000});
      await tr.verify();
      console.log(name,'AUTH OK',((Date.now()-t0)/1000).toFixed(1)+'s','('+user+')');
      const info=await tr.sendMail({
        from:'"IMT General System" <'+user+'>',
        to:'info@imeantech.com',
        subject:'[JARVIS verify] '+name+' mailbox — '+(env.TODAY||'live test'),
        text:'Mailbox '+name+' ('+user+') verified live from the VPS at '+new Date().toISOString()+'. You can delete this email.',
      });
      console.log(name,'SEND OK messageId='+info.messageId.slice(0,40));
    }catch(e){ console.log(name,'FAILED:',e.message.slice(0,140)); }
  }
})();
`;
fs.writeFileSync("/tmp/smtp-verify.cjs", script);
await new Promise((res, rej) => conn.sftp((e, sftp) => e ? rej(e) : sftp.fastPut("/tmp/smtp-verify.cjs", "/tmp/smtp-verify.cjs", (e2) => e2 ? rej(e2) : res())));
console.log(await exec("node /tmp/smtp-verify.cjs"));
await exec("rm -f /tmp/smtp-verify.cjs");
conn.end();
console.log("SMTPVERIFY_DONE");
