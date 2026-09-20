#!/usr/bin/env node
/**
 * RESUME DEPLOY — the bundle is already on the VPS; extract (python3), assemble,
 * provision and health-check. Run: node deploy/resume.mjs
 */
import fs from "node:fs";
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
const R = "/opt/jarvis";

const conn = new SSHClient();
const sh = (cmd, timeoutMs = 180000) =>
  new Promise((resolve, reject) => {
    conn.exec(cmd, (e, st) => {
      if (e) return reject(e);
      let o = "", x = "";
      const t = setTimeout(() => st.signal("KILL"), timeoutMs);
      st.on("data", (d) => (o += d));
      st.stderr.on("data", (d) => (x += d));
      st.on("close", (c) => { clearTimeout(t); resolve({ c, o, x }); });
    });
  });

conn.once("ready", async () => {
  try {
    let r = await sh("which python3 || which unzip");
    console.log("extractor:", r.o.trim() || "NONE");

    // Node runtime — the standalone server needs it; install if missing.
    r = await sh("node -v 2>/dev/null || echo MISSING");
    if (r.o.trim() === "MISSING") {
      console.log("Installing Node 22 (one-time, ~1 min)…");
      r = await sh("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y nodejs >/dev/null 2>&1; node -v", 300000);
      console.log("node:", r.o.trim() || r.x.trim());
    } else console.log("node:", r.o.trim());

    r = await sh(`cd ${R} && python3 -m zipfile -e bundle.zip . && rm bundle.zip && echo EXTRACT_OK`);
    console.log("extract:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    r = await sh(`cd ${R} && mkdir -p .next && cp -r standalone/. . && rm -rf standalone && cp -r static .next/static && echo ASSEMBLE_OK`);
    console.log("assemble:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    r = await sh(`chmod 600 ${R}/.env && cd ${R} && sudo bash deploy/provision.sh 2>&1 | tail -20`, 240000);
    console.log("provision:\n" + (r.o || r.x));

    r = await sh("sleep 2; curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/system");
    console.log("HEALTH:", r.o.trim());

    conn.end();
  } catch (e) {
    console.error("STEP FAIL:", e.message);
    conn.end();
  }
});
conn.once("error", (e) => console.error("SSH_ERR", e.message));
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
