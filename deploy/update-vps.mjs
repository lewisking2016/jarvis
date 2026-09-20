#!/usr/bin/env node
/**
 * One-command VPS update — run from the dev machine after pushing to GitHub:
 *   node deploy/update-vps.mjs
 * Pulls latest master on the VPS clone, runs provision (install+build+restart), health-checks.
 */
import fs from "node:fs";
import path from "node:path";
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
if (!HOST || !PASS) { console.error("Set JARVIS_VPS_HOST/USER/PASS in .env"); process.exit(1); }

const conn = new SSHClient();
const sh = (cmd, t = 600000) =>
  new Promise((res, rej) => {
    conn.exec(cmd, (e, st) => {
      if (e) return rej(e);
      let o = "", x = "";
      const to = setTimeout(() => { try { st.signal("KILL"); } catch {} }, t);
      st.on("data", (d) => (o += d));
      st.stderr.on("data", (d) => (x += d));
      st.on("close", () => { clearTimeout(to); res({ o, x }); });
    });
  });

conn.once("ready", async () => {
  try {
    console.log("── pull");
    let r = await sh("git -C ~/jarvis pull --ff-only 2>&1 | tail -3");
    console.log(r.o.trim() || r.x.trim());

    console.log("── provision (npm ci on first run, build, restart)…");
    r = await sh("bash ~/jarvis/deploy/provision-vps.sh 2>&1 | tail -25", 900000);
    console.log(r.o.trim());
    if (r.x.trim()) console.log("stderr:", r.x.trim().split("\n").slice(-3).join("\n"));

    console.log("── done");
    conn.end();
  } catch (e) {
    console.error("UPDATE FAILED:", e.message);
    conn.end();
    process.exit(1);
  }
});
conn.once("error", (e) => { console.error("SSH_ERR", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
