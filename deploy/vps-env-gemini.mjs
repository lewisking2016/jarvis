#!/usr/bin/env node
/** Add GEMINI_API_KEY (+model pin) to the VPS .env over SSH. Run: node deploy/vps-env-gemini.mjs */
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

// read the key from the LOCAL .env (never hardcode)
const local = fs.readFileSync(".env", "utf8");
const gem = local.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim();
if (!gem) { console.error("no GEMINI_API_KEY in local .env"); process.exit(1); }

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000, keepaliveInterval: 10000,
}));
const exec = (cmd, timeout = 60000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => { if (e) { clearTimeout(to); return rej(e); } let o = ""; s.on("data", (d) => (o += d)); s.stderr.on("data", (d) => (o += d)); s.on("close", () => { clearTimeout(to); res(o); }); });
});

const cmd = `cd /home/jarvis/jarvis && node -e "
const fs=require('fs');
let s=fs.readFileSync('.env','utf8');
if(!/^GEMINI_API_KEY=/m.test(s)){
  s=s.replace(/^OPENROUTER_API_KEY=/m,'GEMINI_API_KEY=${gem}\\nJARVIS_GEMINI_MODEL=gemini-3.1-flash-lite\\nOPENROUTER_API_KEY=');
  fs.writeFileSync('.env',s);
  console.log('GEMINI key added to VPS .env');
} else console.log('already present');
" && systemctl --version >/dev/null 2>&1; echo DONE_SETUP`;

console.log(await exec(cmd));
// restart the service so it picks the key up
console.log(await exec(`echo ${PASS} | sudo -S systemctl restart jarvis 2>&1; sleep 4; curl -s -m 10 http://localhost:8080/api/system | head -c 60; echo`));
conn.end();
console.log("ENVGEMINI_DONE");
