import { NextRequest } from "next/server";
import { getDb, logActivity } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const rows = getDb().prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 100").all();
  return Response.json({ leads: rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.company) return Response.json({ error: "company is required" }, { status: 400 });
  const r = getDb()
    .prepare("INSERT INTO leads (company, contact, email, source, score, notes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      String(b.company),
      b.contact ? String(b.contact) : null,
      b.email ? String(b.email) : null,
      b.source ? String(b.source) : null,
      typeof b.score === "number" ? b.score : 0,
      b.notes ? String(b.notes) : null
    );
  logActivity("LEAD_ADDED", `${b.company} (manual)`);
  return Response.json({ ok: true, id: Number(r.lastInsertRowid) });
}
