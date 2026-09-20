import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { getDb } from "./db";

/**
 * IMT DOCUMENT TEMPLATES v2 — premium letterhead design for QUOTE / INVOICE / RECEIPT.
 * Design system: one accent color, strong type hierarchy, dark table header,
 * zebra rows, status badges, prominent totals band, boxed payment block,
 * signature lines on quotations, green PAID treatment on receipts.
 */

const ACCENT = "#0e7490"; // IMT cyan
const ACCENT_DARK = "#155e75";
const INK = "#0f172a";
const DIM = "#64748b";
const LINE = "#cbd5e1";
const SOFT = "#f1f5f9";
const GOOD = "#047857";
const WARN = "#b45309";
const BAD = "#b91c1c";

export interface DocRow {
  id: number;
  kind: string;
  number: string;
  client: string;
  client_phone: string | null;
  items_json: string;
  currency: string;
  tax_rate: number;
  total: number;
  status: string;
  due_date: string | null;
  created_at: string;
  linked_doc?: number | null;
}

/* ---------- amount in words (English, for the legal line) ---------- */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function chunkToWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + chunkToWords(n % 100) : "");
}

function amountToWords(amount: number): string {
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  if (whole === 0 && cents === 0) return "zero";
  const parts: string[] = [];
  const scales: [number, string][] = [[1_000_000, "million"], [1_000, "thousand"]];
  let rest = whole;
  for (const [scale, name] of scales) {
    if (rest >= scale) {
      parts.push(chunkToWords(Math.floor(rest / scale)) + " " + name);
      rest %= scale;
    }
  }
  if (rest > 0) parts.push(chunkToWords(rest));
  const words = parts.join(" ") || "zero";
  return cents > 0 ? `${words} and ${cents}/100` : words;
}

/* ---------- status badge palette ---------- */

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (["paid", "issued", "accepted", "won"].includes(s)) return GOOD;
  if (["draft", "pending"].includes(s)) return WARN;
  if (["overdue", "void", "rejected"].includes(s)) return BAD;
  return ACCENT_DARK; // sent, partial, …
}

/* ---------- main renderer ---------- */

