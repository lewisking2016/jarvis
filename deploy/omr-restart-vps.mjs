#!/usr/bin/env node
/** Clean-restart VPS OmniRoute (single instance) and probe auth. Run: node deploy/omr-restart-vps.mjs */
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
  console.log("── ~/.omniroute/.env (keys redacted to names)");
  console.log(await exec("sed 's/=.*/=<set>/' ~/.omniroute/.env"));
  console.log("── ~/.omniroute/server/ contents");
  console.log(await exec("ls -la ~/.omniroute/server/ && for f in ~/.omniroute/server/*; do [ -f \"$f\" ] && [ $(stat -c%s \"$f\") -lt 2000 ] && echo \"== $f\" && head -c 400 \"$f\" && echo; done"));
  console.log("── package version");
  console.log(await exec("omniroute --version 2>&1 | head -1"));

  console.log("── killing ALL omniroute processes + user unit");
  console.log(await exec("systemctl --user stop omniroute.service 2>/dev/null; pkill -9 -f omniroute; sleep 2; pgrep -f omniroute | wc -l"));

  console.log("── checkpointing WAL into storage (so combos written earlier persist) then starting clean");
  await exec("cd ~/.omniroute && python3 -c \"import sqlite3; c=sqlite3.connect('storage.sqlite'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()\" 2>&1 | head -2; ls -la storage.sqlite*");
  await exec("rm -f ~/.omniroute/storage.sqlite-shm ~/.omniroute/storage.sqlite-wal; nohup omniroute serve --headless --port 20128 > ~/.omniroute/omniroute.log 2>&1 & sleep 7; pgrep -f omniroute | wc -l", 25000);

  const probe = await exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/v1/models -H "Authorization: Bearer ${APP_KEY}"`);
  console.log(`── /v1/models after clean start → ${probe.trim()}`);
  const mgmt = await exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/api/combos -H "Authorization: Bearer ${APP_KEY}"`);
  console.log(`── /api/combos (management) → ${mgmt.trim()}`);
} finally {
  conn.end();
}
