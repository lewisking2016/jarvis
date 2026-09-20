import { NextRequest } from "next/server";
import { getDb, logActivity } from "@/lib/db";

export const runtime = "nodejs";

/**
 * PATCH /api/mutate
 * body: { entity: "lead", id, status?, score? } | { entity: "document", id, status }
 */
export async function PATCH(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as {
    entity?: "lead" | "document"; id?: number; status?: string; score?: number;
  };
  if (!b.entity || !b.id) return Response.json({ error: "entity and id required" }, { status: 400 });
  const db = getDb();

  if (b.entity === "lead") {
    if (b.status) db.prepare("UPDATE leads SET status=?, updated_at=datetime('now') WHERE id=?").run(String(b.status), b.id);
    if (typeof b.score === "number") db.prepare("UPDATE leads SET score=? WHERE id=?").run(b.score, b.id);
    logActivity("LEAD_UPDATED", `#${b.id}${b.status ? ` -> ${b.status}` : ""} (manual)`);
    return Response.json({ ok: true });
  }

  if (b.entity === "document") {
    if (!b.status) return Response.json({ error: "status required for document" }, { status: 400 });
    db.prepare("UPDATE documents SET status=? WHERE id=?").run(String(b.status), b.id);
    logActivity("DOC_UPDATED", `#${b.id} -> ${b.status}`);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "unknown entity" }, { status: 400 });
}
