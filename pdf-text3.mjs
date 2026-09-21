#!/usr/bin/env node
/** Extract text from layout-test.pdf via pdfjs (ground truth). */
import fs from "node:fs";

const buf = fs.readFileSync("layout-test.pdf");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
let all = "";
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  all += tc.items.map((it) => it.str).join("\n") + "\n";
}
fs.writeFileSync("layout-text.txt", all);
const squash = all.replace(/\s+/g, "");
const checks = {
  "header band (IMT GENERAL SYSTEM)": /IMTGENERALSYSTEM/i.test(squash),
  "ACCOUNT REFERENCE strip": /ACCOUNTREFERENCE/i.test(squash),
  "doc number on strip": /ACCOUNTREFERENCE:\s*INV-2026-\d+/i.test(squash),
  "Equity box": /EQUITYBANKKENYA/i.test(squash) && /0340184547442/i.test(squash),
  "account name": /LEWISNDUNG'UKINAGA/i.test(squash),
  "M-PESA box": /M-PESA/i.test(squash),
  "paybill code": /555333/.test(squash),
  "TOTAL DUE": /TOTALDUE/i.test(squash),
  "VAT row": /VAT\(16%\)/i.test(squash),
  "amount in words": /amountinwords/i.test(squash),
  "BILLED TO": /BILLEDTO/i.test(squash),
  "status pill": /SENT/i.test(all),
};
for (const [k, ok] of Object.entries(checks)) console.log(ok ? "✓" : "✗", k);
console.log("ALL_OK:", Object.values(checks).every(Boolean));
console.log("--- first 40 lines ---");
console.log(all.split("\n").slice(0, 40).join("\n"));
