import { NextRequest } from "next/server";
import { remember, recall } from "@/lib/memory";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams.get("q");
  if (q) return Response.json({ memories: recall(q, 20) });
  const rows = getDb()
    .prepare("SELECT id, kind, content, importance, source, use_count, created_at FROM memories WHERE superseded_by IS NULL ORDER BY importance DESC, id DESC LIMIT 100")
    .all();
  return Response.json({ memories: rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.kind || !b.content) return Response.json({ error: "kind and content required" }, { status: 400 });
  const r = remember({
    kind: b.kind as "fact",
    content: String(b.content),
    entities: Array.isArray(b.entities) ? (b.entities as string[]) : undefined,
    importance: typeof b.importance === "number" ? b.importance : 2,
    source: "manual",
  });
  return Response.json({ ok: true, ...r });
}
