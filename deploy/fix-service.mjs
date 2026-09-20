#!/usr/bin/env node
/** Pull latest on VPS, reinstall unit (fixed node path), restart, verify. Run: node deploy/fix-service.mjs */
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
const sh = (cmd, t = 180000) =>
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
    let r = await sh("git -C ~/jarvis pull --ff-only 2>&1 | tail -1");
    console.log("pull:", r.o.trim());

    r = await sh(
      "sudo cp ~/jarvis/deploy/jarvis.service /etc/systemd/system/jarvis.service && sudo systemctl daemon-reload && sudo systemctl restart jarvis && sleep 6 && systemctl is-active jarvis"
    );
    console.log("service:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    r = await sh('curl -s -o /dev/null -w "health:%{http_code}" http://localhost:8080/api/system; echo');
    console.log(r.o.trim());

    r = await sh("curl -s http://localhost:8080/api/system | head -c 300; echo");
    console.log("body:", r.o.trim());

    r = await sh("free -m | sed -n 2p; ps aux | grep -c \"[n]ext start\"");
    console.log(r.o.trim());
    conn.end();
  } catch (e) {
    console.error("FAIL", e.message);
    conn.end();
  }
});
conn.once("error", (e) => console.log("SSH_ERR", e.message));
conn.connect({ host: process.env.JARVIS_VPS_HOST, port: 22, username: process.env.JARVIS_VPS_USER, password: process.env.JARVIS_VPS_PASS, readyTimeout: 15000 });
