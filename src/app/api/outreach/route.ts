import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { processDue, classifyReply } from "@/lib/outreach";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const view = req.nextUrl.searchParams.get("view") ?? "queue";
  const db = getDb();
  if (view === "sequences") {
    return Response.json({ sequences: db.prepare("SELECT * FROM sequences ORDER BY id DESC LIMIT 50").all() });
  }
  const queue = db
    .prepare(
      `SELECT q.*, l.company, l.contact FROM outreach_queue q LEFT JOIN leads l ON l.id = q.lead_id
       WHERE q.status IN ('queued','paused') ORDER BY q.scheduled_for ASC LIMIT 80`
    )
    .all();
  const sent = db
    .prepare(
      `SELECT q.*, l.company FROM outreach_queue q LEFT JOIN leads l ON l.id = q.lead_id
       WHERE q.status = 'sent' ORDER BY q.sent_at DESC LIMIT 40`
    )
    .all();
  const byChannel = db.prepare("SELECT channel, COUNT(*) n, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent FROM outreach_queue GROUP BY channel").all();
  return Response.json({ queue, sent, byChannel });
}

/** POST: process due queue, or classify an inbound reply */
export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { action?: string; text?: string };
  if (b.action === "process") return Response.json(processDue(50));
  if (b.action === "classify" && b.text) return Response.json(classifyReply(b.text));
  return Response.json({ error: "action=process|classify" }, { status: 400 });
}
