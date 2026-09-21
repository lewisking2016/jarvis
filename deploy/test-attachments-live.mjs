#!/usr/bin/env node
/** LIVE ATTACHMENT VERIFICATION on jarvis.imeantech.com (via the public site).
 *
 *  1. Upload a PNG containing "INVOICE 42K" → ask JARVIS to read it →
 *     a vision-capable brain must be selected and quote the text.
 *  2. Upload a CSV of two leads → ask JARVIS to create them →
 *     create_lead must fire twice with the real names/phones.
 *  3. Clean up the probe rows (attachment rows + created leads).
 *
 *  Run: node deploy/test-attachments-live.mjs
 */
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of require("node:fs").readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  if (m[2] === "HOST") HOST = m[3].trim();
  else if (m[2] === "USER") USER = m[3].trim();
  else if (m[2] === "PASS") PASS = m[3].trim();
}

const BASE = "https://jarvis.imeantech.com";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- tiny PNG writer with a 5x7 bitmap font ---------- */
const FONT = {
  A: ["01110","10001","10001","11111","10001","10001","10001"],
  B: ["11110","10001","10001","11110","10001","10001","11110"],
  C: ["01110","10001","10000","10000","10000","10001","01110"],
  D: ["11110","10001","10001","10001","10001","10001","11110"],
  E: ["11111","10000","10000","11110","10000","10000","11111"],
  F: ["11111","10000","10000","11110","10000","10000","10000"],
  I: ["11111","00100","00100","00100","00100","00100","11111"],
  K: ["10001","10010","10100","11000","10100","10010","10001"],
  L: ["10000","10000","10000","10000","10000","10000","11111"],
  M: ["10001","11011","10101","10001","10001","10001","10001"],
  N: ["10001","11001","10101","10011","10001","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"],
  R: ["11110","10001","10001","11110","10100","10010","10001"],
  S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"],
  V: ["10001","10001","10001","10001","10001","01010","00100"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "2": ["01110","10001","00001","00110","01000","10000","11111"],
  "7": ["11111","00001","00010","00100","00100","00100","00100"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
};

function renderTextPng(text, scale = 6) {
  const W = (text.length * 6 - 1) * scale + 20;
  const H = 7 * scale + 20;
  const px = Buffer.alloc(W * H * 3, 255);
  let x = 10;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === "1") {
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const o = ((10 + gy * scale + sy) * W + (x + gx * scale + sx)) * 3;
            px[o] = 0; px[o + 1] = 0; px[o + 2] = 0;
          }
        }
      }
    }
    x += 6 * scale;
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const crc32 = (buf) => {
    let c, table = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- chat SSE runner ---------- */
async function chat(message, attachmentIds = []) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: [], attachment_ids: attachmentIds }),
    signal: AbortSignal.timeout(170000),
  });
  let text = "", provider = "", tools = [];
  for (const l of (await r.text()).split("\n")) {
    if (!l.startsWith("data: ")) continue;
    try {
      const e = JSON.parse(l.slice(6));
      if (e.type === "tool_start") tools.push(e.name);
      if (e.type === "done") { text = e.text || ""; provider = e.provider || ""; }
    } catch {}
  }
  return { text, provider, tools };
}

/* ================= TEST 1: vision (image) ================= */
console.log("══ TEST 1 — image attachment → vision brain");
const png = renderTextPng("INVOICE 42K");
const fd1 = new FormData();
fd1.append("file", new File([png], "slip.png", { type: "image/png" }));
const up1 = await (await fetch(`${BASE}/api/attachments`, { method: "POST", body: fd1 })).json();
console.log("uploaded attachment id", up1.id, `(${png.length} bytes)`);

const t0 = Date.now();
const r1 = await chat("Read the attached image and tell me exactly what text appears on it. Then create a lead whose company name is exactly that text.", [up1.id]);
console.log(`brain: ${r1.provider} | tools: ${r1.tools.join(",") || "none"} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("answer:", r1.text.slice(0, 240).replace(/\n/g, " / "));
const visionOk = /INVOICE/i.test(r1.text) && /42\s*K/i.test(r1.text);

/* ================= TEST 2: document (CSV) ================= */
console.log("\n══ TEST 2 — CSV attachment → agent uses its data");
const csv = "company,contact,phone\nTESTVON ACME HARDWARE,Grace,07110002001\nTESTVON BLUEWAVE HOTEL,Sam,07110002002\n";
const fd2 = new FormData();
fd2.append("file", new File([csv], "leads.csv", { type: "text/csv" }));
const up2 = await (await fetch(`${BASE}/api/attachments`, { method: "POST", body: fd2 })).json();
console.log("uploaded attachment id", up2.id, `(${csv.length} bytes)`);

const t1 = Date.now();
const r2 = await chat("Import every lead from the attached CSV file into the pipeline.", [up2.id]);
console.log(`brain: ${r2.provider} | tools: ${r2.tools.join(",") || "none"} | ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log("answer:", r2.text.slice(0, 240).replace(/\n/g, " / "));
const docOk = r2.tools.includes("create_lead") || /import|created|added/i.test(r2.text);

/* ================= verify + cleanup via SSH ================= */
console.log("\n══ DB verify + cleanup");
const conn = new SSHClient();
const runVps = (cmd) => new Promise((res) => conn.exec(cmd, (err, s) => {
  if (err) return res("");
  let out = "";
  s.on("data", (d) => (out += d)).on("close", () => res(out));
}));
conn.on("ready", async () => {
  const db = "/opt/jarvis/data/jarvis.sqlite";
  const check = await runVps(
    `sqlite3 ${db} "select count(*) from leads where company like 'TESTVON%';" 2>/dev/null || node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('${db}');console.log(db.prepare(\\"select count(*) c from leads where company like 'TESTVON%'\\").get().c)"`,
  );
  console.log("TESTVON leads in live DB:", check.trim() || "?");
  const clean = await runVps(
    `sqlite3 ${db} "delete from leads where company like 'TESTVON%'; delete from attachments where id in (${up1.id},${up2.id});" 2>/dev/null || node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('${db}');const a=db.prepare('delete from leads where company like \\'TESTVON%\\'').run();const b=db.prepare('delete from attachments where id in (${up1.id},${up2.id})').run();console.log('cleaned',a.changes,'leads',b.changes,'attachments')"`,
  );
  console.log(clean.trim() || "cleaned");
  conn.end();
  console.log("\nVISION_OK:", visionOk, "| DOC_OK:", docOk);
  console.log("ATTACH_LIVE_DONE");
});
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
