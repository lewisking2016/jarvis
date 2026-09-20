import PDFDocument from "pdfkit";
import { getDb } from "./db";

const ACCENT = "#0e7490";
const INK = "#0f172a";
const DIM = "#64748b";
const LINE = "#cbd5e1";

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

      // letterhead
      pdf.rect(0, 0, 612, 8).fill(ACCENT);
      pdf.fillColor(INK).font("Helvetica-Bold").fontSize(20).text("IMT GENERAL SYSTEM", 50, 40);
      pdf.font("Helvetica").fontSize(9).fillColor(DIM)
        .text("imeantech.com  ·  info@imeantech.com  ·  Nairobi, Kenya", 50, 64);
      pdf.moveTo(50, 82).lineTo(562, 82).lineWidth(1).strokeColor(LINE).stroke();

      // doc meta
      const label = doc.kind === "INVOICE" ? "INVOICE" : doc.kind === "RECEIPT" ? "RECEIPT" : "QUOTATION";
      pdf.font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text(label, 380, 100, { width: 182, align: "right" });
      pdf.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(doc.number, 380, 122, { width: 182, align: "right" });
      pdf.font("Helvetica").fontSize(9).fillColor(DIM)
        .text(`Date: ${doc.created_at.slice(0, 10)}`, 380, 140, { width: 182, align: "right" });
      if (doc.due_date) pdf.text(`Due: ${doc.due_date.slice(0, 10)}`, 380, 152, { width: 182, align: "right" });
      if (doc.kind === "RECEIPT" && doc.linked_doc) {
        const linked = getDb().prepare("SELECT number FROM documents WHERE id = ?").get(doc.linked_doc) as { number: string } | undefined;
        if (linked) pdf.text(`Payment for: ${linked.number}`, 380, 164, { width: 182, align: "right" });
      }
      pdf.font("Helvetica").fontSize(9).fillColor(DIM).text(`Status: ${doc.status.toUpperCase()}`, 380, doc.due_date ? 164 : 152, { width: 182, align: "right" });

      // bill to
      pdf.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("BILLED TO", 50, 104);
      pdf.font("Helvetica").fontSize(11).fillColor(INK).text(doc.client, 50, 120);
      if (doc.client_phone) pdf.font("Helvetica").fontSize(9).fillColor(DIM).text(doc.client_phone, 50, 136);

      // items table
      let y = 200;
      pdf.rect(50, y, 512, 22).fill("#f1f5f9");
      pdf.fillColor(DIM).font("Helvetica-Bold").fontSize(9);
      pdf.text("DESCRIPTION", 60, y + 7);
      pdf.text("QTY", 360, y + 7, { width: 40, align: "right" });
      pdf.text("UNIT PRICE", 410, y + 7, { width: 80, align: "right" });
      pdf.text("AMOUNT", 490, y + 7, { width: 62, align: "right" });
      y += 22;

      pdf.font("Helvetica").fontSize(10).fillColor(INK);
      for (const it of items) {
        if (y > 720) { pdf.addPage(); y = 60; }
        const desc = it.ref ? `${it.description} (${it.ref})` : it.description;
        pdf.text(desc, 60, y + 6, { width: 280 });
        pdf.text(String(it.qty), 360, y + 6, { width: 40, align: "right" });
        pdf.text(it.unit_price.toLocaleString(), 410, y + 6, { width: 80, align: "right" });
        pdf.text((it.qty * it.unit_price).toLocaleString(), 490, y + 6, { width: 62, align: "right" });
        y += 24;
        pdf.moveTo(50, y).lineTo(562, y).lineWidth(0.5).strokeColor("#e2e8f0").stroke();
      }

      // totals
      y += 12;
      const totalLine = (l: string, v: string, bold = false, color = INK): void => {
        pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(color);
        pdf.text(l, 380, y, { width: 100, align: "right" });
        pdf.text(v, 490, y, { width: 62, align: "right" });
        y += bold ? 20 : 16;
      };
      totalLine("Subtotal", `${doc.currency} ${subtotal.toLocaleString()}`);
      if (doc.tax_rate > 0) totalLine(`Tax (${doc.tax_rate}%)`, `${doc.currency} ${tax.toLocaleString()}`);
      pdf.moveTo(370, y - 4).lineTo(562, y - 4).strokeColor(LINE).stroke();
      totalLine("TOTAL", `${doc.currency} ${doc.total.toLocaleString()}`, true, ACCENT);

      if (doc.kind === "INVOICE") {
        y += 14;
        pdf.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("PAYMENT DETAILS", 50, y);
        pdf.font("Helvetica").fontSize(9).fillColor(DIM)
          .text("M-Pesa Paybill: [to be added]   ·   Or send to info@imeantech.com for banking details", 50, y + 13);
        y += 40;
      }
      if (doc.kind === "RECEIPT") {
        y += 14;
        pdf.font("Helvetica-Bold").fontSize(10).fillColor("#047857").text("PAYMENT RECEIVED WITH THANKS", 50, y);
        y += 20;
      }

      pdf.font("Helvetica").fontSize(8).fillColor(DIM)
        .text("Generated by J.A.R.V.I.S. — IMT General System command core. This document is system-issued and traceable.", 50, 780, { width: 512, align: "center" });

      pdf.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
