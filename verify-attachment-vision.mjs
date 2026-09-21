#!/usr/bin/env node
/** Boot the built app, upload a PNG with readable text, and verify the vision model reads it.
 *  The PNG is generated with a minimal pure-JS encoder (zlib + CRC). Run: node verify-attachment-vision.mjs */
import { spawn } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const PORT = 50179;
const BASE = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- minimal PNG writer: white 480x120, black text drawn as blocky glyphs is overkill;
// instead render the text with a tiny 5x7 bitmap font for A-Z0-9. We'll write "INVOICE 42K".
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
  N: ["10001","11001","10101","10011","10001","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"],
  Q: ["01110","10001","10001","10001","10101","10010","01101"],
  S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"],
  V: ["10001","10001","10001","10001","10001","01010","00100"],
  W: ["10001","10001","10001","10101","10101","10101","01010"],
  X: ["10001","01010","00100","00100","00100","01010","10001"],
  Y: ["10001","01010","00100","00100","00100","00100","00100"],
  Z: ["11111","00001","00010","00100","01000","10000","11111"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "2": ["01110","10001","00001","00110","01000","10000","11111"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
};

function renderTextPng(text, scale = 6) {
  const W = (text.length * 6 - 1) * scale + 20;
  const H = 7 * scale + 20;
  const px = Buffer.alloc(W * H * 3, 255); // white
  let x = 10;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === "1") {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px_ = x + gx * scale + sx;
                const py = 10 + gy * scale + sy;
                const o = (py * W + px_) * 3;
                px[o] = 0; px[o + 1] = 0; px[o + 2] = 0;
              }
            }
          }
        }
      }
    }
    x += 6 * scale;
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter none
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORT) },
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await wait(500);
    try { up = (await fetch(`${BASE}/api/system`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
  }
  if (!up) throw new Error("server never came up\n" + log.slice(-500));
  console.log("server up");

  const png = renderTextPng("INVOICE 42K");
  fs.writeFileSync("vision-test.png", png);
  console.log("png generated:", png.length, "bytes");

  const fd = new FormData();
  fd.append("file", new File([png], "quote-slip.png", { type: "image/png" }));
  const meta = await (await fetch(`${BASE}/api/attachments`, { method: "POST", body: fd })).json();
  console.log("uploaded id", meta.id);

  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Read the attached image and tell me exactly what it says, then create a lead named after the text on it.", attachment_ids: [meta.id] }),
    signal: AbortSignal.timeout(180000),
  });
  const out = await r.text();
  let text = "", tools = [], p = "";
  for (const l of out.split("\n")) {
    if (!l.startsWith("data: ")) continue;
    try {
      const e = JSON.parse(l.slice(6));
      if (e.type === "tool_start") tools.push(e.name);
      if (e.type === "done") { text = e.text || ""; p = e.provider || ""; }
    } catch {}
  }
  console.log("brain:", p, "| tools:", tools.join(",") || "none");
  console.log("answer:", text.slice(0, 300).replace(/\n/g, " / "));

  // cleanup test rows
  const { DatabaseSync } = await import("node:sqlite");
  const os = await import("node:os");
  const dbPath = `${os.homedir()}/.jarvis-data/jarvis.data.sqlite`;
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const a = db.prepare("delete from attachments where id = ?").run(meta.id);
    const l = db.prepare("delete from leads where company like 'Invoice%'").run();
    console.log("cleanup:", a.changes, "attachment,", l.changes, "lead(s)");
  }
} finally {
  server.kill();
  fs.rmSync("vision-test.png", { force: true });
}
console.log("VISION_VERIFY_DONE");
