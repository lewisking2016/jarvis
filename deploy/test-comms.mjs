#!/usr/bin/env node
/** Comms test on the VPS: LinkedIn draft + follow-up + WhatsApp tool status. Run: node deploy/test-comms.mjs */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  if (m[2] === "HOST") HOST = m[3].trim(); else if (m[2] === "USER") USER = m[3].trim(); else if (m[2] === "PASS") PASS = m[3].trim();
}
if (!PASS) PASS = process.env.JARVIS_VPS_PASS || "";

const conn = new SSHClient();
const run = (cmd, timeout = 150_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ out: "EXEC_ERR " + String(err) });
    let out = "";
    const t = setTimeout(() => { out += "\n[TIMEOUT]"; stream.close(); }, timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d)).on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  console.log("── [1] live directive: LinkedIn draft + follow-up (comms skills, no PII)");
  const chat = await run(
    `curl -s -m 130 -X POST http://localhost:8080/api/chat -H 'Content-Type: application/json' ` +
    `-d '{"message":"Draft a LinkedIn DM to Nairobi Solar Group, contact Jane Mwangi, pitching IMT AI automation, and schedule a follow-up about it in 3 days. Confirm both."}' ` +
    `| grep -o '\"type\":\"[a-z_]*\"' | sort | uniq -c; echo; curl -s -m 130 -X POST http://localhost:8080/api/chat -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1; true`,
    140_000
  );
  console.log(chat.out || "(no output)");

  console.log("── [2] activity feed (last comms events)");
  console.log((await run(`curl -s -m 8 http://localhost:8080/api/activity | python3 -c "import sys,json; d=json.load(sys.stdin); a=d if isinstance(d,list) else d.get('activity',[]); [print(x.get('action'),'—',str(x.get('detail'))[:90]) for x in a[:8]]"`)).out);

  console.log("── [3] approvals table (linkedin_dm rows)");
  console.log((await run(`cd ~ && node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.HOME+'/.jarvis-data/jarvis.db',{readOnly:true});console.log(JSON.stringify(db.prepare(\\\"SELECT id,kind,status,substr(summary,1,80) s FROM approvals ORDER BY id DESC LIMIT 5\\\").all()));db.close()" 2>&1 | tail -2`)).out);

  console.log("── [4] tasks table (follow-ups)");
  console.log((await run(`cd ~ && node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.HOME+'/.jarvis-data/jarvis.db',{readOnly:true});console.log(JSON.stringify(db.prepare(\\\"SELECT id,title,due,status FROM tasks ORDER BY id DESC LIMIT 5\\\").all()));db.close()" 2>&1 | tail -2`)).out);

  console.log("── [5] WhatsApp tool status (expects guided not-configured message if key absent)");
  console.log((await run(`grep -c WHATSAPP ~/.env 2>/dev/null; echo "env keys:"; grep -o '^WHATSAPP[A-Z_]*' ~/.env 2>/dev/null || echo none`)).out);
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
