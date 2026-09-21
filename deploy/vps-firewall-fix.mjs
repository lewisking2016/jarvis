#!/usr/bin/env node
/** Check + fix VPS firewall so :8080 is reachable. Run: node deploy/vps-firewall-fix.mjs */
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

// sudo via password on stdin
const sudo = (cmd) => exec(`sudo -S -p '' ${cmd} <<< '${PASS.replace(/'/g, `'\\''`)}'`);

try {
  console.log("=== ufw status ===");
  console.log((await sudo("ufw status verbose")).trim() || "(empty)");

  console.log("\n=== iptables INPUT policy + rules (first 20) ===");
  console.log((await sudo("iptables -L INPUT -n --line-numbers | head -20")).trim());

  console.log("\n=== self-test from VPS: localhost:8080 ===");
  console.log((await exec("curl -s -m 8 -o /dev/null -w 'HTTP:%{http_code} in %{time_total}s' http://localhost:8080/api/system; echo")).trim());
} finally {
  conn.end();
}
console.log("\nFW_CHECK_DONE");
