import { NextRequest } from "next/server";
import { getDb, logActivity } from "@/lib/db";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";

/**
 * POST /api/seed — insert a realistic demo dataset so every module has life.
 * Guarded: only runs when the DB is empty of demo markers (idempotent-ish for dev).
 */
export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { reset?: boolean };
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c;
  if (count > 0 && !b.reset) return Response.json({ ok: true, skipped: true, reason: "data already present" });

  if (b.reset) {
    for (const t of ["leads", "documents", "tasks", "notes", "transactions", "outreach_queue", "sequences", "approvals", "memories", "activity", "workers", "metric_snapshots"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    // reseed identity + goal
    const ins = db.prepare("INSERT INTO memories (kind, content, importance, source, confidence) VALUES ('identity', ?, 5, 'seed', 1)");
    ins.run("Company: IMT General System (imeantech.com) — IT services and SaaS products.");
    ins.run("Mission: KES 400,000 revenue in Q4 2026; north star 1,000,000 active users.");
    const year = new Date().getFullYear();
    const sprintStart = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    db.prepare("INSERT INTO goals (name, metric, target, period_start, period_end) VALUES (?, 'revenue_kes', 400000, ?, ?)")
      .run("Q4 revenue", sprintStart, `${year}-12-31`);
  }

  const insLead = db.prepare("INSERT INTO leads (company, contact, email, phone, source, status, score, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insLead.run("Acme Properties Ltd", "John Mwangi", "j.mwangi@acme.co.ke", "+254711000111", "referral", "quoted", 78, "Wants 3 sites on managed hosting; budget confirmed.");
  insLead.run("Nairobi Solar Group", "Grace Achieng", "g.achieng@nairobisolar.com", "+254722333444", "osint", "meeting", 65, "Solar monitoring SaaS interest; meeting Tue.");
  insLead.run("Bluewave Traders", "Peter Otieno", null, "+254733555666", "warm_network", "contacted", 45, "Met at KIRDI event; needs POS system quote.");
  insLead.run("Savannah Logistics", "Mary Wanjiku", "m.wanjiku@savannah.co.ke", "+254701888999", "openoutreach", "replied", 58, "Asked for pricing on fleet tracking.");
  insLead.run("Kilimanjaro Cafe", "David Kimani", null, "+254799111222", "warm_network", "new", 30, "Walk-in referral; Wi-Fi setup.");
  insLead.run("Horizon Schools", "Susan Njeri", "s.njeri@horizon.ac.ke", "+254712444555", "website", "quoted", 70, "Lab network for 2 campuses.");
  insLead.run("Rift Valley Aggregates", "Tom Kiprop", "t.kiprop@rvaggregates.com", "+254728666777", "osint", "contacted", 40, "CCTV + weighbridge integration.");
  insLead.run("Zawadi Boutique", "Amina Hassan", null, "+254796888333", "instagram", "new", 25, "Asked about e-commerce site on IG DM.");

  const insDoc = db.prepare("INSERT INTO documents (kind, number, client, client_phone, items_json, currency, tax_rate, total, status, due_date) VALUES (?, ?, ?, ?, ?, 'KES', ?, ?, ?, ?)");
  const year = new Date().getFullYear();
  insDoc.run("QUOTE", `QTE-${year}-0001`, "Acme Properties Ltd", "+254711000111", JSON.stringify([
    { description: "Managed hosting — 3 sites (annual)", qty: 3, unit_price: 14000 },
    { description: "Site migration & hardening", qty: 3, unit_price: 6000 },
  ]), 0, 60000, "sent", null);
  insDoc.run("QUOTE", `QTE-${year}-0002`, "Horizon Schools", "+254712444555", JSON.stringify([
    { description: "Campus network — structured cabling", qty: 2, unit_price: 85000 },
    { description: "24-port managed switch", qty: 2, unit_price: 22000 },
  ]), 0, 214000, "draft", null);
  insDoc.run("INVOICE", `INV-${year}-0001`, "Acme Properties Ltd", "+254711000111", JSON.stringify([
    { description: "Managed hosting — Q1 phase 1", qty: 1, unit_price: 45000 },
  ]), 0, 45000, "sent", new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10));
  insDoc.run("INVOICE", `INV-${year}-0002`, "Nairobi Solar Group", "+254722333444", JSON.stringify([
    { description: "Solar monitoring pilot — 30 days", qty: 1, unit_price: 28000 },
  ]), 0, 28000, "overdue", new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10));

  const insTx = db.prepare("INSERT INTO transactions (direction, amount, currency, tx_type, counterparty, counterparty_phone, category, source, ref, occurred_at) VALUES (?, ?, 'KES', ?, ?, ?, ?, 'mpesa', ?, ?)");
  const dayAgo = (d: number): string => new Date(Date.now() - d * 864e5).toISOString();
  insTx.run("in", 15000, "receive", "JOHN MWANGI", "+254711000111", "revenue_in", "QGH7XYA123", dayAgo(0.2));
  insTx.run("in", 12000, "receive", "BLUEWAVE TRADERS", "+254733555666", "revenue_in", "QGH8KLM456", dayAgo(1.1));
  insTx.run("out", 3500, "paybill", "KENYA POWER", null, "utilities", "QGH9NOP789", dayAgo(2));
  insTx.run("out", 2500, "paybill", "SAFARICOM FIBRE", null, "connectivity", "QGA1QRS012", dayAgo(3));
  insTx.run("out", 1200, "send", "JANE KAMAU", "+254705123456", "transport", "QGB2TUV345", dayAgo(1.5));
  insTx.run("out", 55, "send", "MPESA CHARGES", null, "fees", "QGC3WXY678", dayAgo(1.5));
  insTx.run("in", 8000, "receive", "WALK-IN CLIENT", "+254790222333", "revenue_in", "QGD4ZAB901", dayAgo(4));
  insTx.run("out", 9500, "paybill", "SKYLINE RENT", null, "rent", "QGE5CDE234", dayAgo(6));

  db.prepare("INSERT INTO tasks (title, due, priority) VALUES ('Follow up Acme on QTE-0001 signing', date('now','+1 day'), 'high')").run();
  db.prepare("INSERT INTO tasks (title, due, priority) VALUES ('Call Savannah Logistics — pricing discussion', date('now'), 'high')").run();
  db.prepare("INSERT INTO tasks (title, due, priority) VALUES ('Prepare Horizon Schools proposal PDF', date('now','+2 day'), 'normal')").run();
  db.prepare("INSERT INTO tasks (title, due, priority) VALUES ('Register secondary cold domain', date('now','+3 day'), 'normal')").run();

  db.prepare("INSERT INTO notes (title, content) VALUES ('Acme meeting brief', 'John wants phased rollout: 3 sites now, 2 more in January. Sensitive to downtime — emphasize SLA. Decision maker: himself.')").run();
  db.prepare("INSERT INTO notes (title, content) VALUES ('Pricing decision', 'Principal decided 2026-09-18: managed hosting standard rate KES 14,000/site/year; don''t discount below 10%.')").run();

  const insQ = db.prepare("INSERT INTO outreach_queue (lead_id, channel, step, template, body, scheduled_for, status, approval_required) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insQ.run(4, "email", 2, "followup_value", "Hi Mary — sharing how fleet tracking cut fuel costs 18% for a similar Nairobi operator…", new Date(Date.now() + 0.2 * 864e5).toISOString(), "queued", 0);
  insQ.run(3, "linkedin", 1, "connect_note", "Hi Peter — we met at the KIRDI event; enjoyed your take on retail tech. Connecting here…", new Date(Date.now() + 0.1 * 864e5).toISOString(), "paused", 1);
  insQ.run(7, "email", 1, "first_touch", "Hi Tom — noticed RV Aggregates runs two sites; most operators lose 6% revenue to unmonitored weighbridges…", new Date(Date.now() + 0.3 * 864e5).toISOString(), "queued", 0);

  db.prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES ('outreach_send', 'linkedin DM → Bluewave Traders (Peter Otieno)', '{\"demo\":true}')").run();
  db.prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES ('campaign_send', 'Newsletter to 42 opt-in subscribers — October edition', '{\"demo\":true}')").run();

  const insMem = db.prepare("INSERT INTO memories (kind, content, entities, importance, source) VALUES (?, ?, ?, ?, ?)");
  insMem.run("relationship", "John Mwangi (Acme) is the sole decision maker; values uptime over price.", '["lead:acme"]', 3, "seed");
  insMem.run("lesson", "Warm-network referrals close 3x faster than OSINT cold leads — prioritize intros.", null, 4, "seed");
  insMem.run("fact", "Nairobi Solar pilot runs 30 days; conversion decision expected mid-November.", '["lead:nairobisolar"]', 2, "seed");
  insMem.run("preference", "Principal prefers KES pricing incl. VAT shown separately.", null, 3, "seed");

  db.prepare("INSERT INTO workers (name, kind, jurisdiction, status) VALUES ('cowagent-01', 'cowagent', 'research & drafts', 'idle')").run();
  db.prepare("INSERT INTO workers (name, kind, jurisdiction, status) VALUES ('gastown-local', 'gastown', 'coding agents', 'idle')").run();
  db.prepare("INSERT INTO workers (name, kind, jurisdiction, status) VALUES ('openhuman-memory', 'openhuman', 'context & memory', 'idle')").run();

  logActivity("SEED", "Demo dataset loaded");
  void pipeline; // keep import tree-shaken-safe
  void Readable;
  return Response.json({ ok: true });
}
