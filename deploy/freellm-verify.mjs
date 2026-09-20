#!/usr/bin/env node
/** Restart freellmapi with the key config and verify live chat. Run: node deploy/freellm-verify.mjs */
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
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000,
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

const UNIFIED = (fs.readFileSync(".env", "utf8").match(/^FREELLMAPI_API_KEY=(.+)$/m) || [, ""])[1].trim();

try {
  const S = JSON.stringify(PASS);
  console.log("── force-recreate with key config");
  console.log(await exec(`sudo -S -p '' docker compose -f /home/jarvis/freellmapi/docker-compose.yml up -d --force-recreate <<< ${S} 2>&1 | tail -2`, 120000));
  await new Promise((r) => setTimeout(r, 15000));
  console.log(await exec(`sudo -S -p '' docker ps --format '{{.Names}} {{.Status}}' <<< ${S}`));
  console.log(await exec(`sudo -S -p '' docker logs freellmapi --tail 6 2>&1 <<< ${S}`));

  console.log("── keys registered (db re-read)");
  console.log(await exec(
    `sudo -S -p '' rm -rf /tmp/flm <<< ${S}; mkdir -p /tmp/flm && sudo -S -p '' docker exec freellmapi tar -C /app/server/data -cf - . <<< ${S} | tar -C /tmp/flm -xf - && python3 - << 'PYEOF'
import sqlite3
c = sqlite3.connect('/tmp/flm/freeapi.db')
for row in c.execute('select platform, label, status, enabled from api_keys'):
    print('  key:', row)
print('  unified:', list(c.execute("select value from settings where key='unified_api_key'")))
PYEOF`));

  console.log("── LIVE CHAT through the unified endpoint (nvidia + openrouter + huggingface keys)");
  const t = await exec(
    `time curl -s --max-time 75 http://localhost:3001/v1/chat/completions -H "Authorization: Bearer ${UNIFIED}" -H "Content-Type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"Reply with exactly: FREELLMAPI ONLINE"}],"max_tokens":30}' | head -c 500; echo`,
    90000);
  console.log(t.trim());
} finally {
  conn.end();
}
console.log("\nDONE");
