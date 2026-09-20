#!/usr/bin/env node
/**
 * FREELLMAPI VPS DEPLOY — aggregates 34 free providers / 635 endpoints behind
 * one OpenAI-compatible /v1 on the VPS (Docker), with our existing provider
 * keys injected via the idempotent declarative boot config.
 *
 * Run: node deploy/freellm-deploy.mjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
const ENV = {};
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  ENV[m[1]] = m[2].trim();
  if (m[1] === "JARVIS_VPS_HOST") HOST = m[2].trim();
  else if (m[1] === "JARVIS_VPS_USER") USER = m[2].trim();
  else if (m[1] === "JARVIS_VPS_PASS") PASS = m[2].trim();
}

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000, keepaliveInterval: 10000,
}));

const exec = (cmd, timeout = 120000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error(`timeout: ${cmd.slice(0, 60)}`)), timeout);
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", (code) => { clearTimeout(to); res({ out, code }); });
  });
});

// sudo without a tty; password comes from .env, never printed
const sudo = (cmd, timeout) => exec(`sudo -S -p '' bash -c ${JSON.stringify(cmd)} <<< ${JSON.stringify(PASS)}`, timeout);

function sftp() { return new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s)))); }
const put = (s, local, remote) => new Promise((res, rej) => s.fastPut(local, remote, (e) => (e ? rej(e) : res())));

try {
  /* 1. docker present? */
  let dk = await exec("docker --version 2>/dev/null; docker compose version 2>/dev/null");
  if (!/Docker version/.test(dk.out)) {
    console.log("── installing Docker (this takes a few minutes)…");
    await sudo("apt-get update -qq && apt-get install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1; echo APT_DONE", 420000);
    await sudo("systemctl enable --now docker >/dev/null 2>&1; usermod -aG docker " + USER + "; echo DOCKER_READY", 60000);
  } else {
    console.log("── docker present:", dk.out.trim().split("\n")[0]);
  }

  /* 2. prepare ~/freellmapi */
  await exec("mkdir -p ~/freellmapi");
  const stamp = new Date().toISOString().slice(0, 10);

  await exec(`[ -f ~/freellmapi/.env ] || echo "ENCRYPTION_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > ~/freellmapi/.env; grep -q '^PORT=' ~/freellmapi/.env || echo "PORT=3001" >> ~/freellmapi/.env; grep -q ENCRYPTION_KEY ~/freellmapi/.env && echo ENV_OK`);

  /* platform slugs verified against the running server's models table:
     nvidia, openrouter, huggingface, cloudflare, google, groq, cohere… */
  const config = {
    keys: [
      ...(ENV.NVIDIA_API_KEY ? [{ platform: "nvidia", key: ENV.NVIDIA_API_KEY, label: "main" }] : []),
      ...(ENV.OPENROUTER_API_KEY ? [{ platform: "openrouter", key: ENV.OPENROUTER_API_KEY, label: "main" }] : []),
      ...(ENV.HUGGINGFACE_API_KEY ? [{ platform: "huggingface", key: ENV.HUGGINGFACE_API_KEY, label: "main" }] : []),
    ],
    routing: { strategy: "balanced" },
  };
  await exec(`cat > ~/freellmapi/freellmapi.config.json << 'EOFCFG'\n${JSON.stringify(config, null, 1)}\nEOFCFG\necho CONFIG_WRITTEN`);

  const compose = `services:\n  freellmapi:\n    image: ghcr.io/tashfeenahmed/freellmapi:latest\n    container_name: freellmapi\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:3001:3001"\n    env_file: .env\n    environment:\n      - FREEAPI_CONFIG_PATH=/app/freellmapi.config.json\n    volumes:\n      - freellmapi-data:/app/server/data\n      - ./freellmapi.config.json:/app/freellmapi.config.json:ro\nvolumes:\n  freellmapi-data:\n`;
  await exec(`cat > ~/freellmapi/docker-compose.yml << 'EOFCOMP'\n${compose}EOFCOMP\necho COMPOSE_WRITTEN`);

  /* 3. pull + start (prebuilt image — nothing compiles on the VPS; sudo for socket access) */
  console.log("── pulling + starting container…");
  const up = await sudo("cd /home/jarvis/freellmapi && docker compose up -d 2>&1 | tail -4; sleep 6; docker ps --format '{{.Names}} {{.Status}}' | head -5", 420000);
  console.log(up.out.trim());

  /* 4. health */
  const health = await exec("curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3001/v1/models; echo; curl -s --max-time 10 http://localhost:3001/v1/models | head -c 200");
  console.log("── /v1/models →", health.out.trim().slice(0, 220));

  /* 5. unified API key (dashboard generates one; find it) */
  const keyhunt = await sudo("docker logs freellmapi 2>&1 | grep -i -E 'unified|api key|listening|ready' | head -8", 30000);
  console.log("── key hunt:\n" + keyhunt.out.trim());
} finally {
  conn.end();
}
console.log("\nDONE — freellmapi deploy step complete.");
