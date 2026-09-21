#!/usr/bin/env node
/** Upload + run the brain bake-off ON the VPS, fetch results back. Run: node deploy/run-bakeoff.mjs */
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
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => {
    if (e) { clearTimeout(to); return rej(e); }
    let o = "";
    s.on("data", (d) => process.stdout.write(d));
    s.stderr.on("data", (d) => process.stdout.write(d));
    s.on("close", (c) => { clearTimeout(to); res(o); });
  });
});

await new Promise((res, rej) => conn.sftp((e, sftp) => e ? rej(e) : sftp.fastPut("deploy/bakeoff.cjs", "/tmp/bakeoff.cjs", (e2) => e2 ? rej(e2) : res())));
console.log("── bake-off running on the VPS (parallel 4-wide)…");
await exec("cd /opt/jarvis && node /tmp/bakeoff.cjs; echo EXIT:$?");
const conn2 = new SSHClient();
await new Promise((res, rej) => conn2.on("ready", res).on("error", rej).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000 }));
conn2.sftp((e, sftp) => {
  if (e) return rej(e);
  sftp.fastGet("/tmp/bakeoff-result.json", "deploy/bakeoff-result.json", (e2) => {
    if (e2) console.log("fetch-back failed:", e2.message);
    else console.log("── results saved to deploy/bakeoff-result.json");
    conn.end(); conn2.end();
  });
});
