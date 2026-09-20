#!/usr/bin/env node
/** Fix omniroute systemd user unit + clean start. Run: node deploy/omr-systemd-fix.mjs */
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

const exec = (cmd, timeout = 30000) => new Promise((res, rej) => {
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
  console.log("── current unit definition:");
  console.log(await exec("systemctl --user cat omniroute.service 2>&1 | grep -vE '^#|^$'"));

  // repair ExecStart if it carries the invalid --headless flag
  console.log("── repairing ExecStart (drop --headless if present)");
  console.log(await exec("sed -i 's/--headless //' ~/.config/systemd/user/omniroute.service 2>/dev/null; systemctl --user daemon-reload 2>&1; grep ExecStart ~/.config/systemd/user/omniroute.service 2>/dev/null || echo NO_UNIT_FILE"));

  console.log("── stop unit + kill strays (bracket pattern, no self-match)");
  console.log(await exec("systemctl --user stop omniroute.service 2>/dev/null; pkill -9 -f '[o]mniroute' 2>/dev/null; sleep 2; ss -ltn | grep 20128 || echo PORT_FREE"));

  console.log("── start via systemd");
  console.log(await exec("systemctl --user start omniroute.service; sleep 8; systemctl --user is-active omniroute.service; ss -ltn | grep 20128 || echo NOT_LISTENING"));

  console.log("── API probes");
  console.log(await exec(`echo v1models=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/v1/models -H "Authorization: Bearer ${APP_KEY}") mgmt=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:20128/api/combos -H "Authorization: Bearer ${APP_KEY}")`));

  console.log("── log tail:");
  console.log(await exec("tail -6 ~/.omniroute/omniroute.log 2>/dev/null; journalctl --user -u omniroute.service -n 5 --no-pager 2>/dev/null | tail -5"));
} finally {
  conn.end();
}
