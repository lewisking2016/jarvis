#!/usr/bin/env node
/** Probe/recover VPS OmniRoute. Run: node deploy/omr-probe-vps.mjs */
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
const APP_KEY = (fs.readFileSync(".env", "utf8").match(/^OMNIROUTE_API_KEY=(.+)$/m) || [, ""])[1].trim();

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000,
}));

const exec = (cmd, timeout = 25000) => new Promise((res, rej) => {
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
  console.log("── processes:");
  console.log(await exec("pgrep -af omniroute | head -5; echo COUNT=$(pgrep -f omniroute | wc -l)"));
  console.log("── log tail:");
  console.log(await exec("tail -25 ~/.omniroute/omniroute.log 2>/dev/null"));

  console.log("── forcing clean single-instance start (--daemon --no-open)");
  await exec("pkill -9 -f 'omniroute' 2>/dev/null; sleep 2; setsid nohup omniroute serve --daemon --no-open --port 20128 >> ~/.omniroute/omniroute.log 2>&1 < /dev/null & sleep 1; echo started", 20000);
  await new Promise((r) => setTimeout(r, 9000));
  console.log("── log tail after start:");
  console.log(await exec("tail -8 ~/.omniroute/omniroute.log; echo PORT=$(ss -ltn 2>/dev/null | grep -c 20128)"));

  const m1 = await exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/v1/models -H "Authorization: Bearer ${APP_KEY}"`);
  const m2 = await exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/api/combos -H "Authorization: Bearer ${APP_KEY}"`);
  const m3 = await exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/v1/models`);
  console.log(`── /v1/models (key) → ${m1.trim()}   /api/combos (mgmt) → ${m2.trim()}   /v1/models (no key) → ${m3.trim()}`);
} finally {
  conn.end();
}
