import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { getDb } from "./db";

/**
 * IMT DOCUMENT TEMPLATES v3 — BANK-GRADE LAYOUT.
 * Modeled on what Kenyan financial paper actually looks like (Equity statement
 * blocks, M-Pesa confirmation fields) plus classic invoice anatomy:
 *   · full-width dark brand band (statement-header aesthetic)
 *   · document title block with a perforated-meta card (Issue date, Due, Validity)
 *   · ruled items table, right-aligned tabular numerals, zebra rows
 *   · official totals block (SUBTOTAL / TAX / TOTAL DUE) like a bank slip
 *   · PAYMENT SLIP panel: channel-specific fields — Equity bank box AND M-Pesa
 *     box side by side, account reference = document number (reconciliation)
 *   · amount-in-words legal line, signature rule for quotations,
 *     green receipt stamp treatment
 */

const ACCENT = "#0e7490"; // IMT cyan
const INK = "#111827";
const DIM = "#6b7280";
const LINE = "#d1d5db";
const SOFT = "#f3f4f6";
const GOOD = "#047857";

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
  payment_info?: string | null;
  created_at: string;
  linked_doc?: number | null;
}

/* ---------- amount in words ---------- */

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

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (["paid", "issued", "accepted", "won"].includes(s)) return GOOD;
  if (["draft", "pending"].includes(s)) return "#b45309";
  if (["overdue", "void", "rejected"].includes(s)) return "#b91c1c";
  return ACCENT;
}

/* ---------- main renderer ---------- */

