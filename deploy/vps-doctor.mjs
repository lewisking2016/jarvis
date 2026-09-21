#!/usr/bin/env node
/** VPS DOCTOR — why is the app down? Run: node deploy/vps-doctor.mjs */
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
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", () => { clearTimeout(to); res(out); });
  });
});

try {
  console.log("=== uptime / load ===");
  console.log((await exec("uptime; free -m | head -3")).trim());

  console.log("\n=== jarvis service ===");
  console.log((await exec("systemctl is-active jarvis; systemctl show jarvis -p ExecMainPID,ExecMainStartTimestamp,NRestarts 2>/dev/null | head -5")).trim());

  console.log("\n=== routers ===");
  console.log((await exec("systemctl is-active omniroute freellmapi 2>/dev/null; docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null; pgrep -af 'omniroute|freellm' | head -5")).trim());

  console.log("\n=== port 8080 listeners ===");
  console.log((await exec("ss -tlnp 2>/dev/null | grep -E ':(8080|3001|20128)' || echo NOTHING_LISTENING")).trim());

  console.log("\n=== last 25 jarvis log lines ===");
  console.log((await exec("journalctl -u jarvis -n 25 --no-pager 2>/dev/null | tail -25 || echo no_journal_access")).trim());
} finally {
  conn.end();
}
console.log("\nDOCTOR_DONE");
