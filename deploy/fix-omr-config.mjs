#!/usr/bin/env node
/**
 * Fix the OmniRoute config clone on the VPS.
 * Root cause: PowerShell Compress-Archive wrote backslash paths → python zipfile
 * extracted them as flat garbage files. Re-ship as a real tar (POSIX paths),
 * clean up, restart OmniRoute, verify the 'jarvis' API key validates.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const HOST = process.env.JARVIS_VPS_HOST;
const USER = process.env.JARVIS_VPS_USER;
const PASS = process.env.JARVIS_VPS_PASS;
const KEY = process.env.JARVIS_OMNI_KEY || process.env.OMNIROUTE_API_KEY || "";
const STAGE = path.join(process.env.TEMP || process.env.TMP || ".", "omr-stage");
const TGZ = path.join(STAGE, "omr-cfg.tgz");

console.log("Packing staged config as tar…");
execSync("tar -czf omr-cfg.tgz .omniroute", { cwd: STAGE, stdio: "inherit" });
console.log(`  ${(fs.statSync(TGZ).size / 1048576).toFixed(1)} MB`);

const conn = new SSHClient();
let sftp;
const sh = (cmd, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    conn.exec(cmd, (e, st) => {
      if (e) return reject(e);
      let o = "", x = "";
      const t = setTimeout(() => { try { st.signal("KILL"); } catch {} }, timeoutMs);
      st.on("data", (d) => (o += d));
      st.stderr.on("data", (d) => (x += d));
      st.on("close", (c) => { clearTimeout(t); resolve({ c, o, x }); });
    });
  });
const put = (l, r) => new Promise((res, rej) => sftp.fastPut(path.resolve(l), r, (e) => (e ? rej(e) : res())));

conn.once("ready", async () => {
  try {
    sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
    console.log("SSH OK — uploading tar…");
    await put(TGZ, `/home/${USER}/omr-cfg.tgz`);

    console.log("Cleaning garbage + extracting…");
    let r = await sh(
      `cd /home/${USER} && rm -f omr-stage* && tar -xzf omr-cfg.tgz -C ~ && rm omr-cfg.tgz && ls .omniroute | head -8 && echo EXTRACT_OK`
    );
    console.log((r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    console.log("Restarting OmniRoute with the real config…");
    r = await sh(
      `omniroute stop >/dev/null 2>&1; sleep 2; (nohup omniroute serve >/home/${USER}/omniroute.log 2>&1 &); sleep 8; echo RESTARTED`,
      90000
    );
    console.log((r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    r = await sh(`curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ${KEY}' http://localhost:20128/v1/models`);
    console.log("KEY CHECK /v1/models →", r.o.trim(), r.o.trim() === "200" ? "✅ config clone verified" : "✗ still rejecting");

    conn.end();
  } catch (e) {
    console.error("STEP FAIL:", e.message);
    conn.end();
  }
});
conn.once("error", (e) => console.error("SSH_ERR", e.message));
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
