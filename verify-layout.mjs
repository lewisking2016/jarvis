#!/usr/bin/env node
/** Boot the built app, create a test invoice, render its PDF to PNG, verify text. */
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 50184;
const BASE = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!up) throw new Error("server never came up\n" + log.slice(-400));
  console.log("server up");

  // create the test invoice via the documents API
  const mut = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "INVOICE",
      client: "KCB BANK PLAZA LTD (LAYOUT TEST)",
      client_phone: "0711000999",
      items: [
        { description: "CCTV camera supply & installation", qty: 6, unit_price: 18000 },
        { description: "Network cabling & switch config", qty: 1, unit_price: 15000 },
      ],
      tax_rate: 16,
      status: "sent",
      due_date: "2026-10-05",
      payment_info: "M-PESA · 555333",
    }),
  });
  const mj = await mut.json();
  const id = mj.document?.id;
  console.log("test doc id:", id, mut.status);

  const res = await fetch(`${BASE}/api/documents/${id}/pdf`, { signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync("layout-test.pdf", buf);
  console.log("pdf bytes:", buf.length, "| magic:", buf.slice(0, 4).toString());

  // text-extract to verify all bank-grade elements
  const zlib = await import("node:zlib");
  let text = "";
  const raw = buf.toString("latin1");
  for (const c of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { text += zlib.inflateSync(Buffer.from(c[1], "latin1")).toString("latin1"); } catch {}
  }
  text += raw;
  let dec = "";
  for (const m of text.matchAll(/\(([^)]{2,})\)\s*Tj|\[([^\]]*)\]\s*TJ/g)) {
    const seg = m[1] ?? m[2] ?? "";
    dec += seg.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  }
  const squash = dec.replace(/\s+/g, "");
  const checks = {
    "header band (IMT GENERAL SYSTEM)": /IMTGENERALSYSTEM/i.test(squash),
    "ACCOUNT REFERENCE strip": /ACCOUNTREFERENCE/i.test(squash),
    "Equity box": /EQUITYBANKKENYA/i.test(squash) && /0340184547442/i.test(squash),
    "M-PESA box": /M-PESA/i.test(squash),
    "paybill code": /555333/.test(squash),
    "TOTAL DUE": /TOTALDUE/i.test(squash),
    "VAT row": /VAT\(16%\)/i.test(squash),
    "amount in words": /amountinwords/i.test(squash),
    "KES total": /KES/i.test(dec),
  };
  for (const [k, ok] of Object.entries(checks)) console.log(ok ? "✓" : "✗", k);
  console.log("ALL_OK:", Object.values(checks).every(Boolean));

  // render page 1 to PNG for visual check
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(() => null);
    if (pdfjs) {
      const docc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const page = await docc.getPage(1);
      const vp = page.getViewport({ scale: 1.4 });
      const canvas = (await import("canvas").catch(() => null));
      if (canvas) {
        const cv = canvas.createCanvas(vp.width, vp.height);
        const ctx = cv.getContext("2d");
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        fs.writeFileSync("layout-page1.png", cv.toBuffer("image/png"));
        console.log("PNG rendered: layout-page1.png");
      }
    }
  } catch (e) { console.log("render skip:", e.message.slice(0, 60)); }

  // cleanup the test doc
  const del = await fetch(`${BASE}/api/documents?id=${id}`, { method: "DELETE" });
  console.log("cleanup:", del.status);
} finally {
  server.kill();
}
console.log("LAYOUTVERIFY_DONE");
