#!/usr/bin/env node
/**
 * Install OmniRoute on the VPS — replicates the local install exactly:
 *   1. Node 22 (if missing)
 *   2. npm i -g omniroute@<same version as local>
 *   3. Clone local ~/.omniroute (config, API keys, settings) to the VPS
 *   4. Start headless on :20128 + enable boot autostart
 *   5. Verify /v1/models answers
 * Run: node deploy/install-omniroute.mjs
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
if (!HOST || !PASS) { console.error("Set JARVIS_VPS_HOST/USER/PASS in .env"); process.exit(1); }

const HOME = os.homedir();
const OMR_DIR = path.join(HOME, ".omniroute");
const ZIP = path.join(process.env.TEMP || process.env.TMP || ".", "omr-cfg.zip");

// Local omniroute version to pin on the VPS
const localPkg = JSON.parse(
  fs.readFileSync(path.join(HOME, "AppData/Roaming/npm/node_modules/omniroute/package.json"), "utf8")
);
const VERSION = localPkg.version;
console.log(`Local omniroute: v${VERSION} — will install the same on ${HOST}`);

if (!fs.existsSync(OMR_DIR)) { console.error("No local ~/.omniroute found"); process.exit(1); }

// 1) Stage + zip the local config. The live storage.sqlite is locked by the running
//    server — try a raw copy (sqlite usually allows shared reads); if that fails,
//    exclude it (it regenerates) and we mint a fresh API key via the admin API after start.
console.log("Packing local ~/.omniroute (staging copy)…");
const STAGE = path.join(process.env.TEMP || process.env.TMP || ".", "omr-stage", ".omniroute");
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
let dbCloned = true;
for (const f of fs.readdirSync(OMR_DIR)) {
  if (/(\.log$|^logs$|^cache$)/i.test(f)) continue; // noise
  const src = path.join(OMR_DIR, f);
  const dst = path.join(STAGE, f);
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dst, { recursive: true, force: true });
  } else {
    try { fs.copyFileSync(src, dst); } catch { if (/storage\.sqlite/i.test(f)) { dbCloned = false; console.log(`  (skipping locked ${f} — will mint a fresh API key)`); } else console.log(`  (skipping unreadable ${f})`); }
  }
}
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${path.dirname(STAGE)}' -DestinationPath '${ZIP}' -Force"`,
  { stdio: "inherit" }
);
console.log(`  ${(fs.statSync(ZIP).size / 1048576).toFixed(1)} MB (db cloned: ${dbCloned})`);

const conn = new SSHClient();
let sftp;
const sh = (cmd, timeoutMs = 300000) =>
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
const put = (local, remote) =>
  new Promise((res, rej) => sftp.fastPut(path.resolve(local), remote, (e) => (e ? rej(e) : res())));

conn.once("ready", async () => {
  try {
    console.log("SSH OK");

    // Swap first — 842 MB RAM is not enough for npm installs
    let r = await sh("swapon --show 2>/dev/null | grep -q . && echo HAS_SWAP || echo NO_SWAP");
    if (r.o.includes("NO_SWAP")) {
      console.log("Adding 2G swap…");
      r = await sh(
        "sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile && echo SWAP_OK",
        120000
      );
      console.log("swap:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);
    } else console.log("swap: present");

    // Node 22 via official tarball — no apt, no locks, works on any Ubuntu
    r = await sh("node -v 2>/dev/null || echo MISSING");
    if (r.o.trim() === "MISSING") {
      console.log("Installing Node 22 (official tarball)…");
      r = await sh(
        "curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.gz -o /tmp/node.tgz " +
        "&& sudo tar -xzf /tmp/node.tgz -C /usr/local --strip-components=1 && rm /tmp/node.tgz && hash -r && node -v && npm -v",
        420000
      );
      console.log("node:", (r.o.trim() || r.x.trim()).split("\n").join(" | "));
    } else console.log("node:", r.o.trim());

    // omniroute global install (same version as local)
    console.log(`Installing omniroute@${VERSION} (this can take a few minutes on 1 vCPU)…`);
    r = await sh(`sudo npm i -g omniroute@${VERSION} --no-audit --no-fund 2>&1 | tail -3; omniroute --version 2>/dev/null | tail -1`, 600000);
    console.log("install:", (r.o.trim() || r.x.trim()).split("\n").slice(-2).join(" | "));

    // Upload + extract config
    console.log("Uploading config clone…");
    sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
    await put(ZIP, "/home/" + USER + "/omr-cfg.zip");
    r = await sh(`cd /home/${USER} && python3 -m zipfile -e omr-cfg.zip . && rm omr-cfg.zip && ls .omniroute | head -5 && echo CFG_OK`);
    console.log("config:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    // Start headless + enable autostart (systemd user service) + linger for boot
    console.log("Starting OmniRoute headless on :20128 …");
    r = await sh(
      `omniroute autostart enable 2>&1 | tail -2; ` +
      `(nohup omniroute serve >/home/${USER}/omniroute.log 2>&1 &) ; sleep 6; echo STARTED`,
      120000
    );
    console.log(r.o.trim());

    r = await sh(`sudo loginctl enable-linger ${USER} 2>&1 && echo LINGER_OK`, 30000);
    console.log("linger:", (r.o.trim() || r.x.trim()).split("\n").slice(-1)[0]);

    // Verify + fallback key mint if the DB (and its API keys) could not be cloned
    r = await sh("sleep 3; curl -s -o /dev/null -w '%{http_code}' http://localhost:20128/v1/models");
    console.log("HEALTH /v1/models →", r.o.trim());

    if (!dbCloned) {
      console.log("Minting a fresh OmniRoute API key via the admin API…");
      const mint = await sh(
        `node -e "
const h=async(p,o)=>(await fetch('http://localhost:20128'+p,Object.assign({headers:{'Content-Type':'application/json'}},o))).json();
const l=await h('/api/auth/login',{method:'POST',body:JSON.stringify({password:process.env.OMNI_PASS||'CHANGEME'})});
const c=(l.token||l.session||l.token||'')+''.trim();
const cookie='session='+(l.token||l.session||'');
const k=await fetch('http://localhost:20128/api/keys',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:'jarvis-vps'})}).then(r=>r.json()).catch(()=>null);
console.log(JSON.stringify(k||l).slice(0,300));
" 2>&1 | tail -1`
      );
      console.log("  →", (mint.o || mint.x).trim().slice(0, 300));
      console.log("  (if that printed a key, put it in JARVIS_OMNI_KEY on the VPS .env)");
    }

    r = await sh("free -m | head -2");
    console.log(r.o.trim());

    conn.end();
    console.log("DONE — OmniRoute is running on the VPS at localhost:20128");
  } catch (e) {
    console.error("STEP FAIL:", e.message);
    conn.end();
  }
});
conn.once("error", (e) => console.error("SSH_ERR", e.message));
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
