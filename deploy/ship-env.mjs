#!/usr/bin/env node
/** Ship local .env → VPS /home/jarvis/.env over SFTP. Run: node deploy/ship-env.mjs */
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
const conn = new SSHClient();
conn.once("ready", async () => {
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await new Promise((res, rej) =>
    sftp.fastPut(path.resolve(".env"), "/home/jarvis/.env", (e) => (e ? rej(e) : res()))
  );
  conn.exec("chmod 600 /home/jarvis/.env && ln -sf /home/jarvis/.env /home/jarvis/jarvis/.env && echo ENV_OK", (e, st) => {
    if (e) { console.error(e.message); conn.end(); return; }
    let o = "";
    st.on("data", (d) => (o += d));
    st.on("close", () => { console.log(o.trim()); conn.end(); });
  });
});
conn.once("error", (e) => { console.error("SSH_ERR", e.message); process.exit(1); });
conn.connect({ host: process.env.JARVIS_VPS_HOST, port: 22, username: process.env.JARVIS_VPS_USER, password: process.env.JARVIS_VPS_PASS, readyTimeout: 20000 });