export function renderDocumentPdf(doc: DocRow): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "A4", margin: 50, info: { Author: "IMT General System", Title: doc.number } });
      const chunks: Buffer[] = [];
      pdf.on("data", (c: Buffer) => chunks.push(c));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);

      const items = JSON.parse(doc.items_json) as { description: string; qty: number; unit_price: number; ref?: string }[];
      const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const tax = subtotal * (doc.tax_rate / 100);
      const isInvoice = doc.kind === "INVOICE";
      const isReceipt = doc.kind === "RECEIPT";
      const label = isInvoice ? "INVOICE" : isReceipt ? "RECEIPT" : "QUOTATION";
      const cur = doc.currency || "KES";
      const fmt = (n: number): string => `${cur} ${n.toLocaleString()}`;

      const W = 612, L = 50, R = 562, CW = R - L; // content box

      /* ── left accent spine + top band ── */
      pdf.rect(0, 0, 6, 792).fill(ACCENT);
      pdf.rect(0, 0, W, 6).fill(ACCENT);

      /* ── header: brand block left, doc identity right ── */
      const logoPath = path.join(process.cwd(), "public", "imtblack.png");
      if (fs.existsSync(logoPath)) {
        try { pdf.image(logoPath, L, 26, { height: 42 }); } catch { /* logo optional */ }
      }
      pdf.fillColor(INK).font("Helvetica-Bold").fontSize(19).text("IMT GENERAL SYSTEM", 102, 30);
      pdf.font("Helvetica").fontSize(8.5).fillColor(DIM)
        .text("imeantech.com   ·   info@imeantech.com   ·   Nairobi, Kenya", 102, 53);

      pdf.font("Helvetica-Bold").fontSize(21).fillColor(ACCENT).text(label, 340, 28, { width: 222, align: "right" });
      pdf.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(doc.number, 340, 52, { width: 222, align: "right" });

      // status badge pill
      const badgeTxt = doc.status.toUpperCase();
      pdf.font("Helvetica-Bold").fontSize(7.5);
      const bw = pdf.widthOfString(badgeTxt) + 14;
      const bx = R - bw, by = 68;
      pdf.roundedRect(bx, by, bw, 14, 7).fillAndStroke(statusColor(doc.status), statusColor(doc.status));
      pdf.fillColor("#ffffff").text(badgeTxt, bx + 7, by + 4, { width: bw - 14, align: "center" });

      pdf.moveTo(L, 92).lineTo(R, 92).lineWidth(1).strokeColor(LINE).stroke();

      /* ── parties: client left, meta card right ── */
      const partyLabel = isInvoice ? "BILLED TO" : isReceipt ? "RECEIVED FROM" : "PREPARED FOR";
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(ACCENT_DARK).text(partyLabel, L, 106);
      pdf.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(doc.client, L, 119);
      if (doc.client_phone) pdf.font("Helvetica").fontSize(9).fillColor(DIM).text(doc.client_phone, L, 136);

      // meta card
      const metaRows: [string, string][] = [["Date", doc.created_at.slice(0, 10)]];
      if (isInvoice && doc.due_date) metaRows.push(["Due date", doc.due_date.slice(0, 10)]);
      if (!isInvoice && !isReceipt) metaRows.push(["Valid for", "30 days"]);
      if (isReceipt && doc.linked_doc) {
        const linked = getDb().prepare("SELECT number FROM documents WHERE id = ?").get(doc.linked_doc) as { number: string } | undefined;
        if (linked) metaRows.push(["Payment for", linked.number]);
      }
      const mh = 16 + metaRows.length * 15 + 6;
      const my = 100;
      pdf.roundedRect(400, my, 162, mh, 4).fill(SOFT);
      let myy = my + 10;
      for (const [k, v] of metaRows) {
        pdf.font("Helvetica").fontSize(8).fillColor(DIM).text(k, 410, myy);
        pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(v, 410, myy, { width: 142, align: "right" });
        myy += 15;
      }

      /* ── items table ── */
      let y = Math.max(160, my + mh + 18);
      const colQty = 355, colUnit = 425, colAmt = R - 8;

      pdf.rect(L, y, CW, 24).fill(INK);
      pdf.fillColor("#e2e8f0").font("Helvetica-Bold").fontSize(8);
      pdf.text("DESCRIPTION", L + 12, y + 8);
      pdf.text("QTY", colQty, y + 8, { width: 30, align: "right" });
      pdf.text("UNIT PRICE", colUnit, y + 8, { width: 75, align: "right" });
      pdf.text("AMOUNT", colAmt, y + 8, { width: 70, align: "right" });
      y += 24;

      pdf.font("Helvetica").fontSize(9.5);
      items.forEach((it, i) => {
        const rowH = 26;
        if (y + rowH > 690) { pdf.addPage(); y = 60; }
        if (i % 2 === 1) { pdf.rect(L, y, CW, rowH).fill(SOFT); }
        pdf.fillColor(INK);
        const desc = it.ref ? `${it.description}  (${it.ref})` : it.description;
        pdf.font("Helvetica").fontSize(9.5).fillColor(INK).text(desc, L + 12, y + 8, { width: colQty - L - 24 });
        pdf.text(String(it.qty), colQty, y + 8, { width: 30, align: "right" });
        pdf.text(it.unit_price.toLocaleString(), colUnit, y + 8, { width: 75, align: "right" });
        pdf.font("Helvetica-Bold").fillColor(ACCENT_DARK).text((it.qty * it.unit_price).toLocaleString(), colAmt, y + 8, { width: 70, align: "right" });
        y += rowH;
        pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor("#e2e8f0").stroke();
      });

      /* ── totals card ── */
      y += 14;
      const totalsX = 350, totalsW = R - totalsX;
      pdf.roundedRect(totalsX, y, totalsW, (doc.tax_rate > 0 ? 66 : 50) + 30, 5).fillAndStroke("#ffffff", LINE);
      pdf.strokeColor(LINE);
      let ty = y + 11;
      const tline = (k: string, v: string, opts: { bold?: boolean; big?: boolean; color?: string } = {}): void => {
        const f = opts.big ? 13 : opts.bold ? 10 : 9;
        pdf.font(opts.bold || opts.big ? "Helvetica-Bold" : "Helvetica").fontSize(f).fillColor(opts.color ?? (opts.big ? ACCENT : INK));
        pdf.text(k, totalsX + 14, ty, { width: totalsW - 100, align: "left" });
        pdf.text(v, totalsX + 14, ty, { width: totalsW - 28, align: "right" });
        ty += opts.big ? 22 : 15;
      };
      tline("Subtotal", fmt(subtotal));
      if (doc.tax_rate > 0) tline(`Tax (${doc.tax_rate}%)`, fmt(tax));
      pdf.moveTo(totalsX + 12, ty - 3).lineTo(R - 12, ty - 3).lineWidth(0.7).strokeColor(LINE).stroke();
      ty += 5;
      tline("TOTAL", fmt(doc.total), { big: true });
      y = ty + 4;

      /* ── amount in words ── */
      pdf.font("Helvetica-Oblique").fontSize(8).fillColor(DIM)
        .text(`Amount in words: ${amountToWords(doc.total)} ${cur} only.`, L, y, { width: CW });
      y += 26;

      /* ── kind-specific blocks ── */
      if (isInvoice) {
        const ph = 74;
        pdf.roundedRect(L, y, CW, ph, 5).fillAndStroke(SOFT, LINE);
        pdf.fillColor(ACCENT_DARK).font("Helvetica-Bold").fontSize(8).text("PAYMENT DETAILS", L + 14, y + 10);
        pdf.font("Helvetica").fontSize(9).fillColor(INK)
          .text("M-PESA PAYBILL:  [paybill number]", L + 14, y + 27)
          .text("Account reference:  " + doc.number, L + 14, y + 42)
          .text("Bank transfer details available on request — info@imeantech.com", L + 14, y + 57);
        y += ph + 16;
      }

      if (!isInvoice && !isReceipt) {
        // quotation: validity + acceptance signatures
        pdf.font("Helvetica").fontSize(8.5).fillColor(DIM)
          .text("This quotation is valid for 30 days from the date of issue. Prices are inclusive of applicable taxes as shown.", L, y, { width: CW });
        y += 34;
        const sy = Math.min(y, 660);
        pdf.moveTo(L, sy).lineTo(250, sy).lineWidth(0.7).strokeColor(LINE).stroke();
        pdf.moveTo(330, sy).lineTo(R, sy).lineWidth(0.7).strokeColor(LINE).stroke();
        pdf.font("Helvetica").fontSize(7.5).fillColor(DIM)
          .text("CLIENT ACCEPTANCE — SIGNATURE", L, sy + 5)
          .text("DATE", 330, sy + 5)
          .text("For IMT General System", L, sy + 16)
          .text("DATE", 330, sy + 16);
        y = sy + 40;
      }

      if (isReceipt) {
        pdf.roundedRect(L, y, CW, 30, 5).fill(GOOD);
        pdf.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
          .text("PAYMENT RECEIVED WITH THANKS", L, y + 10, { width: CW, align: "center" });
        y += 46;
      }

      /* ── footer ── */
      const footer = (page: number, pages: number): void => {
        pdf.font("Helvetica").fontSize(7.5).fillColor(DIM)
          .text(
            isReceipt
              ? "This receipt is system-issued and traceable — IMT General System command core · imeantech.com"
              : "Thank you for your business — IMT General System · imeantech.com · info@imeantech.com",
            L, 776, { width: CW - 60, align: "center" }
          );
        if (pages > 1) pdf.text(`Page ${page} of ${pages}`, R - 60, 776, { width: 60, align: "right" });
      };
      const pages = pdf.bufferedPageRange().count || 1;
      for (let p = 0; p < pages; p++) { pdf.switchToPage(p); footer(p + 1, pages); }

      pdf.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
