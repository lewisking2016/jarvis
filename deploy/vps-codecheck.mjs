#!/usr/bin/env node
/** Verify VPS git commit + built code contains the latest gate. Run: node deploy/vps-codecheck.mjs */
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
  console.log("=== git HEAD on VPS ===");
  console.log((await exec("cd ~/jarvis && git log --oneline -3")).trim());

  console.log("\n=== FABRICATION_RE in source? ===");
  console.log((await exec("grep -c FABRICATION_RE ~/jarvis/src/lib/agent.ts || echo MISSING")).trim());

  console.log("\n=== FABRICATION_RE in built server chunks? ===");
  console.log((await exec("grep -rl FABRICATION_RE ~/jarvis/.next/server 2>/dev/null | head -3 || echo NOT_IN_BUILD")).trim());

  console.log("\n=== service start time vs build time ===");
  console.log((await exec("systemctl show jarvis -p ExecMainStartTimestamp; stat -c '%y %n' ~/jarvis/.next/BUILD_ID 2>/dev/null")).trim());
} finally {
  conn.end();
}
console.log("\nCODECHECK_DONE");
