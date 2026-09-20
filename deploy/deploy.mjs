#!/usr/bin/env node
/**
 * JARVIS VPS DEPLOYER — ships the prebuilt STANDALONE app to the Azure VM.
 *
 * Usage (from the local machine):
 *   node deploy/deploy.mjs
 *   (credentials come from .env: JARVIS_VPS_HOST, JARVIS_VPS_USER, JARVIS_VPS_PASS)
 *
 * Pipeline:
 *   1. Zip .next/standalone + .next/static + deploy/ + .env locally (PowerShell)
 *   2. SFTP-upload to /opt/jarvis
 *   3. Assemble the standalone layout on the VPS, run provision.sh (swap, systemd)
 *   4. Health-check http://localhost:8080/api/system on the VPS
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const _ssh2 = require("ssh2");
const SSHClient = _ssh2.Client || _ssh2.default || _ssh2;

// Load repo .env (plain KEY=VALUE) — a bare node script has no dotenv of its own.
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const HOST = process.env.JARVIS_VPS_HOST || "172.209.208.171";
const USER = process.env.JARVIS_VPS_USER || "jarvis";
const PASS = process.env.JARVIS_VPS_PASS || "";
const REMOTE = "/opt/jarvis";
const ZIP = path.join(process.env.TEMP || process.env.TMP || ".", "jarvis-bundle.zip");

if (!PASS) {
  console.error("Set JARVIS_VPS_HOST / JARVIS_VPS_USER / JARVIS_VPS_PASS in .env first.");
  process.exit(1);
}
if (!fs.existsSync(".next/standalone/server.js")) {
  console.error("No standalone build — run `npm run build` first (next.config has output:standalone).");
  process.exit(1);
}

const conn = new SSHClient();
let sftp;

function sh(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, opts, (err, stream) => {
      if (err) return reject(err);
      let out = "", errOut = "";
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (errOut += d));
      stream.on("close", (code) => resolve({ code, out, errOut }));
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (local, remote) =>
  new Promise((resolve, reject) => sftp.fastPut(path.resolve(local), remote, (e) => (e ? reject(e) : resolve())));

async function main() {
  // 1) Pack — standalone bundle + client static assets + deploy kit + secrets
  console.log("Packing standalone bundle…");
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path .next/standalone,.next/static,deploy,.env -DestinationPath '${ZIP}' -Force"`,
    { stdio: "inherit" }
  );
  console.log(`  ${(fs.statSync(ZIP).size / 1048576).toFixed(1)} MB packed`);

  // 2) Connect + upload
  await new Promise((resolve, reject) => {
    conn.once("ready", resolve);
    conn.once("error", reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
  });
  console.log(`SSH OK → ${USER}@${HOST}`);
  sftp = await new Promise((resolve, reject) => conn.sftp((e, s) => (e ? reject(e) : resolve(s))));
  await sh(`sudo mkdir -p ${REMOTE} && sudo chown ${USER}:${USER} ${REMOTE}`);

  console.log("Uploading…");
  await put(ZIP, `${REMOTE}/bundle.zip`);

  // 3) Unzip, assemble standalone layout, provision, start
  console.log("Assembling + provisioning (swap, systemd)…");
  const setup = await sh(
    [
      `cd ${REMOTE}`,
      `unzip -oq bundle.zip`,
      `rm bundle.zip`,
      `mkdir -p .next`,
      `cp -r standalone/* . 2>/dev/null || true`,
      `cp -r standalone/.next/* .next/ 2>/dev/null || true`,
      `rm -rf standalone`,
      `cp -r static .next/static`,
      `chmod 600 .env`,
      `sudo bash deploy/provision.sh`,
    ].join(" && "),
    { pty: true }
  );
  console.log(setup.out);
  if (setup.code !== 0) {
    console.error("SETUP FAILED:\n" + setup.errOut);
    process.exit(1);
  }

  // 4) Health check
  await wait(2500);
  const health = await sh(`curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/system`);
  const code = health.out.trim();
  console.log(`Health /api/system → HTTP ${code}`);
  if (code === "200") {
    console.log(`✅ JARVIS IS LIVE at http://${HOST}:8080`);
    console.log("   To expose it to the internet (once):");
    console.log("   az vm open-port -g LEWIS_GROUP -n jarvis --port 8080 --priority 1001");
  } else {
    console.log(`⚠ Service did not answer — diagnose: ssh ${USER}@${HOST} "sudo journalctl -u jarvis -n 50"`);
  }

  conn.end();
}

main().catch((e) => {
  console.error("DEPLOY FAILED:", e.message);
  process.exit(1);
});
