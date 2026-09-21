#!/usr/bin/env node
/** One-off: npm install new deps on the VPS, rebuild, restart the service.
 *  Run: node deploy/vps-npm-install.mjs */
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
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000, keepaliveInterval: 30000,
}));

const exec = (cmd, timeout = 420000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", (code) => { clearTimeout(to); res(out + (code ? `\n[exit ${code}]` : "")); });
  });
});

try {
  console.log("=== npm install (thinking-orbs) ===");
  console.log((await exec("cd ~/jarvis && npm install thinking-orbs --no-audit --no-fund 2>&1 | tail -3", 300000)).trim());

  console.log("\n=== rebuild ===");
  console.log((await exec("cd ~/jarvis && npm run build 2>&1 | tail -4", 360000)).trim());

  console.log("\n=== restart + health ===");
  console.log((await exec("sudo -S -p '' systemctl restart jarvis <<< 'PLACEHOLDER' 2>/dev/null || systemctl restart jarvis 2>&1; sleep 4; curl -s -m 8 -o /dev/null -w 'health %{http_code}' http://localhost:8080/api/system")).trim());
} finally {
  conn.end();
}
console.log("\nNPM_INSTALL_DONE");