export function renderDocumentPdf(doc: DocRow): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "A4", margin: 50, info: { Author: "imeantech.com", Title: doc.number } });
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

      const W = 612, L = 50, R = 562, CW = R - L;

      /* ══ BANK-GRADE HEADER BAND (full-bleed dark, statement aesthetic) ══ */
      const bandH = 86;
      pdf.rect(0, 0, W, bandH).fill(INK);
      pdf.rect(0, bandH, W, 3).fill(ACCENT); // accent rule under the band
      const logoPath = path.join(process.cwd(), "public", "imtblack.png");
      // white scrim behind the (black) logo so it reads on the dark band
      if (fs.existsSync(logoPath)) {
        try {
          pdf.roundedRect(L, 18, 64, 50, 6).fill("#ffffff");
          pdf.image(logoPath, L + 10, 24, { height: 38 });
        } catch { /* logo optional */ }
      }
      pdf.font("Helvetica-Bold").fontSize(9).fillColor("#9ca3af")
        .text("IMT GENERAL SYSTEM", 128, 24)
        .font("Helvetica").fontSize(8).fillColor("#9ca3af")
        .text("Waris Mall, Ruiru, Kenya  ·  imeantech.com  ·  info@imeantech.com  ·  0114971070", 128, 38);

      // document title block, right-aligned like a statement title
      pdf.font("Helvetica-Bold").fontSize(24).fillColor("#ffffff").text(label, 330, 20, { width: 232, align: "right" });
      pdf.font("Helvetica-Bold").fontSize(12).fillColor(ACCENT).text(doc.number, 330, 50, { width: 232, align: "right" });

      // status pill sits on the band's bottom edge
      const badgeTxt = doc.status.toUpperCase();
      pdf.font("Helvetica-Bold").fontSize(7.5);
      const bw = pdf.widthOfString(badgeTxt) + 16;
      const bx = R - bw, by = bandH - 8;
      pdf.roundedRect(bx, by, bw, 16, 8).fillAndStroke(statusColor(doc.status), statusColor(doc.status));
      pdf.fillColor("#ffffff").text(badgeTxt, bx + 8, by + 4.5, { width: bw - 16, align: "center" });

      /* ══ PARTY / META: client left, perforated meta card right (bank slip style) ══ */
      let y = bandH + 26;
      const partyLabel = isInvoice ? "BILLED TO" : isReceipt ? "RECEIVED FROM" : "PREPARED FOR";
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(DIM).text(partyLabel, L, y);
      pdf.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(doc.client, L, y + 13);
      if (doc.client_phone) pdf.font("Helvetica").fontSize(9.5).fillColor(DIM).text(doc.client_phone, L, y + 31);

      const metaRows: [string, string][] = [["Issue date", doc.created_at.slice(0, 10)]];
      if (isInvoice && doc.due_date) metaRows.push(["Due date", doc.due_date.slice(0, 10)]);
      if (!isInvoice && !isReceipt) metaRows.push(["Valid for", "30 days"]);
      if (isReceipt && doc.linked_doc) {
        const linked = getDb().prepare("SELECT number FROM documents WHERE id = ?").get(doc.linked_doc) as { number: string } | undefined;
        if (linked) metaRows.push(["Payment for", linked.number]);
      }
      const mh = 14 + metaRows.length * 17 + 8;
      const my = y - 6;
      pdf.roundedRect(386, my, 176, mh, 4).fillAndStroke("#ffffff", LINE);
      // perforation dashes on the card top (bank slip feel)
      pdf.strokeColor(LINE).lineWidth(0.7).dash(2, { space: 3 }).moveTo(386, my).lineTo(562, my).stroke().undash();
      let myy = my + 12;
      for (const [k, v] of metaRows) {
        pdf.font("Helvetica").fontSize(8).fillColor(DIM).text(k, 398, myy);
        pdf.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(v, 398, myy, { width: 152, align: "right" });
        myy += 17;
      }

      /* ══ ITEMS TABLE — statement-style rules ══ */
      y = Math.max(my + mh + 22, 178);
      const colQty = 344, colUnit = 420, colAmt = R - 8;

      // table header: NOT filled dark — thin double-rule statement style
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(DIM);
      pdf.text("DESCRIPTION", L + 2, y);
      pdf.text("QTY", colQty, y, { width: 30, align: "right" });
      pdf.text("UNIT PRICE (KES)", colUnit, y, { width: 85, align: "right" });
      pdf.text("AMOUNT (KES)", colAmt, y, { width: 70, align: "right" });
      y += 12;
      pdf.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(INK).stroke();
      y += 3;
      pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor(LINE).stroke();
      y += 7;

      pdf.font("Helvetica").fontSize(9.5);
      items.forEach((it, i) => {
        const rowH = 26;
        if (y + rowH > 660) { pdf.addPage(); y = 60; }
        if (i % 2 === 1) { pdf.rect(L, y - 3, CW, rowH).fill(SOFT); }
        pdf.fillColor(INK);
        const desc = it.ref ? `${it.description}  (${it.ref})` : it.description;
        pdf.font("Helvetica").fontSize(9.5).fillColor(INK).text(desc, L + 2, y + 4, { width: colQty - L - 16 });
        pdf.text(String(it.qty), colQty, y + 4, { width: 30, align: "right" });
        pdf.text(it.unit_price.toLocaleString(), colUnit, y + 4, { width: 85, align: "right" });
        pdf.font("Helvetica-Bold").fillColor(INK).text((it.qty * it.unit_price).toLocaleString(), colAmt, y + 4, { width: 70, align: "right" });
        y += rowH;
        pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor("#e5e7eb").stroke();
      });

      /* ══ OFFICIAL TOTALS BLOCK — double-ruled like a bank slip ══ */
      y += 16;
      const totalsX = 330, totalsW = R - totalsX;
      let ty = y;
      const trow = (k: string, v: string, opts: { big?: boolean; rule?: boolean; color?: string } = {}): void => {
        pdf.font(opts.big ? "Helvetica-Bold" : "Helvetica").fontSize(opts.big ? 13 : 9.5).fillColor(opts.color ?? INK);
        pdf.text(k, totalsX + 2, ty, { width: totalsW - 100 });
        pdf.text(v, totalsX + 2, ty, { width: totalsW - 6, align: "right" });
        ty += opts.big ? 24 : 16;
        if (opts.rule) {
          pdf.moveTo(totalsX, ty - 18).lineTo(R, ty - 18).lineWidth(0.6).strokeColor(LINE).stroke();
        }
      };
      trow("SUBTOTAL", subtotal.toLocaleString());
      if (doc.tax_rate > 0) trow(`VAT (${doc.tax_rate}%)`, tax.toLocaleString(), { rule: true });
      ty += 2;
      // heavy double rule above TOTAL
      pdf.moveTo(totalsX, ty).lineTo(R, ty).lineWidth(1.4).strokeColor(INK).stroke();
      ty += 3;
      pdf.moveTo(totalsX, ty).lineTo(R, ty).lineWidth(0.5).strokeColor(INK).stroke();
      ty += 8;
      trow("TOTAL DUE", fmt(doc.total), { big: true, color: ACCENT });
      if (isReceipt) {
        ty += 2;
        trow("AMOUNT PAID", fmt(doc.total), { color: GOOD, rule: false });
      }
      y = Math.max(ty + 6, y + 60);

      /* ══ LEGAL LINE ══ */
      pdf.font("Helvetica-Oblique").fontSize(8).fillColor(DIM)
        .text(`Amount in words: ${amountToWords(doc.total)} ${cur} only.`, L, y, { width: CW });
      y += 24;

      /* ══ PAYMENT SLIP PANEL — channel boxes side by side ══ */
      if (isInvoice || isReceipt) {
        const ph = 132;
        pdf.roundedRect(L, y, CW, ph, 5).fillAndStroke("#ffffff", LINE);
        pdf.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT).text("PAYMENT SLIP", L + 14, y + 10);
        pdf.font("Helvetica").fontSize(7.5).fillColor(DIM)
          .text(isReceipt ? "This receipt confirms funds received against the account reference below." : "Use the account reference below so your payment reconciles automatically.", L + 100, y + 11, { width: CW - 120 });

        const boxY = y + 28, boxH = 78, boxW = (CW - 42) / 2;
        // ── bank box ──
        pdf.roundedRect(L + 14, boxY, boxW, boxH, 4).fillAndStroke(SOFT, LINE);
        pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(ACCENT).text("BANK TRANSFER — EQUITY BANK KENYA", L + 24, boxY + 8);
        pdf.font("Helvetica").fontSize(8.5).fillColor(INK)
          .text("Account name:  LEWIS NDUNG'U KINAGA", L + 24, boxY + 23)
          .text("Account number:  0340184547442", L + 24, boxY + 38)
          .text("Branch:  Any Equity branch / online", L + 24, boxY + 53);
        // ── mpesa box ──
        const mx = L + 14 + boxW + 14;
        const payCode = doc.payment_info ? doc.payment_info.replace(/^(M-PESA · |BANK · )/, "") : "";
        pdf.roundedRect(mx, boxY, boxW, boxH, 4).fillAndStroke(SOFT, LINE);
        pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(ACCENT).text("M-PESA", mx + 10, boxY + 8);
        pdf.font("Helvetica").fontSize(8.5).fillColor(INK)
          .text("Pay to:  0114971070 (Buy Goods / Send Money)", mx + 10, boxY + 23)
          .text(payCode ? `Paybill/Till:  ${payCode}` : "Paybill/Till:  on request", mx + 10, boxY + 38)
          .text("Confirmation:  M-Pesa SMS code on payment", mx + 10, boxY + 53);

        // account reference strip — full width, the reconciliation line
        pdf.rect(L + 14, y + ph - 22, CW - 28, 16).fill(INK);
        pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
          .text(`ACCOUNT REFERENCE:  ${doc.number}`, L + 22, y + ph - 18);
        y += ph + 16;
      }

      if (!isInvoice && !isReceipt) {
        // quotation: validity + acceptance signatures
        pdf.font("Helvetica").fontSize(8.5).fillColor(DIM)
          .text("This quotation is valid for 30 days from the date of issue. Prices are as shown; VAT applied where indicated.", L, y, { width: CW });
        y += 34;
        const sy = Math.min(y, 650);
        pdf.moveTo(L, sy).lineTo(250, sy).lineWidth(0.7).strokeColor(LINE).stroke();
        pdf.moveTo(330, sy).lineTo(R, sy).lineWidth(0.7).strokeColor(LINE).stroke();
        pdf.font("Helvetica").fontSize(7.5).fillColor(DIM)
          .text("CLIENT ACCEPTANCE — SIGNATURE", L, sy + 5)
          .text("DATE", 330, sy + 5)
          .text("AUTHORISED", L, sy + 16)
          .text("DATE", 330, sy + 16);
        y = sy + 40;
      }

      if (isReceipt) {
        // green stamp treatment, slightly rotated feel via double border
        pdf.roundedRect(L, y, CW, 32, 5).fillAndStroke(GOOD, GOOD);
        pdf.roundedRect(L + 2, y + 2, CW - 4, 28, 4).stroke("#ffffff");
        pdf.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
          .text("PAYMENT RECEIVED WITH THANKS", L, y + 11, { width: CW, align: "center" });
        y += 48;
      }

      /* ── footer ── */
      const footer = (page: number, pages: number): void => {
        pdf.moveTo(L, 770).lineTo(R, 770).lineWidth(0.4).strokeColor(LINE).stroke();
        pdf.font("Helvetica").fontSize(7.5).fillColor(DIM)
          .text(
            isReceipt
              ? "System-issued receipt · traceable to payment reference · imeantech.com"
              : "Thank you for your business · imeantech.com · info@imeantech.com · Waris Mall, Ruiru, Kenya",
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
