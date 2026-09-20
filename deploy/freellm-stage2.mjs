#!/usr/bin/env node
/**
 * FREELLMAPI stage 2 — boot with minimal config, discover valid platform
 * slugs from the running server, inject our keys, verify a model call.
 * Run: node deploy/freellm-stage2.mjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
const ENV = {};
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  ENV[m[1]] = m[2].trim();
  if (m[1] === "JARVIS_VPS_HOST") HOST = m[2].trim();
  else if (m[1] === "JARVIS_VPS_USER") USER = m[2].trim();
  else if (m[1] === "JARVIS_VPS_PASS") PASS = m[2].trim();
}

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000,
}));

const exec = (cmd, timeout = 90000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", () => { clearTimeout(to); res(out); });
  });
});
const sftpPut = (local, remote) => new Promise((res, rej) =>
  conn.sftp((e, s) => (e ? rej(e) : s.fastPut(local, remote, (e2) => (e2 ? rej(e2) : res())))));

try {
  /* 1. minimal config → boot */
  await sftpPut("deploy/freellm.config.json", "/home/jarvis/freellmapi/freellmapi.config.json");
  console.log("── booting with minimal config…");
  await exec("sudo -S -p '' docker compose -f /home/jarvis/freellmapi/docker-compose.yml up -d --force-recreate <<< " + JSON.stringify(PASS), 120000);
  await new Promise((r) => setTimeout(r, 12000));
  console.log(await exec("sudo -S -p '' docker ps --format '{{.Names}} {{.Status}}' <<< " + JSON.stringify(PASS)));
  console.log("── /v1/models:", (await exec("curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3001/v1/models; echo")).trim());

  /* 2. discover slugs + models from the server's own API */
  const probe = await exec("curl -s --max-time 15 http://localhost:3001/v1/models | head -c 400; echo; curl -s --max-time 15 http://localhost:3001/api/platforms | head -c 600; echo; curl -s --max-time 15 http://localhost:3001/health | head -c 200");
  console.log("── discovery:\n" + probe.trim());

  /* 3. unified key from db */
  console.log("── db tables + key hunt");
  console.log(await exec(`sudo -S -p '' docker cp freellmapi:/app/server/data/freeapi.db /tmp/flm.db <<< ${JSON.stringify(PASS)}; sudo -S -p '' chmod 644 /tmp/flm.db <<< ${JSON.stringify(PASS)}; python3 - << 'EOF'\nimport sqlite3\nc=sqlite3.connect('/tmp/flm.db')\ntables=[r[0] for r in c.execute("select name from sqlite_master where type='table'")]\nprint('tables:',tables)\nfor t in tables:\n    if 'key' in t.lower() or 'setting' in t.lower() or 'config' in t.lower():\n        cols=[d[1] for d in c.execute(f'PRAGMA table_info({t})')]\n        print(t, cols)\n        try:\n            rows=list(c.execute(f'select * from {t} limit 3'))\n            for r in rows: print('   ',str(r)[:150])\n        except Exception as e: print('   err',e)\nEOF`));
} finally {
  conn.end();
}
console.log("\nDONE — stage 2 complete.");
