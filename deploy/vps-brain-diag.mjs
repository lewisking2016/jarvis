#!/usr/bin/env node
/** Check every brain provider from INSIDE the VPS + tail the app log. */
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

const exec = (cmd, timeout = 60000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => {
    if (e) { clearTimeout(to); return rej(e); }
    let o = "";
    s.on("data", (d) => (o += d));
    s.stderr.on("data", (d) => (o += d));
    s.on("close", () => { clearTimeout(to); res(o); });
  });
});

const probe = `
node -e "
(async()=>{
  const env={};
  for(const l of require('fs').readFileSync('/home/jarvis/jarvis/.env','utf8').split('\\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim();}
  const targets=[
    ['hf-Qwen','https://router.huggingface.co/v1/chat/completions',env.HUGGINGFACE_API_KEY,'Qwen/Qwen3.8-27B'],
    ['freellm-auto','http://localhost:3001/v1/chat/completions',env.FREELLMAPI_API_KEY,'auto'],
    ['omni-jarvis-pro','http://localhost:20128/v1/chat/completions',env.OMNIROUTE_API_KEY,'jarvis-pro'],
    ['openrouter-free','https://openrouter.ai/api/v1/chat/completions',env.OPENROUTER_API_KEY,'moonshotai/Kimi-K3:free'],
  ];
  for(const [name,url,key,model] of targets){
    const t0=Date.now();
    try{
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,messages:[{role:'user',content:'say OK'}],max_tokens:5}),signal:AbortSignal.timeout(15000)});
      const body=(await r.text()).slice(0,120);
      console.log(name, r.status, (Date.now()-t0)+'ms', r.ok?'OK':'‹'+body+'›');
    }catch(e){ console.log(name,'ERR',(Date.now()-t0)+'ms',e.message); }
  }
})();
" 2>&1
`;

console.log("── provider probes from inside the VPS:");
console.log(await exec(probe, 90000));
console.log("── recent chat failovers in app log:");
console.log(await exec("journalctl -u jarvis -n 400 --no-pager 2>/dev/null | grep -E 'FAILOVER|BRAIN|AGENT_' | tail -12"));
conn.end();
console.log("VPSDIAG_DONE");
