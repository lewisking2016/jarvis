#!/usr/bin/env node
/** Trigger learn_voice ON the VPS (localhost bypasses the Vercel proxy timeout). */
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
const exec = (cmd, timeout = 240000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (e, s) => { if (e) { clearTimeout(to); return rej(e); } let o = ""; s.on("data", (d) => (o += d)); s.stderr.on("data", (d) => (o += d)); s.on("close", () => { clearTimeout(to); res(o); }); });
});

const out = await exec(`curl -s -m 220 -X POST http://localhost:8080/api/ops -H 'Content-Type: application/json' -d '{"op":"learn_voice","force":true}' | head -c 900`);
console.log(out);
conn.end();
console.log("VOICELEARN_DONE");
