#!/usr/bin/env node
/** Full localhost health sweep on the VPS: app, docs API, brain chat probe. Run: node deploy/vps-localhost-sweep.mjs */
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

const exec = (cmd, timeout = 120000) => new Promise((res, rej) => {
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
  console.log("=== app /api/system ===");
  console.log((await exec("curl -s -m 10 http://localhost:8080/api/system | head -c 400; echo")).trim());

  console.log("\n=== documents API ===");
  console.log((await exec("curl -s -m 10 -o /dev/null -w 'HTTP:%{http_code}' http://localhost:8080/api/documents; echo")).trim());

  console.log("\n=== FreeLLMAPI ===");
  console.log((await exec("curl -s -m 8 -o /dev/null -w 'HTTP:%{http_code}' http://localhost:3001/v1/models; echo")).trim());

  console.log("\n=== OmniRoute ===");
  console.log((await exec("curl -s -m 8 -o /dev/null -w 'HTTP:%{http_code}' http://localhost:20128/v1/models; echo")).trim());

  console.log("\n=== brain chat probe (live AI) ===");
  const body = JSON.stringify({ message: "Reply with exactly: BRAIN_OK" });
  const out = await exec(
    `curl -sN --max-time 100 -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" -d '${body}'`,
    110000,
  );
  const events = out.split("\n").filter((l) => l.startsWith("data: "));
  let provider = "", text = "";
  for (const line of events) {
    try {
      const e = JSON.parse(line.slice(6));
      if (e.type === "provider") provider = e.provider;
      if (e.type === "done") { text = e.text || ""; provider = e.provider || provider; }
    } catch {}
  }
  console.log("provider:", provider || "(none)");
  console.log("answer:", text.slice(0, 150).replace(/\n/g, " ") || "(empty)");
} finally {
  conn.end();
}
console.log("\nSWEEP_DONE");
