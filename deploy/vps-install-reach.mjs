#!/usr/bin/env node
/** Install JARVIS's internet tooling ON the VPS:
 *  1. mcporter + agent-reach (npm -g) — the reach layer skills.ts already calls
 *  2. Exa zero-config sanity probe (what skills.ts executes)
 *  3. agent-browser + headless Chromium — LinkedIn login sessions (approval-gated sends)
 *  Run: node deploy/vps-install-reach.mjs  */
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
const exec = (cmd, timeout = 420000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout: " + cmd.slice(0, 60))), timeout);
  conn.exec(cmd, (e, s) => { if (e) { clearTimeout(to); return rej(e); } let o = ""; s.on("data", (d) => process.stdout.write(d)); s.stderr.on("data", (d) => process.stdout.write(d)); s.on("close", (c) => { clearTimeout(to); res(o); }); });
});

console.log("── [1/4] free disk / mem baseline");
console.log(await exec("df -h / | tail -1; free -m | head -2"));

console.log("── [2/4] mcporter + agent-reach (global, sudo)");
console.log(await exec(`echo ${PASS} | sudo -S npm i -g mcporter agent-reach --no-audit --no-fund 2>&1 | tail -3; mcporter --version 2>&1 | head -1; agent-reach --version 2>&1 | head -1`, 300000));

console.log("── [3/4] Exa reach probe (exactly what skills.ts runs)");
console.log(await exec("mcporter call 'exa.web_search_exa(query: \"Kenya CCTV suppliers\", numResults: 2)' 2>&1 | head -12", 60000));

console.log("── [4/4] agent-browser + Chromium (for the LinkedIn session)");
console.log(await exec(`echo ${PASS} | sudo -S npm i -g agent-browser --no-audit --no-fund 2>&1 | tail -2; agent-browser install 2>&1 | tail -4`, 420000));

console.log("REACH_INSTALL_DONE");
conn.end();
