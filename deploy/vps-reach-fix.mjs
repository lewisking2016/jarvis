#!/usr/bin/env node
/** Follow-up fixer on the VPS: agent-reach from GitHub, mcporter exa config,
 *  Chromium system deps. Run: node deploy/vps-reach-fix.mjs */
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

console.log("── [1/4] what landed in npm -g?");
console.log(await exec("npm ls -g --depth=0 2>/dev/null | head -12"));

console.log("── [2/4] agent-reach from GitHub");
console.log(await exec(`echo ${PASS} | sudo -S npm i -g github:Panniantong/Agent-Reach --no-audit --no-fund 2>&1 | tail -2; which agent-reach; agent-reach --version 2>&1 | head -1`, 300000));

console.log("── [3/4] agent-reach doctor (registers backends incl. Exa in mcporter)");
console.log(await exec("agent-reach doctor --json 2>&1 | head -40", 90000));

console.log("── [4/4] Chromium system deps");
console.log(await exec(`echo ${PASS} | sudo -S env PATH=$PATH:/usr/local/bin agent-browser install --with-deps 2>&1 | tail -5`, 420000));

console.log("REACHFIX_DONE");
conn.end();
