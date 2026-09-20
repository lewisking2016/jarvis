#!/usr/bin/env node
/** Clone https://github.com/lewisking2016/jarvis.git on the VPS. Run: node deploy/clone-on-vps.mjs */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const conn = new SSHClient();
const sh = (cmd, t = 300000) =>
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
    let r = await sh("which git || echo NO_GIT");
    if (r.o.includes("NO_GIT")) {
      console.log("installing git…");
      r = await sh("sudo apt-get install -y git >/dev/null 2>&1 && git --version", 300000);
      console.log("git:", (r.o.trim() || "installed").split("\n").slice(-1)[0]);
    } else console.log("git: present");

    r = await sh("rm -rf ~/jarvis && git clone --depth 1 https://github.com/lewisking2016/jarvis.git ~/jarvis 2>&1 | tail -2; ls ~/jarvis | head -10");
    console.log(r.o.trim() || r.x.trim());
    conn.end();
  } catch (e) {
    console.error("FAIL", e.message);
    conn.end();
  }
});
conn.once("error", (e) => console.log("SSH_ERR", e.message));
conn.connect({ host: process.env.JARVIS_VPS_HOST, port: 22, username: process.env.JARVIS_VPS_USER, password: process.env.JARVIS_VPS_PASS, readyTimeout: 15000 });
