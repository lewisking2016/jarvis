#!/usr/bin/env node
/** Inspect VPS OmniRoute auth/flags. Run: node deploy/omr-inspect.mjs */
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

const exec = (cmd, timeout = 20000) => new Promise((res, rej) => {
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
  console.log("── serve --help (auth-related flags)");
  console.log(await exec("omniroute serve --help 2>&1 | grep -iE 'token|auth|key|headless|port' | head -12"));
  console.log("── ~/.omniroute contents");
  console.log(await exec("ls -la ~/.omniroute/ 2>&1 | head -15"));
  console.log("── json/config files");
  console.log(await exec("for f in ~/.omniroute/*.json ~/.omniroute/*.yaml ~/.omniroute/*.toml; do [ -f \"$f\" ] && echo \"== $f\" && head -c 600 \"$f\" && echo; done 2>/dev/null"));
  console.log("── running process cmdline");
  console.log(await exec("pgrep -f omniroute | head -3 | while read p; do echo \"PID $p: $(tr '\\0' ' ' < /proc/$p/cmdline)\"; done"));
  console.log("── process env (tokens only)");
  console.log(await exec("pgrep -f 'omniroute' | head -1 | while read p; do tr '\\0' '\\n' < /proc/$p/environ | grep -iE 'OMNI|TOKEN|KEY' | sed 's/=.*$/=<redacted-present>/'; done"));
  console.log("── systemd user units / crontab that might start it");
  console.log(await exec("systemctl --user list-units 2>/dev/null | grep -i omni; crontab -l 2>/dev/null | grep -i omni; ls ~/.config/systemd/user/ 2>/dev/null"));
} finally {
  conn.end();
}
